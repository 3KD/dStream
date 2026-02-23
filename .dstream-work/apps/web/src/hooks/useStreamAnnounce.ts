"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

const STREAM_ANNOUNCE_LOOKBACK_SEC = 180 * 24 * 60 * 60;
const STREAM_ANNOUNCE_HISTORY_LIMIT = 60;
const STREAM_ANNOUNCE_FALLBACK_TIMEOUT_MS = 4000;

interface DiscoverySnapshotResponse {
  streams?: unknown[];
}

function isLikelyFallbackHlsPath(url: string): boolean {
  const value = url.trim();
  if (!value.startsWith("/")) return false;
  return /^\/api\/hls\/.+\/index\.m3u8(?:\?.*)?$/i.test(value);
}

function hasPreferredPlaybackHint(value: StreamAnnounce | null | undefined): boolean {
  if (!value) return false;
  if (typeof value.streaming === "string") {
    const streaming = value.streaming.trim();
    if (streaming && !isLikelyFallbackHlsPath(streaming)) return true;
  }
  if (Array.isArray(value.renditions)) {
    return value.renditions.some((rendition) => {
      if (typeof rendition?.url !== "string") return false;
      const url = rendition.url.trim();
      if (!url) return false;
      return !isLikelyFallbackHlsPath(url);
    });
  }
  return false;
}

function parseFallbackStream(value: unknown): StreamAnnounce | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StreamAnnounce>;
  const createdAt = Number(candidate.createdAt);
  if (typeof candidate.pubkey !== "string") return null;
  if (typeof candidate.streamId !== "string") return null;
  if (typeof candidate.title !== "string") return null;
  if (candidate.status !== "live" && candidate.status !== "ended") return null;
  if (!Number.isFinite(createdAt)) return null;

  return {
    pubkey: candidate.pubkey,
    streamId: candidate.streamId,
    title: candidate.title,
    status: candidate.status,
    summary: typeof candidate.summary === "string" ? candidate.summary : undefined,
    image: typeof candidate.image === "string" ? candidate.image : undefined,
    streaming: typeof candidate.streaming === "string" ? candidate.streaming : undefined,
    xmr: typeof candidate.xmr === "string" ? candidate.xmr : undefined,
    hostMode: candidate.hostMode ?? "p2p_economy",
    rebroadcastThreshold: Number.isFinite(candidate.rebroadcastThreshold) ? candidate.rebroadcastThreshold : undefined,
    streamChatSlowModeSec: Number.isFinite(candidate.streamChatSlowModeSec) ? candidate.streamChatSlowModeSec : undefined,
    streamChatSubscriberOnly: typeof candidate.streamChatSubscriberOnly === "boolean" ? candidate.streamChatSubscriberOnly : false,
    streamChatFollowerOnly: typeof candidate.streamChatFollowerOnly === "boolean" ? candidate.streamChatFollowerOnly : false,
    discoverable: typeof candidate.discoverable === "boolean" ? candidate.discoverable : true,
    matureContent: typeof candidate.matureContent === "boolean" ? candidate.matureContent : false,
    viewerAllowPubkeys: Array.isArray(candidate.viewerAllowPubkeys) ? candidate.viewerAllowPubkeys : [],
    vodArchiveEnabled: typeof candidate.vodArchiveEnabled === "boolean" ? candidate.vodArchiveEnabled : undefined,
    vodVisibility: candidate.vodVisibility ?? "public",
    feeWaiverGuilds: Array.isArray(candidate.feeWaiverGuilds) ? candidate.feeWaiverGuilds : [],
    feeWaiverVipPubkeys: Array.isArray(candidate.feeWaiverVipPubkeys) ? candidate.feeWaiverVipPubkeys : [],
    manifestSignerPubkey:
      typeof candidate.manifestSignerPubkey === "string" ? candidate.manifestSignerPubkey : undefined,
    stakeAmountAtomic: typeof candidate.stakeAmountAtomic === "string" ? candidate.stakeAmountAtomic : undefined,
    stakeNote: typeof candidate.stakeNote === "string" ? candidate.stakeNote : undefined,
    payments: Array.isArray(candidate.payments) ? candidate.payments : [],
    captions: Array.isArray(candidate.captions) ? candidate.captions : [],
    renditions: Array.isArray(candidate.renditions) ? candidate.renditions : [],
    topics: Array.isArray(candidate.topics) ? candidate.topics : [],
    createdAt,
    raw: (candidate.raw as StreamAnnounce["raw"]) ?? {
      kind: 30311,
      pubkey: candidate.pubkey,
      created_at: createdAt,
      tags: [],
      content: ""
    }
  };
}

export function useStreamAnnounce(pubkey: string, streamId: string) {
  const [announce, setAnnounce] = useState<StreamAnnounce | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const latestRef = useRef<number>(0);

  const relays = useMemo(() => getNostrRelays(), []);

  useEffect(() => {
    if (!pubkey || !streamId) {
      setAnnounce(null);
      setIsLoading(false);
      latestRef.current = 0;
      return;
    }
    setIsLoading(true);
    setAnnounce(null);
    latestRef.current = 0;
    let stopped = false;

    const applyFallbackFromSnapshot = async () => {
      if (stopped) return;
      try {
        const response = await fetch("/api/discovery/snapshot", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as DiscoverySnapshotResponse;
        const streams = Array.isArray(data?.streams) ? data.streams : [];
        let candidate: StreamAnnounce | null = null;
        for (const item of streams) {
          const parsed = parseFallbackStream(item);
          if (!parsed) continue;
          if (parsed.pubkey !== pubkey || parsed.streamId !== streamId) continue;
          if (!candidate || parsed.createdAt > candidate.createdAt) {
            candidate = parsed;
          }
        }
        if (!candidate) return;
        setAnnounce((previous) => {
          const previousCreatedAt = previous?.createdAt ?? 0;
          const candidateCreatedAt = candidate.createdAt;
          const previousHasPlayback = hasPreferredPlaybackHint(previous);
          const candidateHasPlayback = hasPreferredPlaybackHint(candidate);
          const shouldReplace =
            !previous ||
            candidateCreatedAt > previousCreatedAt ||
            (!previousHasPlayback && candidateHasPlayback) ||
            (previous.status !== "live" && candidate.status === "live");
          if (!shouldReplace) return previous;
          latestRef.current = Math.max(latestRef.current, candidateCreatedAt);
          return candidate;
        });
      } catch {
        // ignore fallback errors
      }
    };

    const filter: Filter = {
      kinds: [30311],
      authors: [pubkey],
      "#d": [streamId],
      since: Math.floor(Date.now() / 1000) - STREAM_ANNOUNCE_LOOKBACK_SEC,
      limit: STREAM_ANNOUNCE_HISTORY_LIMIT
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseStreamAnnounceEvent(event);
        if (!parsed) return;
        if (parsed.pubkey !== pubkey || parsed.streamId !== streamId) return;
        if (parsed.createdAt <= latestRef.current) return;
        latestRef.current = parsed.createdAt;
        setAnnounce(parsed);
      },
      oneose: () => {
        setIsLoading(false);
        void applyFallbackFromSnapshot();
      }
    });

    const timeout = setTimeout(() => {
      setIsLoading(false);
      void applyFallbackFromSnapshot();
    }, STREAM_ANNOUNCE_FALLBACK_TIMEOUT_MS);

    return () => {
      stopped = true;
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [relays, pubkey, streamId]);

  return { announce, isLoading };
}
