"use client";

import { useEffect } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { isLocalRelayEnabled } from "@/lib/config";
import { initLocalRelay, destroyLocalRelay } from "@/lib/relay/localRelay";

/**
 * Initializes the in-app local Nostr relay on app boot when enabled.
 * Mount this inside the identity provider so `identity.pubkey` is available.
 */
export function LocalRelayInit() {
  const { identity } = useIdentity();
  const pubkey = identity?.pubkey ?? null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isLocalRelayEnabled() || !pubkey) {
      destroyLocalRelay();
      return;
    }

    let cancelled = false;
    initLocalRelay(pubkey).then(() => {
      if (cancelled) destroyLocalRelay();
    });

    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  return null;
}
