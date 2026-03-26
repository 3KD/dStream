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
  fallbackManifestUrl?: string | null;
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
      kinds: [39313],
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

  useEffect(() => {
    const fallbackUrl = (opts.fallbackManifestUrl ?? "").trim();
    if (!session || !fallbackUrl) return;

    let cancelled = false;

    const pollFallback = async () => {
      try {
        const res = await fetch(fallbackUrl, { cache: "no-store" });
        if (!res.ok) return;
        const event = (await res.json().catch(() => null)) as any;
        if (!event || typeof event !== "object") return;
        if (typeof event.id === "string" && seenIdsRef.current.has(event.id)) return;
        if (!validateEvent(event) || !verifyEvent(event)) return;
        const parsed = parseStreamManifestRootEvent(event);
        if (!parsed) return;
        session.ingestManifest(parsed);
        if (typeof event.id === "string") seenIdsRef.current.add(event.id);
        if (!cancelled) setSnapshot(session.snapshot());
      } catch {
        // ignore
      }
    };

    void pollFallback();
    const interval = setInterval(() => void pollFallback(), 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [opts.fallbackManifestUrl, session]);

  return { session, snapshot };
}
