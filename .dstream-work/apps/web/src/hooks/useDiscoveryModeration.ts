"use client";

import { useEffect, useMemo, useState } from "react";
import { type Filter, validateEvent, verifyEvent } from "nostr-tools";
import { makeStreamKey, NOSTR_KINDS, parseDiscoveryModerationEvent, type DiscoveryModerationRecord } from "@dstream/protocol";
import { getDiscoveryOperatorPubkeys, getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

interface DiscoveryPolicyEntry {
  key: string;
  hidden: boolean;
  record: DiscoveryModerationRecord;
}

function makeEntryKey(record: DiscoveryModerationRecord): string {
  if (record.targetType === "pubkey") return `pubkey:${record.targetPubkey}`;
  return `stream:${makeStreamKey(record.targetPubkey, record.targetStreamId ?? "")}`;
}

export function useDiscoveryModeration(operatorPubkeysOverride?: string[]) {
  const relays = useMemo(() => getNostrRelays(), []);
  const defaultOperatorPubkeys = useMemo(() => getDiscoveryOperatorPubkeys(), []);
  const operatorPubkeys = useMemo(() => {
    const source = operatorPubkeysOverride && operatorPubkeysOverride.length > 0 ? operatorPubkeysOverride : defaultOperatorPubkeys;
    return Array.from(
      new Set(
        source
          .map((value) => value.trim().toLowerCase())
          .filter((value) => /^[0-9a-f]{64}$/.test(value))
      )
    );
  }, [defaultOperatorPubkeys, operatorPubkeysOverride]);

  const [entries, setEntries] = useState<DiscoveryPolicyEntry[]>([]);
  const [isLoading, setIsLoading] = useState(operatorPubkeys.length > 0);

  useEffect(() => {
    if (operatorPubkeys.length === 0) {
      setEntries([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const filters: Filter[] = [
      {
        kinds: [NOSTR_KINDS.APP_DISCOVERY_MOD],
        authors: operatorPubkeys,
        since: Math.floor(Date.now() / 1000) - 14 * 86400,
        limit: 2000
      }
    ];

    const sub = subscribeMany(relays, filters, {
      onevent: (event: any) => {
        if (!validateEvent(event) || !verifyEvent(event)) return;
        const parsed = parseDiscoveryModerationEvent(event);
        if (!parsed) return;

        const key = makeEntryKey(parsed);
        const hidden = parsed.action === "hide";

        setEntries((prev) => {
          const map = new Map(prev.map((entry) => [entry.key, entry]));
          const existing = map.get(key);
          if (existing && existing.record.createdAt > parsed.createdAt) return prev;
          map.set(key, { key, hidden, record: parsed });
          return Array.from(map.values()).sort((left, right) => right.record.createdAt - left.record.createdAt);
        });
      },
      oneose: () => setIsLoading(false)
    });

    const timeout = setTimeout(() => setIsLoading(false), 4000);
    return () => {
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [operatorPubkeys, relays]);

  const hiddenPubkeys = useMemo(
    () =>
      entries
        .filter((entry) => entry.hidden && entry.record.targetType === "pubkey")
        .map((entry) => entry.record.targetPubkey),
    [entries]
  );

  const hiddenStreams = useMemo(
    () =>
      entries
        .filter((entry) => entry.hidden && entry.record.targetType === "stream" && !!entry.record.targetStreamId)
        .map((entry) => ({ streamPubkey: entry.record.targetPubkey, streamId: entry.record.targetStreamId as string })),
    [entries]
  );

  return {
    operatorPubkeys,
    records: entries.map((entry) => entry.record),
    hiddenPubkeys,
    hiddenStreams,
    isLoading
  };
}

