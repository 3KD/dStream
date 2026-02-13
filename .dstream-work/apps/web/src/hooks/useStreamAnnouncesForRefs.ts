"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { makeStreamKey, parseStreamAnnounceEvent, type StreamAnnounce, NOSTR_KINDS } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function isHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export function useStreamAnnouncesForRefs(
  refs: Array<{ streamPubkey: string; streamId: string }>,
  opts?: { sinceSec?: number; maxStreams?: number }
) {
  const [streamsByKey, setStreamsByKey] = useState<Record<string, StreamAnnounce>>({});
  const [isLoading, setIsLoading] = useState(true);
  const seen = useRef<Map<string, number>>(new Map());

  const relays = useMemo(() => getNostrRelays(), []);

  const normalized = useMemo(() => {
    const max = opts?.maxStreams ?? 80;
    const map = new Map<string, { streamPubkey: string; streamId: string }>();
    for (const r of refs ?? []) {
      const pk = (r?.streamPubkey ?? "").trim().toLowerCase();
      const id = (r?.streamId ?? "").trim();
      if (!pk || !id) continue;
      if (!isHex64(pk)) continue;
      const key = makeStreamKey(pk, id);
      if (!map.has(key)) map.set(key, { streamPubkey: pk, streamId: id });
      if (map.size >= max) break;
    }
    return Array.from(map.values());
  }, [opts?.maxStreams, refs]);

  const depsKey = useMemo(() => normalized.map((r) => makeStreamKey(r.streamPubkey, r.streamId)).join("|"), [normalized]);

  useEffect(() => {
    setStreamsByKey({});
    seen.current = new Map();

    if (normalized.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const since = opts?.sinceSec ?? nowSec() - 30 * 24 * 3600;
    const filters: Filter[] = normalized.map((r) => ({
      kinds: [NOSTR_KINDS.STREAM_ANNOUNCE],
      authors: [r.streamPubkey],
      "#d": [r.streamId],
      since,
      limit: 10
    }));

    const sub = subscribeMany(relays, filters, {
      onevent: (event: any) => {
        const parsed = parseStreamAnnounceEvent(event);
        if (!parsed) return;

        const key = makeStreamKey(parsed.pubkey, parsed.streamId);
        const prevCreatedAt = seen.current.get(key);
        if (prevCreatedAt && prevCreatedAt >= parsed.createdAt) return;
        seen.current.set(key, parsed.createdAt);

        setStreamsByKey((prev) => ({ ...prev, [key]: parsed }));
      },
      oneose: () => setIsLoading(false)
    });

    const timeout = setTimeout(() => setIsLoading(false), 4500);

    return () => {
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [depsKey, opts?.sinceSec, normalized, relays]);

  return { streamsByKey, isLoading };
}

