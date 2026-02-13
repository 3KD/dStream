"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildStreamPresenceEvent } from "@dstream/protocol";
import { useIdentity } from "@/context/IdentityContext";
import { getNostrRelays } from "@/lib/config";
import { publishEvent } from "@/lib/publish";

type PublishStatus = "idle" | "sending" | "ok" | "fail";

export function usePublishPresence(scope: {
  streamPubkey: string;
  streamId: string;
  enabled: boolean;
  intervalMs?: number;
}) {
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const intervalMs = scope.intervalMs ?? 30_000;

  const [status, setStatus] = useState<PublishStatus>("idle");
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);

  const sendOnce = useCallback(async () => {
    if (!scope.enabled) return false;
    if (!identity) return false;
    const { streamPubkey, streamId } = scope;
    if (!streamPubkey || !streamId) return false;

    setStatus("sending");
    try {
      const createdAt = Math.floor(Date.now() / 1000);
      const unsigned = buildStreamPresenceEvent({
        pubkey: identity.pubkey,
        createdAt,
        streamPubkey,
        streamId
      }) as any;

      const signed = await signEvent(unsigned);
      const ok = await publishEvent(relays, signed);
      setLastSentAt(Date.now());
      setStatus(ok ? "ok" : "fail");
      return ok;
    } catch {
      setStatus("fail");
      return false;
    }
  }, [identity, relays, scope, signEvent]);

  useEffect(() => {
    if (!scope.enabled) return;
    if (!identity) return;
    if (!scope.streamPubkey || !scope.streamId) return;

    void sendOnce();
    const interval = setInterval(() => void sendOnce(), intervalMs);
    return () => clearInterval(interval);
  }, [identity, intervalMs, scope.enabled, scope.streamId, scope.streamPubkey, sendOnce]);

  return {
    canPublish: scope.enabled && !!identity,
    status,
    lastSentAt,
    sendOnce
  };
}

