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

    let cancelled = false;
    let lookupSettled = false;
    let relaySettled = false;
    const finishLoadingIfSettled = () => {
      if (cancelled) return;
      if (latestRef.current || (lookupSettled && relaySettled)) setIsLoading(false);
    };
    const applyCandidate = (parsed: StreamAnnounce, event: NostrEvent | null) => {
      if (cancelled) return;
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
      setAnnounceEvent(event);
      setIsLoading(false);
    };

    const lookupController = new AbortController();
    void (async () => {
      try {
        const params = new URLSearchParams({ pubkey, streamId });
        const response = await fetch(`/api/discovery/stream?${params.toString()}`, {
          cache: "no-store",
          signal: lookupController.signal
        });
        if (!response.ok) return;
        const payload = await response.json();
        const match = payload?.announce as StreamAnnounce | undefined;
        if (!match || !Number.isFinite(match.createdAt)) return;
        const raw = match.raw;
        const rawEvent =
          raw && raw.kind === 30311 && raw.pubkey === pubkey && Array.isArray(raw.tags)
            ? (raw as NostrEvent)
            : null;
        applyCandidate(match, rawEvent);
      } catch {
        // Direct relay delivery remains the source-of-truth fallback.
      } finally {
        lookupSettled = true;
        finishLoadingIfSettled();
      }
    })();

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
        applyCandidate(parsed, event as NostrEvent);
      },
      oneose: () => {
        relaySettled = true;
        finishLoadingIfSettled();
      }
    });

    const timeout = setTimeout(() => {
      relaySettled = true;
      finishLoadingIfSettled();
    }, 4000);

    return () => {
      cancelled = true;
      lookupController.abort();
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
