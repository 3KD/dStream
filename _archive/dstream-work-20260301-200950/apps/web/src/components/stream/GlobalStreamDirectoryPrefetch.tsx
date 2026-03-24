"use client";

import { useEffect, useState } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { useStreamAnnounces } from "@/hooks/useStreamAnnounces";

const PREFETCH_STREAM_LIMIT = 180;
const PREFETCH_IDLE_TIMEOUT_MS = 1800;

export function GlobalStreamDirectoryPrefetch() {
  const { identity } = useIdentity();
  const social = useSocial();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const win = typeof window !== "undefined" ? (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }) : null;
    const activate = () => setEnabled(true);

    if (win?.requestIdleCallback) {
      const idleId = win.requestIdleCallback(activate, { timeout: PREFETCH_IDLE_TIMEOUT_MS });
      return () => {
        win.cancelIdleCallback?.(idleId);
      };
    }

    timer = setTimeout(activate, 900);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  useStreamAnnounces({
    enabled,
    liveOnly: false,
    limit: PREFETCH_STREAM_LIMIT,
    includeMature: social.settings.showMatureContent,
    viewerPubkey: identity?.pubkey ?? null
  });

  return null;
}
