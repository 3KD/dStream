"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { parseGuildEvent, type Guild, NOSTR_KINDS } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function useGuild(opts: { pubkey: string; guildId: string }) {
  const [guild, setGuild] = useState<Guild | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const seen = useRef<number>(0);

  const relays = useMemo(() => getNostrRelays(), []);
  const pubkey = (opts.pubkey ?? "").trim().toLowerCase();
  const guildId = (opts.guildId ?? "").trim();

  useEffect(() => {
    setIsLoading(true);
    setGuild(null);
    seen.current = 0;

    if (!pubkey || !guildId) {
      setIsLoading(false);
      return;
    }

    const filter: Filter = {
      kinds: [NOSTR_KINDS.GUILD],
      authors: [pubkey],
      "#d": [guildId],
      since: nowSec() - 180 * 24 * 3600,
      limit: 10
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseGuildEvent(event);
        if (!parsed) return;
        if (parsed.pubkey !== pubkey) return;
        if (parsed.guildId !== guildId) return;
        if (parsed.createdAt <= seen.current) return;
        seen.current = parsed.createdAt;
        setGuild(parsed);
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
  }, [guildId, pubkey, relays]);

  return { guild, isLoading };
}

