"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

const STREAM_ANNOUNCE_LOOKBACK_SEC = 180 * 24 * 60 * 60;
const STREAM_ANNOUNCE_HISTORY_LIMIT = 60;

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
  }, [relays, pubkey, streamId]);

  return { announce, isLoading };
}
