"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { makeGuildKey, parseGuildEvent, type Guild, NOSTR_KINDS } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

interface UseGuildsOptions {
  limit?: number;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function useGuilds({ limit = 50 }: UseGuildsOptions = {}) {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const seen = useRef<Map<string, number>>(new Map());

  const relays = useMemo(() => getNostrRelays(), []);

  useEffect(() => {
    setIsLoading(true);
    setGuilds([]);
    seen.current = new Map();

    const filter: Filter = {
      kinds: [NOSTR_KINDS.GUILD],
      since: nowSec() - 30 * 24 * 3600,
      limit: limit * 3
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseGuildEvent(event);
        if (!parsed) return;

        const key = makeGuildKey(parsed.pubkey, parsed.guildId);
        const prevCreatedAt = seen.current.get(key);
        if (prevCreatedAt && prevCreatedAt >= parsed.createdAt) return;
        seen.current.set(key, parsed.createdAt);

        setGuilds((prev) => {
          const map = new Map<string, Guild>();
          for (const g of prev) map.set(makeGuildKey(g.pubkey, g.guildId), g);
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
  }, [relays, limit]);

  return { guilds, isLoading };
}

