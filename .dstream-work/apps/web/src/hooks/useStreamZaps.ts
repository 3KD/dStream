"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";
import { NIP57_ZAP_RECEIPT_KIND, isZapReceiptForStream, parseZapReceiptEvent, type ParsedZapReceipt } from "@/lib/zaps";

export function useStreamZaps(scope: { streamPubkey: string; streamId: string; windowDays?: number }) {
  const relays = useMemo(() => getNostrRelays(), []);
  const streamPubkey = (scope.streamPubkey ?? "").trim().toLowerCase();
  const streamId = (scope.streamId ?? "").trim();
  const windowDays = Math.max(1, Math.min(120, Math.floor(scope.windowDays ?? 30)));
  const [isConnected, setIsConnected] = useState(false);
  const [receipts, setReceipts] = useState<ParsedZapReceipt[]>([]);
  const byIdRef = useRef<Map<string, ParsedZapReceipt>>(new Map());

  useEffect(() => {
    if (!streamPubkey || !streamId) {
      byIdRef.current.clear();
      setReceipts([]);
      setIsConnected(false);
      return;
    }

    byIdRef.current.clear();
    setReceipts([]);
    setIsConnected(false);

    const since = Math.floor(Date.now() / 1000) - windowDays * 24 * 60 * 60;
    const filter: Filter = {
      kinds: [NIP57_ZAP_RECEIPT_KIND],
      "#p": [streamPubkey],
      since,
      limit: 2000
    };
    let cancelled = false;
    let publishTimer: ReturnType<typeof setTimeout> | null = null;
    const publishReceipts = () => {
      if (cancelled) return;
      if (publishTimer) {
        clearTimeout(publishTimer);
        publishTimer = null;
      }
      const next = Array.from(byIdRef.current.values()).sort((a, b) => {
        const byCreated = b.createdAt - a.createdAt;
        if (byCreated !== 0) return byCreated;
        return a.id.localeCompare(b.id);
      });
      startTransition(() => setReceipts(next));
    };
    const schedulePublish = () => {
      if (publishTimer) return;
      publishTimer = setTimeout(publishReceipts, 100);
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseZapReceiptEvent(event);
        if (!parsed) return;
        if (!isZapReceiptForStream(parsed, streamPubkey, streamId)) return;
        const prev = byIdRef.current.get(parsed.id);
        if (prev && prev.createdAt >= parsed.createdAt) return;
        byIdRef.current.set(parsed.id, parsed);
        schedulePublish();
      },
      oneose: () => {
        publishReceipts();
        setIsConnected(true);
      }
    });

    return () => {
      cancelled = true;
      if (publishTimer) clearTimeout(publishTimer);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
      setIsConnected(false);
    };
  }, [relays, streamId, streamPubkey, windowDays]);

  const totalSats = useMemo(() => receipts.reduce((sum, receipt) => sum + receipt.sats, 0), [receipts]);
  const latestReceipt = receipts[0] ?? null;

  return {
    isConnected,
    receipts,
    count: receipts.length,
    totalSats,
    latestReceipt
  };
}
