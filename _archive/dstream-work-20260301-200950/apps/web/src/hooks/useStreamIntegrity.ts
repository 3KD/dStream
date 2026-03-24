"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { validateEvent, verifyEvent } from "nostr-tools";
import { makeATag, parseStreamManifestRootEvent } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";
import { IntegritySession, type IntegritySnapshot } from "@/lib/integrity/session";

export function useStreamIntegrity(opts: {
  streamPubkey: string;
  streamId: string;
  manifestSignerPubkey: string | null | undefined;
}) {
  const relays = useMemo(() => getNostrRelays(), []);

  const session = useMemo(() => {
    if (!opts.streamPubkey || !opts.streamId) return null;
    const signer = (opts.manifestSignerPubkey || "").trim().toLowerCase();
    if (!signer) return null;
    return new IntegritySession({ streamPubkey: opts.streamPubkey, streamId: opts.streamId, manifestSignerPubkey: signer });
  }, [opts.manifestSignerPubkey, opts.streamId, opts.streamPubkey]);

  const [snapshot, setSnapshot] = useState<IntegritySnapshot | null>(() => session?.snapshot() ?? null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setSnapshot(session?.snapshot() ?? null);
    seenIdsRef.current = new Set();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const tick = () => setSnapshot(session.snapshot());
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [session]);

  useEffect(() => {
    if (!session) return;

    const filter: Filter = {
      kinds: [30313],
      authors: [session.manifestSignerPubkey],
      "#a": [makeATag(session.streamPubkey, session.streamId)],
      since: Math.floor(Date.now() / 1000) - 3600,
      limit: 200
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        if (!event || typeof event !== "object") return;
        if (typeof event.id === "string") {
          if (seenIdsRef.current.has(event.id)) return;
          seenIdsRef.current.add(event.id);
        }
        if (!validateEvent(event) || !verifyEvent(event)) return;
        const parsed = parseStreamManifestRootEvent(event);
        if (!parsed) return;
        session.ingestManifest(parsed);
        setSnapshot(session.snapshot());
      }
    });

    return () => {
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [relays, session]);

  return { session, snapshot };
}

