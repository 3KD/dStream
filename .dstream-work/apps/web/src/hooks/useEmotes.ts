"use client";

import { useEffect, useMemo, useState } from "react";
import type { Filter } from "nostr-tools";
import { NOSTR_KINDS } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

export interface EmoteDefinition {
  shortcode: string;
  url: string;
  hash?: string;
  tier?: "free" | "subscriber";
}

export type BlobPointerMap = Record<string, { url: string; tier: "free" | "subscriber" }>;

// Shared cache to prevent re-verifying across remounts
const BLOB_URL_CACHE: Record<string, string> = {};

async function verifyAndCacheEmote(emote: EmoteDefinition): Promise<string | null> {
  const cacheKey = `${emote.shortcode}:${emote.url}`;
  if (BLOB_URL_CACHE[cacheKey]) {
    return BLOB_URL_CACHE[cacheKey];
  }

  try {
    const res = await fetch(emote.url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();

    if (emote.hash) {
      const digestBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(digestBuffer));
      const hexDigest = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
      
      if (hexDigest.toLowerCase() !== emote.hash.toLowerCase()) {
        console.warn(`Emote verification failed for ${emote.shortcode}. Hash mismatch.`);
        return null; // Cryptographic failure
      }
    }

    const contentType = res.headers.get("content-type") || "image/png";
    const blob = new Blob([arrayBuffer], { type: contentType });
    const localUrl = URL.createObjectURL(blob);
    BLOB_URL_CACHE[cacheKey] = localUrl;
    return localUrl;
  } catch (err) {
    return null;
  }
}

export function useEmotes(pubkeyInput: string | (string | null | undefined)[] | null) {
  const [emotes, setEmotes] = useState<BlobPointerMap>({});
  const relays = useMemo(() => getNostrRelays(), []);

  const validPubkeys = useMemo(() => {
    if (!pubkeyInput) return [];
    if (typeof pubkeyInput === "string") return [pubkeyInput];
    return pubkeyInput.filter((p): p is string => !!p);
  }, [JSON.stringify(pubkeyInput)]);

  useEffect(() => {
    if (validPubkeys.length === 0) return;

    let mounted = true;
    const filter: Filter = {
      kinds: [NOSTR_KINDS.CUSTOM_EMOJI],
      authors: validPubkeys
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: async (event: any) => {
        if (!mounted || !validPubkeys.includes(event.pubkey)) return;
        
        const emojiTags = event.tags.filter((t: string[]) => t[0] === "emoji" && t.length >= 3);
        const definitions: EmoteDefinition[] = emojiTags.map((t: string[]) => ({
          shortcode: t[1],
          url: t[2],
          hash: t[3],
          tier: t[4] === "subscriber" ? "subscriber" : "free"
        }));

        const newMap: BlobPointerMap = {};
        
        // Concurrently verify and cache all emotes in this pack
        await Promise.all(definitions.map(async (def) => {
          const localUrl = await verifyAndCacheEmote(def);
          if (localUrl) newMap[def.shortcode] = { url: localUrl, tier: def.tier || "free" };
        }));

        if (mounted) {
          setEmotes(prev => ({ ...prev, ...newMap }));
        }
      }
    });

    return () => {
      mounted = false;
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [validPubkeys.join(","), relays]);

  return emotes;
}
