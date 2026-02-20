"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { makeStreamKey, NOSTR_KINDS, parseDiscoveryModerationEvent, parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getDiscoveryOperatorPubkeys, getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

interface UseStreamAnnouncesOptions {
  liveOnly?: boolean;
  limit?: number;
  includeHidden?: boolean;
  includeMature?: boolean;
  viewerPubkey?: string | null;
}

const LIVE_STALE_SEC = 6 * 60 * 60;
const LIVE_PRUNE_INTERVAL_MS = 15_000;
const STREAM_ANNOUNCE_LOOKBACK_LIVE_SEC = 12 * 60 * 60;
const STREAM_ANNOUNCE_LOOKBACK_ALL_SEC = 45 * 24 * 60 * 60;
const STREAM_ANNOUNCE_MIN_LIMIT_LIVE = 120;
const STREAM_ANNOUNCE_MIN_LIMIT_ALL = 320;
const STREAM_ANNOUNCE_LIMIT_MULTIPLIER_LIVE = 4;
const STREAM_ANNOUNCE_LIMIT_MULTIPLIER_ALL = 8;

interface StreamOrderMeta {
  firstSeenAt: number;
  seq: number;
}

function normalizeStaleLiveStatus(stream: StreamAnnounce, staleCutoffSec: number): StreamAnnounce {
  if (stream.status !== "live") return stream;
  if (stream.createdAt >= staleCutoffSec) return stream;
  return { ...stream, status: "ended" };
}

function sortStreamsStable(
  streams: StreamAnnounce[],
  staleCutoffSec: number,
  orderMeta: Map<string, StreamOrderMeta>
) {
  return streams.slice().sort((a, b) => {
    const aLive = a.status === "live" && a.createdAt >= staleCutoffSec;
    const bLive = b.status === "live" && b.createdAt >= staleCutoffSec;
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

export function useStreamAnnounces({
  liveOnly = true,
  limit = 50,
  includeHidden = false,
  includeMature = true,
  viewerPubkey = null
}: UseStreamAnnouncesOptions = {}) {
  const [allStreams, setAllStreams] = useState<StreamAnnounce[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hiddenPubkeyPolicies, setHiddenPubkeyPolicies] = useState<Map<string, { hidden: boolean; createdAt: number }>>(new Map());
  const [hiddenStreamPolicies, setHiddenStreamPolicies] = useState<Map<string, { hidden: boolean; createdAt: number }>>(new Map());
  const seen = useRef<Map<string, number>>(new Map());
  const orderMetaRef = useRef<Map<string, StreamOrderMeta>>(new Map());
  const orderSeqRef = useRef(0);
  const discoveryPolicyPubkeys = useRef<Map<string, { hidden: boolean; createdAt: number }>>(new Map());
  const discoveryPolicyStreams = useRef<Map<string, { hidden: boolean; createdAt: number }>>(new Map());

  const relays = useMemo(() => getNostrRelays(), []);
  const operatorPubkeys = useMemo(() => getDiscoveryOperatorPubkeys(), []);

  useEffect(() => {
    setIsLoading(true);

    const fetchLimit = liveOnly
      ? Math.max(STREAM_ANNOUNCE_MIN_LIMIT_LIVE, limit * STREAM_ANNOUNCE_LIMIT_MULTIPLIER_LIVE)
      : Math.max(STREAM_ANNOUNCE_MIN_LIMIT_ALL, limit * STREAM_ANNOUNCE_LIMIT_MULTIPLIER_ALL);

    const filters: Filter[] = [
      {
        kinds: [NOSTR_KINDS.STREAM_ANNOUNCE],
        since: Math.floor(Date.now() / 1000) - (liveOnly ? STREAM_ANNOUNCE_LOOKBACK_LIVE_SEC : STREAM_ANNOUNCE_LOOKBACK_ALL_SEC),
        limit: fetchLimit
      }
    ];

    if (operatorPubkeys.length > 0) {
      filters.push({
        kinds: [NOSTR_KINDS.APP_DISCOVERY_MOD],
        authors: operatorPubkeys,
        since: Math.floor(Date.now() / 1000) - 14 * 86400,
        limit: 2000
      });
    }

    const sub = subscribeMany(relays, filters, {
      onevent: (event: any) => {
        if (event?.kind === NOSTR_KINDS.APP_DISCOVERY_MOD) {
          const parsedPolicy = parseDiscoveryModerationEvent(event);
          if (!parsedPolicy) return;

          const key =
            parsedPolicy.targetType === "pubkey"
              ? parsedPolicy.targetPubkey
              : makeStreamKey(parsedPolicy.targetPubkey, parsedPolicy.targetStreamId ?? "");
          const next = { hidden: parsedPolicy.action === "hide", createdAt: parsedPolicy.createdAt };
          const map = parsedPolicy.targetType === "pubkey" ? discoveryPolicyPubkeys.current : discoveryPolicyStreams.current;
          const prev = map.get(key);
          if (!prev || parsedPolicy.createdAt >= prev.createdAt) {
            map.set(key, next);
            if (parsedPolicy.targetType === "pubkey") {
              setHiddenPubkeyPolicies(new Map(discoveryPolicyPubkeys.current));
            } else {
              setHiddenStreamPolicies(new Map(discoveryPolicyStreams.current));
            }
          }
          return;
        }

        const parsed = parseStreamAnnounceEvent(event);
        if (!parsed) return;

        const key = makeStreamKey(parsed.pubkey, parsed.streamId);
        const prevCreatedAt = seen.current.get(key);
        if (prevCreatedAt && prevCreatedAt >= parsed.createdAt) return;
        seen.current.set(key, parsed.createdAt);
        if (!orderMetaRef.current.has(key)) {
          orderMetaRef.current.set(key, {
            firstSeenAt: parsed.createdAt,
            seq: orderSeqRef.current++
          });
        }

        setAllStreams((prev) => {
          const now = Math.floor(Date.now() / 1000);
          const staleCutoff = now - LIVE_STALE_SEC;
          const normalizedParsed = normalizeStaleLiveStatus(parsed, staleCutoff);
          const map = new Map<string, StreamAnnounce>();
          for (const s of prev) {
            const normalized = normalizeStaleLiveStatus(s, staleCutoff);
            map.set(makeStreamKey(normalized.pubkey, normalized.streamId), normalized);
          }

          if (normalizedParsed.status === "live") {
            if (!liveOnly || normalizedParsed.createdAt >= staleCutoff) {
              map.set(key, normalizedParsed);
            }
          } else if (liveOnly) {
            map.delete(key);
            orderMetaRef.current.delete(key);
            seen.current.delete(key);
          } else {
            map.set(key, normalizedParsed);
          }

          if (liveOnly) {
            for (const [streamKey, stream] of map) {
              if (stream.status !== "live" || stream.createdAt < staleCutoff) {
                map.delete(streamKey);
                orderMetaRef.current.delete(streamKey);
                seen.current.delete(streamKey);
              }
            }
          }

          const next = sortStreamsStable(Array.from(map.values()), staleCutoff, orderMetaRef.current);
          return next.slice(0, limit * 4);
        });
      },
      oneose: () => setIsLoading(false)
    });

    const pruneInterval = setInterval(() => {
      const staleCutoff = Math.floor(Date.now() / 1000) - LIVE_STALE_SEC;
      setAllStreams((prev) => {
        const normalized = prev.map((stream) => normalizeStaleLiveStatus(stream, staleCutoff));
        if (liveOnly) {
          const filtered = normalized.filter((stream) => stream.status === "live" && stream.createdAt >= staleCutoff);
          const activeKeys = new Set(filtered.map((stream) => makeStreamKey(stream.pubkey, stream.streamId)));
          for (const key of Array.from(orderMetaRef.current.keys())) {
            if (!activeKeys.has(key)) {
              orderMetaRef.current.delete(key);
              seen.current.delete(key);
            }
          }
          return sortStreamsStable(filtered, staleCutoff, orderMetaRef.current).slice(0, limit * 4);
        }
        return sortStreamsStable(normalized, staleCutoff, orderMetaRef.current).slice(0, limit * 4);
      });
    }, LIVE_PRUNE_INTERVAL_MS);

    const timeout = setTimeout(() => setIsLoading(false), 4000);

    return () => {
      clearInterval(pruneInterval);
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [relays, liveOnly, limit, includeHidden, operatorPubkeys]);

  const streams = useMemo(() => {
    const staleCutoff = Math.floor(Date.now() / 1000) - LIVE_STALE_SEC;
    const normalizedViewerPubkey = (viewerPubkey ?? "").trim().toLowerCase();
    if (includeHidden) {
      return allStreams
        .filter((stream) => {
          if (!liveOnly) return true;
          return stream.status === "live" && stream.createdAt >= staleCutoff;
        })
        .slice(0, limit);
    }
    return allStreams
      .filter((stream) => {
        if (liveOnly && (stream.status !== "live" || stream.createdAt < staleCutoff)) return false;
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
  }, [allStreams, includeHidden, includeMature, hiddenPubkeyPolicies, hiddenStreamPolicies, limit, liveOnly, viewerPubkey]);

  return {
    streams,
    isLoading,
    liveCount: streams.length
  };
}
