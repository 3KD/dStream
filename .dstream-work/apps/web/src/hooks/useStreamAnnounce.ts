"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Event as NostrEvent, Filter } from "nostr-tools";
import { parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

export function useStreamAnnounce(pubkey: string, streamId: string) {
  const [announce, setAnnounce] = useState<StreamAnnounce | null>(null);
  const [announceEvent, setAnnounceEvent] = useState<NostrEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const latestRef = useRef<{ createdAt: number; eventId: string } | null>(null);

  const relays = useMemo(() => getNostrRelays(), []);

  useEffect(() => {
    if (!pubkey || !streamId) {
      setAnnounce(null);
      setAnnounceEvent(null);
      setIsLoading(false);
      latestRef.current = null;
      return;
    }
    setIsLoading(true);
    setAnnounce(null);
    setAnnounceEvent(null);
    latestRef.current = null;

    const filter: Filter = {
      kinds: [30311],
      authors: [pubkey],
      "#d": [streamId],
      since: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
      limit: 1
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseStreamAnnounceEvent(event);
        if (!parsed) return;
        if (parsed.pubkey !== pubkey || parsed.streamId !== streamId) return;
        const eventId = typeof event?.id === "string" ? event.id : "";
        const latest = latestRef.current;
        if (
          latest &&
          (parsed.createdAt < latest.createdAt ||
            (parsed.createdAt === latest.createdAt && eventId <= latest.eventId))
        ) {
          return;
        }
        latestRef.current = { createdAt: parsed.createdAt, eventId };
        setAnnounce(parsed);
        setAnnounceEvent(event as NostrEvent);
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

  return { announce, announceEvent, isLoading };
}
