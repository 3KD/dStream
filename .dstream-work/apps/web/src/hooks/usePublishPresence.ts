"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const { enabled, streamId, streamPubkey } = scope;
  const intervalMs = scope.intervalMs ?? 30_000;
  const sendInFlightRef = useRef(false);

  const [status, setStatus] = useState<PublishStatus>("idle");
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);

  const sendOnce = useCallback(async () => {
    if (!enabled || sendInFlightRef.current) return false;
    if (!identity) return false;
    if (!streamPubkey || !streamId) return false;

    sendInFlightRef.current = true;
    setStatus((previous) => (previous === "ok" ? "ok" : "sending"));
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
    } finally {
      sendInFlightRef.current = false;
    }
  }, [enabled, identity, relays, signEvent, streamId, streamPubkey]);

  useEffect(() => {
    if (!enabled) return;
    if (!identity) return;
    if (!streamPubkey || !streamId) return;

    void sendOnce();
    const interval = setInterval(() => void sendOnce(), intervalMs);
    return () => clearInterval(interval);
  }, [enabled, identity, intervalMs, sendOnce, streamId, streamPubkey]);

  return {
    canPublish: enabled && !!identity,
    status,
    lastSentAt,
    sendOnce
  };
}
