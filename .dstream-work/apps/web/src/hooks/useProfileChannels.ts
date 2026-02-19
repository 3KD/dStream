"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { makeStreamKey, NOSTR_KINDS, parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

interface UseProfileChannelsOptions {
  fetchLimit?: number;
  lookbackDays?: number | null;
}

const DEFAULT_FETCH_LIMIT = 800;

function isHex64(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test((input ?? "").trim());
}

export function useProfileChannels(pubkey?: string | null, options: UseProfileChannelsOptions = {}) {
  const relays = useMemo(() => getNostrRelays(), []);
  const [channels, setChannels] = useState<StreamAnnounce[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const seen = useRef<Map<string, number>>(new Map());

  const fetchLimit = Math.max(80, Math.min(options.fetchLimit ?? DEFAULT_FETCH_LIMIT, 4000));
  const lookbackDays = options.lookbackDays ?? null;
  const normalizedPubkey = (pubkey ?? "").trim().toLowerCase();

  useEffect(() => {
    if (!isHex64(normalizedPubkey)) {
      setChannels([]);
      setIsLoading(false);
      return;
    }

    setChannels([]);
    setIsLoading(true);
    seen.current = new Map();

    const filter: Filter = {
      kinds: [NOSTR_KINDS.STREAM_ANNOUNCE],
      authors: [normalizedPubkey],
      limit: fetchLimit
    };

    if (lookbackDays !== null && Number.isFinite(lookbackDays) && lookbackDays > 0) {
      filter.since = Math.floor(Date.now() / 1000) - Math.floor(lookbackDays * 86400);
    }

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseStreamAnnounceEvent(event);
        if (!parsed) return;
        if (parsed.pubkey !== normalizedPubkey) return;

        const key = makeStreamKey(parsed.pubkey, parsed.streamId);
        const prevCreatedAt = seen.current.get(key);
        if (prevCreatedAt && prevCreatedAt >= parsed.createdAt) return;
        seen.current.set(key, parsed.createdAt);

        setChannels((prev) => {
          const map = new Map<string, StreamAnnounce>();
          for (const row of prev) map.set(makeStreamKey(row.pubkey, row.streamId), row);
          map.set(key, parsed);
          return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
        });
      },
      oneose: () => setIsLoading(false)
    });

    const timeout = setTimeout(() => setIsLoading(false), 7000);

    return () => {
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [fetchLimit, lookbackDays, normalizedPubkey, relays]);

  return { channels, isLoading };
}
