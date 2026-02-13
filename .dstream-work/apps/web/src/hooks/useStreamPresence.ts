"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { makeATag, parseStreamPresenceEvent } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

export function useStreamPresence(scope: { streamPubkey: string; streamId: string; windowSec?: number }) {
  const relays = useMemo(() => getNostrRelays(), []);
  const streamPubkey = scope.streamPubkey;
  const streamId = scope.streamId;
  const windowSec = scope.windowSec ?? 90;

  const [viewerCount, setViewerCount] = useState(0);
  const [viewerPubkeys, setViewerPubkeys] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const firstSeenRef = useRef<Map<string, number>>(new Map());

  const recompute = useCallback(() => {
    const rows = Array.from(lastSeenRef.current.entries())
      .map(([pubkey, lastSeen]) => ({
        pubkey,
        lastSeen,
        firstSeen: firstSeenRef.current.get(pubkey) ?? lastSeen
      }))
      .sort((a, b) => {
        const byFirst = a.firstSeen - b.firstSeen;
        if (byFirst !== 0) return byFirst;
        return a.pubkey.localeCompare(b.pubkey);
      });

    setViewerCount(rows.length);
    setViewerPubkeys(rows.map((row) => row.pubkey));
  }, []);

  const prune = useCallback(() => {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - windowSec;
    let changed = false;

    for (const [pk, last] of lastSeenRef.current.entries()) {
      if (last < cutoff) {
        lastSeenRef.current.delete(pk);
        firstSeenRef.current.delete(pk);
        changed = true;
      }
    }

    if (changed) recompute();
  }, [recompute, windowSec]);

  useEffect(() => {
    if (!streamPubkey || !streamId) return;

    setIsConnected(false);
    setViewerCount(0);
    setViewerPubkeys([]);
    lastSeenRef.current.clear();
    firstSeenRef.current.clear();

    const filter: Filter = {
      kinds: [30312],
      "#a": [makeATag(streamPubkey, streamId)],
      since: Math.floor(Date.now() / 1000) - windowSec * 4,
      limit: 500
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseStreamPresenceEvent(event, { streamPubkey, streamId });
        if (!parsed) return;

        const prev = lastSeenRef.current.get(parsed.pubkey) ?? 0;
        if (parsed.createdAt <= prev) return;
        const firstSeenPrev = firstSeenRef.current.get(parsed.pubkey);
        if (typeof firstSeenPrev === "number") {
          if (parsed.createdAt < firstSeenPrev) firstSeenRef.current.set(parsed.pubkey, parsed.createdAt);
        } else {
          firstSeenRef.current.set(parsed.pubkey, parsed.createdAt);
        }
        lastSeenRef.current.set(parsed.pubkey, parsed.createdAt);
        recompute();
        prune();
      },
      oneose: () => setIsConnected(true)
    });

    const interval = setInterval(prune, 10_000);

    return () => {
      clearInterval(interval);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
      setIsConnected(false);
    };
  }, [prune, recompute, relays, streamId, streamPubkey, windowSec]);

  return { viewerCount, viewerPubkeys, isConnected };
}
