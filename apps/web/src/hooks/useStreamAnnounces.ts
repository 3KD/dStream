"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { makeStreamKey, parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { isLikelyPlayableMediaUrl } from "@/lib/mediaUrl";
import { subscribeMany } from "@/lib/nostr";

interface UseStreamAnnouncesOptions {
  liveOnly?: boolean;
  limit?: number;
  liveWindowSec?: number;
  maxPerPubkey?: number;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function compressByPubkey(streams: StreamAnnounce[], maxPerPubkey: number): StreamAnnounce[] {
  if (maxPerPubkey < 1 || !Number.isFinite(maxPerPubkey)) return streams;
  if (maxPerPubkey >= streams.length) return streams;

  const counts = new Map<string, number>();
  const out: StreamAnnounce[] = [];
  for (const stream of streams) {
    const used = counts.get(stream.pubkey) ?? 0;
    if (used >= maxPerPubkey) continue;
    counts.set(stream.pubkey, used + 1);
    out.push(stream);
  }
  return out;
}

const ORIGIN_STREAM_ID_PATTERN = /^[0-9a-f]{64}--(.+)$/i;
const TRANSCODE_VARIANT_PATTERN = /__r\d+p$/i;

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
    // Ignore parse errors and fall through to lightweight extraction.
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

function streamQualityScore(stream: StreamAnnounce): number {
  const url = (stream.streaming ?? "").trim().toLowerCase();
  const image = (stream.image ?? "").trim();
  let score = 0;
  // Prefer announces that are directly aligned with production playback and have card imagery.
  if (url.includes("dstream.stream/stream/")) score += 8;
  else if (url.includes("/stream/")) score += 2;
  if (url.includes("--")) score += 3;
  if (url.includes("/index.m3u8") || url.endsWith(".m3u8")) score += 2;
  if (url.includes("trycloudflare.com") || url.includes("host.docker.internal") || url.includes("localhost")) score -= 8;
  if (image) score += 4;
  const ageSec = Math.max(0, nowSec() - stream.createdAt);
  if (ageSec <= 120) score += 3;
  else if (ageSec <= 600) score += 1;
  else if (ageSec > 1800) score -= 2;
  return score;
}

function chooseBetterStream(current: StreamAnnounce, candidate: StreamAnnounce): StreamAnnounce {
  const currentScore = streamQualityScore(current);
  const candidateScore = streamQualityScore(candidate);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current;
  }
  if (candidate.createdAt !== current.createdAt) {
    return candidate.createdAt > current.createdAt ? candidate : current;
  }
  return current;
}

function dedupeByStreamId(streams: StreamAnnounce[]): StreamAnnounce[] {
  const byId = new Map<string, StreamAnnounce>();
  for (const stream of streams) {
    const key = canonicalStreamKey(stream);
    if (!key) continue;
    const existing = byId.get(key);
    byId.set(key, existing ? chooseBetterStream(existing, stream) : stream);
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function useStreamAnnounces({
  liveOnly = true,
  limit = 50,
  liveWindowSec = 900,
  maxPerPubkey
}: UseStreamAnnouncesOptions = {}) {
  const [streams, setStreams] = useState<StreamAnnounce[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const seen = useRef<Map<string, number>>(new Map());
  const maxByPubkey = maxPerPubkey ?? Number.POSITIVE_INFINITY;

  const relays = useMemo(() => getNostrRelays(), []);

  useEffect(() => {
    setIsLoading(true);
    setStreams([]);
    seen.current = new Map();

    const filter: Filter = {
      kinds: [30311],
      since: nowSec() - 86400,
      limit: limit * 2
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseStreamAnnounceEvent(event);
        if (!parsed) return;
        const key = makeStreamKey(parsed.pubkey, parsed.streamId);

        if (liveOnly) {
          // If an active stream is marked ended, remove it from the current live set immediately.
          if (parsed.status === "ended") {
            seen.current.delete(key);
            setStreams((prev) => {
              const map = new Map<string, StreamAnnounce>();
              for (const s of prev) map.set(makeStreamKey(s.pubkey, s.streamId), s);
              map.delete(key);

              const sorted = Array.from(map.values())
                .filter((value) => value.createdAt >= nowSec() - liveWindowSec)
                .sort((a, b) => b.createdAt - a.createdAt);
              const uniqueByStreamId = dedupeByStreamId(sorted);
              const compacted = compressByPubkey(uniqueByStreamId, maxByPubkey);
              return compacted.slice(0, limit);
            });
            return;
          }
          if (parsed.status !== "live") return;
          if (parsed.createdAt < nowSec() - liveWindowSec) return;
          if (!isLikelyPlayableMediaUrl(parsed.streaming)) return;
        }

        const prevCreatedAt = seen.current.get(key);
        if (prevCreatedAt && prevCreatedAt >= parsed.createdAt) return;
        seen.current.set(key, parsed.createdAt);

        setStreams((prev) => {
          const map = new Map<string, StreamAnnounce>();
          for (const s of prev) map.set(makeStreamKey(s.pubkey, s.streamId), s);
          map.set(key, parsed);

          const sorted = Array.from(map.values())
            .filter((value) => !liveOnly || value.createdAt >= nowSec() - liveWindowSec)
            .sort((a, b) => b.createdAt - a.createdAt);
          const uniqueByStreamId = dedupeByStreamId(sorted);
          const compacted = compressByPubkey(uniqueByStreamId, maxByPubkey);
          return compacted.slice(0, limit);
        });
      },
      oneose: () => setIsLoading(false)
    });

    const timeout = setTimeout(() => setIsLoading(false), 4000);

    return () => {
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [relays, liveOnly, limit, liveWindowSec, maxByPubkey]);

  useEffect(() => {
    if (!liveOnly) return;

    const prune = () => {
      const cutoff = nowSec() - liveWindowSec;
      setStreams((prev) => {
        const filtered = prev.filter((s) => s.createdAt >= cutoff);
        if (filtered.length === prev.length) return prev;

        seen.current = new Map(
          filtered.map((value) => [makeStreamKey(value.pubkey, value.streamId), value.createdAt] as const)
        );
        const sorted = filtered.sort((a, b) => b.createdAt - a.createdAt);
        return compressByPubkey(dedupeByStreamId(sorted), maxByPubkey).slice(0, limit);
      });
    };

    prune();
    const interval = setInterval(prune, 15_000);
    return () => clearInterval(interval);
  }, [liveOnly, liveWindowSec, maxByPubkey, limit]);

  return {
    streams,
    isLoading,
    liveCount: streams.length
  };
}
