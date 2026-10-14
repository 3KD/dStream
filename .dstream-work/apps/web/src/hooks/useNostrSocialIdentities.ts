"use client";

import { useEffect, useMemo, useState } from "react";
import type { Filter } from "nostr-tools";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";
import { NIP39_KIND, parseNip39Event, type NostrIdentityRecord } from "@/lib/socialIdentities";

function isHex64(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test((input ?? "").trim());
}

export function useNostrSocialIdentities(pubkeyInput: string | null | undefined): NostrIdentityRecord | null {
  const relays = useMemo(() => getNostrRelays(), []);
  const pubkey = (pubkeyInput ?? "").trim().toLowerCase();
  const [record, setRecord] = useState<NostrIdentityRecord | null>(null);

  useEffect(() => {
    setRecord(null);
    if (!isHex64(pubkey)) return;

    const filter: Filter = {
      kinds: [NIP39_KIND],
      authors: [pubkey],
      limit: 20
    };
    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseNip39Event(event);
        if (!parsed || parsed.pubkey !== pubkey) return;
        setRecord((current) => (!current || parsed.createdAt > current.createdAt ? parsed : current));
      }
    });

    return () => {
      try {
        sub.close?.();
      } catch {
        // ignore
      }
    };
  }, [pubkey, relays]);

  return record;
}
