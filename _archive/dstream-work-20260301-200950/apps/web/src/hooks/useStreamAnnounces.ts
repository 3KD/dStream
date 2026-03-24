"use client";

import { useEffect, useMemo, useState } from "react";
import type { Filter } from "nostr-tools";
import { makeStreamKey, NOSTR_KINDS, parseDiscoveryModerationEvent, parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getDiscoveryOperatorPubkeys, getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

interface UseStreamAnnouncesOptions {
  enabled?: boolean;
  liveOnly?: boolean;
  limit?: number;
  includeHidden?: boolean;
  includeMature?: boolean;
  viewerPubkey?: string | null;
}

const LIVE_STALE_SEC = 6 * 60 * 60;
const LIVE_HINT_GRACE_SEC = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_STREAM_LIVE_HINT_GRACE_SEC ?? "");
  if (!Number.isFinite(raw)) return 7 * 24 * 60 * 60;
  const parsed = Math.floor(raw);
  if (parsed < LIVE_STALE_SEC) return 7 * 24 * 60 * 60;
  return parsed;
})();
const LIVE_PRUNE_INTERVAL_MS = 15_000;
const STREAM_ANNOUNCE_LOOKBACK_ALL_SEC = 45 * 24 * 60 * 60;
const STREAM_ANNOUNCE_MIN_LIMIT_ALL = 320;
const STREAM_CACHE_MAX_ITEMS = 360;
const STREAM_CACHE_REFRESH_MS = 90_000;
const STREAM_DISCOVERY_TIMEOUT_MS = 4_000;
const STREAM_DISCOVERY_SERVER_FALLBACK_COOLDOWN_MS = 2 * 60 * 1000;
const DISCOVERY_POLICY_LOOKBACK_SEC = 14 * 86400;
const DISCOVERY_POLICY_LIMIT = 2000;
const ORIGIN_STREAM_ID_PATTERN = /^[0-9a-f]{64}--(.+)$/i;
const TRANSCODE_VARIANT_PATTERN = /__r\d+p$/i;

interface StreamOrderMeta {
  firstSeenAt: number;
  seq: number;
}

interface HiddenPolicyState {
  hidden: boolean;
  createdAt: number;
}

interface StreamDirectorySnapshot {
  streams: StreamAnnounce[];
  hiddenPubkeyPolicies: Map<string, HiddenPolicyState>;
  hiddenStreamPolicies: Map<string, HiddenPolicyState>;
  isLoading: boolean;
}

interface StreamDirectoryStore {
  snapshot: StreamDirectorySnapshot;
  listeners: Set<() => void>;
  consumers: number;
  relays: string[];
  operatorPubkeys: string[];
  sub: { close?: () => void } | null;
  connectTimeout: ReturnType<typeof setTimeout> | null;
  pruneInterval: ReturnType<typeof setInterval> | null;
  refreshInterval: ReturnType<typeof setInterval> | null;
  seen: Map<string, number>;
  streamsByKey: Map<string, StreamAnnounce>;
  orderMeta: Map<string, StreamOrderMeta>;
  orderSeq: number;
  hiddenPubkeyPolicies: Map<string, HiddenPolicyState>;
  hiddenStreamPolicies: Map<string, HiddenPolicyState>;
  fallbackInFlight: Promise<void> | null;
  fallbackLastAtMs: number;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeStreamId(streamId: string): string {
  const value = safeDecode(streamId.trim());
  if (!value) return value;
  const match = value.match(ORIGIN_STREAM_ID_PATTERN);
  return (match?.[1]?.trim() || value).replace(TRANSCODE_VARIANT_PATTERN, "").toLowerCase();
}

function streamIdFromStreamingUrl(streaming: string): string {
  const raw = streaming.trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const streamMarkerIndex = parts.findIndex((part) => part.toLowerCase() === "stream");
    if (streamMarkerIndex >= 0 && streamMarkerIndex + 1 < parts.length) {
      return normalizeStreamId(parts[streamMarkerIndex + 1] ?? "");
    }
    if (parts.length >= 2 && (parts[parts.length - 1] ?? "").toLowerCase() === "index.m3u8") {
      return normalizeStreamId(parts[parts.length - 2] ?? "");
    }
  } catch {
    // ignore parse errors, then try lightweight extraction
  }

  const marker = "/stream/";
  const lower = raw.toLowerCase();
  const markerIndex = lower.indexOf(marker);
  if (markerIndex < 0) return "";
  const tail = raw.slice(markerIndex + marker.length);
  const segment = tail.split("/")[0] ?? "";
  return normalizeStreamId(segment);
}

function canonicalStreamKey(stream: StreamAnnounce): string {
  const idFromTag = normalizeStreamId(stream.streamId);
  const idFromUrl = streamIdFromStreamingUrl(stream.streaming ?? "");
  if (idFromTag && idFromUrl) {
    return idFromTag.length <= idFromUrl.length ? idFromTag : idFromUrl;
  }
  return idFromTag || idFromUrl || makeStreamKey(stream.pubkey, stream.streamId).toLowerCase();
}

function streamQualityScore(stream: StreamAnnounce, nowSec: number): number {
  const url = (stream.streaming ?? "").trim().toLowerCase();
  const image = (stream.image ?? "").trim();
  let score = 0;
  if (url.includes("dstream.stream/stream/")) score += 8;
  else if (url.includes("/stream/")) score += 2;
  if (url.includes("--")) score += 3;
  if (url.includes("/index.m3u8") || url.endsWith(".m3u8")) score += 2;
  if (url.includes("trycloudflare.com") || url.includes("host.docker.internal") || url.includes("localhost")) score -= 8;
  if (image) score += 4;
  const ageSec = Math.max(0, nowSec - stream.createdAt);
  if (ageSec <= 120) score += 3;
  else if (ageSec <= 600) score += 1;
  else if (ageSec > 1800) score -= 2;
  return score;
}

function chooseBetterStream(current: StreamAnnounce, candidate: StreamAnnounce, nowSec: number): StreamAnnounce {
  const currentLive = current.status === "live";
  const candidateLive = candidate.status === "live";
  if (candidateLive !== currentLive) {
    return candidateLive ? candidate : current;
  }

  const currentAgeSec = Math.max(0, nowSec - current.createdAt);
  const candidateAgeSec = Math.max(0, nowSec - candidate.createdAt);
  if (Math.abs(candidateAgeSec - currentAgeSec) >= 120) {
    return candidateAgeSec < currentAgeSec ? candidate : current;
  }

  const currentScore = streamQualityScore(current, nowSec);
  const candidateScore = streamQualityScore(candidate, nowSec);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current;
  }
  if (candidate.createdAt !== current.createdAt) {
    return candidate.createdAt > current.createdAt ? candidate : current;
  }
  return current;
}

function dedupeByCanonicalStream(streams: StreamAnnounce[], nowSec: number): StreamAnnounce[] {
  const byCanonical = new Map<string, StreamAnnounce>();
  for (const stream of streams) {
    const canonical = canonicalStreamKey(stream);
    const key = `${stream.pubkey.toLowerCase()}::${canonical}`;
    if (!key) continue;
    const existing = byCanonical.get(key);
    byCanonical.set(key, existing ? chooseBetterStream(existing, stream, nowSec) : stream);
  }
  return Array.from(byCanonical.values());
}

function normalizeStaleLiveStatus(stream: StreamAnnounce, staleCutoffSec: number, hintGraceCutoffSec: number): StreamAnnounce {
  if (stream.status !== "live") return stream;
  if (stream.createdAt >= staleCutoffSec) return stream;
  const hasStreamingHint = (stream.streaming ?? "").trim().length > 0;
  if (hasStreamingHint && stream.createdAt >= hintGraceCutoffSec) return stream;
  return { ...stream, status: "ended" };
}

function sortStreamsStable(
  streams: StreamAnnounce[],
  orderMeta: Map<string, StreamOrderMeta>
) {
  return streams.slice().sort((a, b) => {
    const aLive = a.status === "live";
    const bLive = b.status === "live";
    if (aLive !== bLive) return aLive ? -1 : 1;

    const keyA = makeStreamKey(a.pubkey, a.streamId);
    const keyB = makeStreamKey(b.pubkey, b.streamId);
    const aMeta = orderMeta.get(keyA);
    const bMeta = orderMeta.get(keyB);
    const rankA = aMeta?.firstSeenAt ?? a.createdAt;
    const rankB = bMeta?.firstSeenAt ?? b.createdAt;
    if (rankA !== rankB) return rankB - rankA;

    const seqA = aMeta?.seq ?? Number.MAX_SAFE_INTEGER;
    const seqB = bMeta?.seq ?? Number.MAX_SAFE_INTEGER;
    if (seqA !== seqB) return seqA - seqB;

    return keyA.localeCompare(keyB);
  });
}

const streamDirectoryStore: StreamDirectoryStore = {
  snapshot: {
    streams: [],
    hiddenPubkeyPolicies: new Map(),
    hiddenStreamPolicies: new Map(),
    isLoading: true
  },
  listeners: new Set(),
  consumers: 0,
  relays: [],
  operatorPubkeys: [],
  sub: null,
  connectTimeout: null,
  pruneInterval: null,
  refreshInterval: null,
  seen: new Map(),
  streamsByKey: new Map(),
  orderMeta: new Map(),
  orderSeq: 0,
  hiddenPubkeyPolicies: new Map(),
  hiddenStreamPolicies: new Map(),
  fallbackInFlight: null,
  fallbackLastAtMs: 0
};

function emitSnapshot(patch: Partial<StreamDirectorySnapshot>) {
  streamDirectoryStore.snapshot = { ...streamDirectoryStore.snapshot, ...patch };
  for (const listener of streamDirectoryStore.listeners) {
    listener();
  }
}

function applyStreamSnapshot() {
  const now = Math.floor(Date.now() / 1000);
  const staleCutoff = now - LIVE_STALE_SEC;
  const hintGraceCutoff = now - LIVE_HINT_GRACE_SEC;
  const oldestCutoff = now - STREAM_ANNOUNCE_LOOKBACK_ALL_SEC;

  for (const [streamKey, stream] of streamDirectoryStore.streamsByKey) {
    const normalized = normalizeStaleLiveStatus(stream, staleCutoff, hintGraceCutoff);
    if (normalized !== stream) {
      streamDirectoryStore.streamsByKey.set(streamKey, normalized);
    }
    if (normalized.status !== "live" && normalized.createdAt < oldestCutoff) {
      streamDirectoryStore.streamsByKey.delete(streamKey);
      streamDirectoryStore.orderMeta.delete(streamKey);
      streamDirectoryStore.seen.delete(streamKey);
    }
  }

  const deduped = dedupeByCanonicalStream(Array.from(streamDirectoryStore.streamsByKey.values()), now);
  const sorted = sortStreamsStable(deduped, streamDirectoryStore.orderMeta);
  const capped = sorted.slice(0, STREAM_CACHE_MAX_ITEMS);
  if (streamDirectoryStore.streamsByKey.size > STREAM_CACHE_MAX_ITEMS) {
    const keep = new Set(capped.map((stream) => makeStreamKey(stream.pubkey, stream.streamId)));
    for (const streamKey of Array.from(streamDirectoryStore.streamsByKey.keys())) {
      if (!keep.has(streamKey)) {
        streamDirectoryStore.streamsByKey.delete(streamKey);
        streamDirectoryStore.orderMeta.delete(streamKey);
        streamDirectoryStore.seen.delete(streamKey);
      }
    }
  }

  emitSnapshot({ streams: capped });
}

function updateDiscoveryPolicy(event: any) {
  const parsedPolicy = parseDiscoveryModerationEvent(event);
  if (!parsedPolicy) return;
  const key =
    parsedPolicy.targetType === "pubkey"
      ? parsedPolicy.targetPubkey.toLowerCase()
      : makeStreamKey(parsedPolicy.targetPubkey.toLowerCase(), parsedPolicy.targetStreamId ?? "");
  const next = { hidden: parsedPolicy.action === "hide", createdAt: parsedPolicy.createdAt };

  if (parsedPolicy.targetType === "pubkey") {
    const prev = streamDirectoryStore.hiddenPubkeyPolicies.get(key);
    if (!prev || parsedPolicy.createdAt >= prev.createdAt) {
      streamDirectoryStore.hiddenPubkeyPolicies.set(key, next);
      emitSnapshot({ hiddenPubkeyPolicies: new Map(streamDirectoryStore.hiddenPubkeyPolicies) });
    }
    return;
  }

  const prev = streamDirectoryStore.hiddenStreamPolicies.get(key);
  if (!prev || parsedPolicy.createdAt >= prev.createdAt) {
    streamDirectoryStore.hiddenStreamPolicies.set(key, next);
    emitSnapshot({ hiddenStreamPolicies: new Map(streamDirectoryStore.hiddenStreamPolicies) });
  }
}

function updateStreamAnnounce(event: any) {
  const parsed = parseStreamAnnounceEvent(event);
  if (!parsed) return;

  const streamKey = makeStreamKey(parsed.pubkey, parsed.streamId);
  const prevCreatedAt = streamDirectoryStore.seen.get(streamKey);
  if (prevCreatedAt && prevCreatedAt >= parsed.createdAt) return;
  streamDirectoryStore.seen.set(streamKey, parsed.createdAt);

  if (!streamDirectoryStore.orderMeta.has(streamKey)) {
    streamDirectoryStore.orderMeta.set(streamKey, {
      firstSeenAt: parsed.createdAt,
      seq: streamDirectoryStore.orderSeq++
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const staleCutoff = now - LIVE_STALE_SEC;
  const hintGraceCutoff = now - LIVE_HINT_GRACE_SEC;
  const normalized = normalizeStaleLiveStatus(parsed, staleCutoff, hintGraceCutoff);
  streamDirectoryStore.streamsByKey.set(streamKey, normalized);
  applyStreamSnapshot();
}

function mergeFallbackStreams(streams: StreamAnnounce[]) {
  if (!Array.isArray(streams) || streams.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  const staleCutoff = now - LIVE_STALE_SEC;
  const hintGraceCutoff = now - LIVE_HINT_GRACE_SEC;

  for (const parsed of streams) {
    if (!parsed || typeof parsed !== "object") continue;
    if (typeof parsed.pubkey !== "string" || typeof parsed.streamId !== "string") continue;
    if (!Number.isFinite(parsed.createdAt)) continue;
    const streamKey = makeStreamKey(parsed.pubkey, parsed.streamId);
    const prevCreatedAt = streamDirectoryStore.seen.get(streamKey);
    if (prevCreatedAt && prevCreatedAt >= parsed.createdAt) continue;
    streamDirectoryStore.seen.set(streamKey, parsed.createdAt);
    if (!streamDirectoryStore.orderMeta.has(streamKey)) {
      streamDirectoryStore.orderMeta.set(streamKey, {
        firstSeenAt: parsed.createdAt,
        seq: streamDirectoryStore.orderSeq++
      });
    }
    const normalized = normalizeStaleLiveStatus(parsed, staleCutoff, hintGraceCutoff);
    streamDirectoryStore.streamsByKey.set(streamKey, normalized);
  }

  applyStreamSnapshot();
}

async function hydrateFromServerSnapshotFallback() {
  const nowMs = Date.now();
  if (streamDirectoryStore.fallbackInFlight) {
    await streamDirectoryStore.fallbackInFlight;
    return;
  }
  if (nowMs - streamDirectoryStore.fallbackLastAtMs < STREAM_DISCOVERY_SERVER_FALLBACK_COOLDOWN_MS) return;

  streamDirectoryStore.fallbackLastAtMs = nowMs;
  streamDirectoryStore.fallbackInFlight = (async () => {
    try {
      const response = await fetch("/api/discovery/snapshot?days=45&limit=360", {
        method: "GET",
        cache: "no-store"
      });
      if (!response.ok) return;
      const payload = await response.json();
      mergeFallbackStreams(Array.isArray(payload?.streams) ? payload.streams : []);
    } catch {
      // ignore fallback errors
    } finally {
      streamDirectoryStore.fallbackInFlight = null;
      emitSnapshot({ isLoading: false });
    }
  })();

  await streamDirectoryStore.fallbackInFlight;
}

function closeDirectorySubscription() {
  if (streamDirectoryStore.connectTimeout) {
    clearTimeout(streamDirectoryStore.connectTimeout);
    streamDirectoryStore.connectTimeout = null;
  }
  if (streamDirectoryStore.sub) {
    try {
      streamDirectoryStore.sub.close?.();
    } catch {
      // ignore
    }
    streamDirectoryStore.sub = null;
  }
}

function connectDirectoryFeed() {
  closeDirectorySubscription();
  if (streamDirectoryStore.relays.length === 0) {
    emitSnapshot({ isLoading: false });
    return;
  }

  if (streamDirectoryStore.snapshot.streams.length === 0) {
    emitSnapshot({ isLoading: true });
  }

  const filters: Filter[] = [
    {
      kinds: [NOSTR_KINDS.STREAM_ANNOUNCE],
      since: Math.floor(Date.now() / 1000) - STREAM_ANNOUNCE_LOOKBACK_ALL_SEC,
      limit: Math.max(STREAM_ANNOUNCE_MIN_LIMIT_ALL, STREAM_CACHE_MAX_ITEMS * 2)
    }
  ];

  if (streamDirectoryStore.operatorPubkeys.length > 0) {
    filters.push({
      kinds: [NOSTR_KINDS.APP_DISCOVERY_MOD],
      authors: streamDirectoryStore.operatorPubkeys,
      since: Math.floor(Date.now() / 1000) - DISCOVERY_POLICY_LOOKBACK_SEC,
      limit: DISCOVERY_POLICY_LIMIT
    });
  }

  streamDirectoryStore.sub = subscribeMany(streamDirectoryStore.relays, filters, {
    onevent: (event: any) => {
      if (event?.kind === NOSTR_KINDS.APP_DISCOVERY_MOD) {
        updateDiscoveryPolicy(event);
        return;
      }
      updateStreamAnnounce(event);
    },
    oneose: () => {
      emitSnapshot({ isLoading: false });
      if (streamDirectoryStore.streamsByKey.size === 0) {
        void hydrateFromServerSnapshotFallback();
      }
    }
  }) as { close?: () => void };
  streamDirectoryStore.connectTimeout = setTimeout(() => {
    emitSnapshot({ isLoading: false });
    if (streamDirectoryStore.streamsByKey.size === 0) {
      void hydrateFromServerSnapshotFallback();
    }
  }, STREAM_DISCOVERY_TIMEOUT_MS);
}

function startDirectoryFeed(relays: string[], operatorPubkeys: string[]) {
  const relaysChanged =
    relays.length !== streamDirectoryStore.relays.length ||
    relays.some((relay, index) => relay !== streamDirectoryStore.relays[index]);
  const operatorsChanged =
    operatorPubkeys.length !== streamDirectoryStore.operatorPubkeys.length ||
    operatorPubkeys.some((pubkey, index) => pubkey !== streamDirectoryStore.operatorPubkeys[index]);

  if (relaysChanged) {
    streamDirectoryStore.relays = [...relays];
  }
  if (operatorsChanged) {
    streamDirectoryStore.operatorPubkeys = [...operatorPubkeys];
  }

  if (relaysChanged || operatorsChanged || !streamDirectoryStore.sub) {
    connectDirectoryFeed();
  }

  if (!streamDirectoryStore.pruneInterval) {
    streamDirectoryStore.pruneInterval = setInterval(() => applyStreamSnapshot(), LIVE_PRUNE_INTERVAL_MS);
  }
  if (!streamDirectoryStore.refreshInterval) {
    streamDirectoryStore.refreshInterval = setInterval(() => connectDirectoryFeed(), STREAM_CACHE_REFRESH_MS);
  }
}

function stopDirectoryFeed() {
  closeDirectorySubscription();
  if (streamDirectoryStore.pruneInterval) {
    clearInterval(streamDirectoryStore.pruneInterval);
    streamDirectoryStore.pruneInterval = null;
  }
  if (streamDirectoryStore.refreshInterval) {
    clearInterval(streamDirectoryStore.refreshInterval);
    streamDirectoryStore.refreshInterval = null;
  }
}

function acquireDirectoryFeed(relays: string[], operatorPubkeys: string[]) {
  streamDirectoryStore.consumers += 1;
  startDirectoryFeed(relays, operatorPubkeys);
}

function releaseDirectoryFeed() {
  streamDirectoryStore.consumers = Math.max(0, streamDirectoryStore.consumers - 1);
  if (streamDirectoryStore.consumers === 0) {
    stopDirectoryFeed();
  }
}

function subscribeToDirectory(listener: () => void) {
  streamDirectoryStore.listeners.add(listener);
  return () => {
    streamDirectoryStore.listeners.delete(listener);
  };
}

export function useStreamAnnounces({
  enabled = true,
  liveOnly = true,
  limit = 50,
  includeHidden = false,
  includeMature = true,
  viewerPubkey = null
}: UseStreamAnnouncesOptions = {}) {
  const [directorySnapshot, setDirectorySnapshot] = useState<StreamDirectorySnapshot>(streamDirectoryStore.snapshot);

  const relays = useMemo(() => getNostrRelays(), []);
  const operatorPubkeys = useMemo(() => getDiscoveryOperatorPubkeys(), []);

  useEffect(() => {
    const unsubscribe = subscribeToDirectory(() => {
      setDirectorySnapshot(streamDirectoryStore.snapshot);
    });
    setDirectorySnapshot(streamDirectoryStore.snapshot);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    acquireDirectoryFeed(relays, operatorPubkeys);
    return () => {
      releaseDirectoryFeed();
    };
  }, [enabled, relays, operatorPubkeys]);

  const streams = useMemo(() => {
    if (!enabled) return [];
    const normalizedViewerPubkey = (viewerPubkey ?? "").trim().toLowerCase();
    const allStreams = directorySnapshot.streams;
    const hiddenPubkeyPolicies = directorySnapshot.hiddenPubkeyPolicies;
    const hiddenStreamPolicies = directorySnapshot.hiddenStreamPolicies;

    if (includeHidden) {
      return allStreams
        .filter((stream) => {
          if (!liveOnly) return true;
          return stream.status === "live";
        })
        .slice(0, limit);
    }
    return allStreams
      .filter((stream) => {
        if (liveOnly && stream.status !== "live") return false;
        if (!stream.discoverable) return false;
        if (!includeMature && stream.matureContent) return false;
        const streamPubkey = stream.pubkey.toLowerCase();
        if (stream.viewerAllowPubkeys.length > 0) {
          if (!normalizedViewerPubkey) return false;
          if (normalizedViewerPubkey !== streamPubkey && !stream.viewerAllowPubkeys.includes(normalizedViewerPubkey)) {
            return false;
          }
        }
        const pubkeyPolicy = hiddenPubkeyPolicies.get(streamPubkey);
        if (pubkeyPolicy?.hidden) return false;
        const streamPolicy = hiddenStreamPolicies.get(makeStreamKey(streamPubkey, stream.streamId));
        if (streamPolicy?.hidden) return false;
        return true;
      })
      .slice(0, limit);
  }, [directorySnapshot, enabled, includeHidden, includeMature, limit, liveOnly, viewerPubkey]);

  return {
    streams,
    isLoading: enabled ? directorySnapshot.isLoading : false,
    liveCount: streams.length
  };
}
