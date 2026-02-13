"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { makeStreamKey, parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

interface UseStreamAnnouncesOptions {
  liveOnly?: boolean;
  limit?: number;
}

export function useStreamAnnounces({ liveOnly = true, limit = 50 }: UseStreamAnnouncesOptions = {}) {
  const [streams, setStreams] = useState<StreamAnnounce[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const seen = useRef<Map<string, number>>(new Map());

  const relays = useMemo(() => getNostrRelays(), []);

  useEffect(() => {
    setIsLoading(true);

    const filter: Filter = {
      kinds: [30311],
      since: Math.floor(Date.now() / 1000) - 86400,
      limit: limit * 2
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseStreamAnnounceEvent(event);
        if (!parsed) return;
        if (liveOnly && parsed.status !== "live") return;

        const key = makeStreamKey(parsed.pubkey, parsed.streamId);
        const prevCreatedAt = seen.current.get(key);
        if (prevCreatedAt && prevCreatedAt >= parsed.createdAt) return;
        seen.current.set(key, parsed.createdAt);

        setStreams((prev) => {
          const map = new Map<string, StreamAnnounce>();
          for (const s of prev) map.set(makeStreamKey(s.pubkey, s.streamId), s);
          map.set(key, parsed);

          const next = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
          return next.slice(0, limit);
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
  }, [relays, liveOnly, limit]);

  return {
    streams,
    isLoading,
    liveCount: streams.length
  };
}

