"use client";

import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { useStreamAnnounces } from "@/hooks/useStreamAnnounces";

const PREFETCH_STREAM_LIMIT = 180;

export function GlobalStreamDirectoryPrefetch() {
  const { identity } = useIdentity();
  const social = useSocial();

  useStreamAnnounces({
    liveOnly: false,
    limit: PREFETCH_STREAM_LIMIT,
    includeMature: social.settings.showMatureContent,
    viewerPubkey: identity?.pubkey ?? null
  });

  return null;
}
