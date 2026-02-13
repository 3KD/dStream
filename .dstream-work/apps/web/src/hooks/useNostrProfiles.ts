"use client";

import { useEffect, useMemo, useState } from "react";
import type { Filter } from "nostr-tools";
import { parseProfileEvent, type NostrProfileRecord } from "@/lib/profile";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

export interface NostrProfileWithVerification extends NostrProfileRecord {
  nip05Verified: boolean | null;
}

const NIP05_CACHE = new Map<string, boolean>();

function isHex64(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test((input ?? "").trim());
}

function normalizePubkeys(pubkeysInput: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of pubkeysInput ?? []) {
    const value = (raw ?? "").trim().toLowerCase();
    if (!isHex64(value)) continue;
    unique.add(value);
  }
  return Array.from(unique).sort();
}

async function verifyNip05(pubkey: string, nip05: string): Promise<boolean> {
  const normalizedPubkey = pubkey.toLowerCase();
  const normalizedNip05 = nip05.trim().toLowerCase();
  const cacheKey = `${normalizedPubkey}:${normalizedNip05}`;
  if (NIP05_CACHE.has(cacheKey)) return NIP05_CACHE.get(cacheKey)!;

  const [nameRaw, domainRaw] = normalizedNip05.split("@");
  const name = (nameRaw ?? "").trim();
  const domain = (domainRaw ?? "").trim();
  if (!name || !domain) return false;

  try {
    const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      NIP05_CACHE.set(cacheKey, false);
      return false;
    }
    const data = (await res.json().catch(() => null)) as any;
    const names = data?.names;
    const mapped = names && typeof names[name] === "string" ? names[name].trim().toLowerCase() : "";
    const ok = mapped === normalizedPubkey;
    NIP05_CACHE.set(cacheKey, ok);
    return ok;
  } catch {
    NIP05_CACHE.set(cacheKey, false);
    return false;
  }
}

export function useNostrProfiles(pubkeysInput: string[]) {
  const relays = useMemo(() => getNostrRelays(), []);
  const pubkeysKey = normalizePubkeys(pubkeysInput ?? []).join(",");
  const pubkeys = useMemo(() => (pubkeysKey ? pubkeysKey.split(",") : []), [pubkeysKey]);

  const [profilesByPubkey, setProfilesByPubkey] = useState<Record<string, NostrProfileWithVerification>>({});

  useEffect(() => {
    if (pubkeys.length === 0) {
      setProfilesByPubkey({});
      return;
    }

    setProfilesByPubkey((prev) => {
      const next: Record<string, NostrProfileWithVerification> = {};
      for (const pubkey of pubkeys) {
        if (prev[pubkey]) next[pubkey] = prev[pubkey];
      }
      return next;
    });

    const filters: Filter[] = [
      {
        kinds: [0],
        authors: pubkeys,
        since: Math.floor(Date.now() / 1000) - 180 * 24 * 3600,
        limit: Math.max(200, pubkeys.length * 4)
      }
    ];
    const pubkeySet = new Set(pubkeys);

    const sub = subscribeMany(relays, filters, {
      onevent: (event: any) => {
        const parsed = parseProfileEvent(event);
        if (!parsed) return;
        if (!pubkeySet.has(parsed.pubkey)) return;

        setProfilesByPubkey((prev) => {
          const current = prev[parsed.pubkey];
          if (current && current.createdAt >= parsed.createdAt) return prev;
          return {
            ...prev,
            [parsed.pubkey]: {
              ...parsed,
              nip05Verified: parsed.profile.nip05 ? null : false
            }
          };
        });
      }
    });

    return () => {
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [pubkeysKey, relays]);

  useEffect(() => {
    const pending = Object.values(profilesByPubkey).filter((record) => record.profile.nip05 && record.nip05Verified === null);
    if (pending.length === 0) return;
    let cancelled = false;

    void (async () => {
      for (const record of pending) {
        if (cancelled) return;
        const nip05 = record.profile.nip05;
        if (!nip05) continue;
        const ok = await verifyNip05(record.pubkey, nip05);
        if (cancelled) return;
        setProfilesByPubkey((prev) => {
          const current = prev[record.pubkey];
          if (!current) return prev;
          if (current.nip05Verified !== null) return prev;
          return {
            ...prev,
            [record.pubkey]: {
              ...current,
              nip05Verified: ok
            }
          };
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profilesByPubkey]);

  return profilesByPubkey;
}

export function useNostrProfile(pubkey: string | null | undefined): NostrProfileWithVerification | null {
  const map = useNostrProfiles(pubkey ? [pubkey] : []);
  const key = (pubkey ?? "").trim().toLowerCase();
  if (!isHex64(key)) return null;
  return map[key] ?? null;
}
