"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter, Event as NostrEvent } from "nostr-tools";
import {
  buildStreamModerationEvent,
  buildStreamModeratorRoleEvent,
  parseStreamModerationEvent,
  parseStreamModeratorRoleEvent,
  type StreamModerationAction,
  type StreamModerationRecord,
  type StreamModeratorRole
} from "@dstream/protocol";
import { NOSTR_KINDS } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";
import { publishEvent } from "@/lib/publish";

type SignEventFn = (unsigned: Omit<NostrEvent, "id" | "sig">) => Promise<NostrEvent>;

interface UseStreamModerationOptions {
  streamPubkey: string;
  streamId: string;
  identityPubkey?: string | null;
  signEvent?: SignEventFn;
}

interface EffectiveActionsByTarget {
  [targetPubkey: string]: StreamModerationAction;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function isHex64(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test((value ?? "").trim());
}

function actionKey(record: Pick<StreamModerationRecord, "targetPubkey" | "pubkey">): string {
  return `${record.targetPubkey}:${record.pubkey}`;
}

type RoleState = { role: StreamModeratorRole; createdAt: number };

export function useStreamModeration(opts: UseStreamModerationOptions) {
  const relays = useMemo(() => getNostrRelays(), []);
  const streamPubkey = (opts.streamPubkey ?? "").trim().toLowerCase();
  const streamId = (opts.streamId ?? "").trim();
  const identityPubkey = (opts.identityPubkey ?? "").trim().toLowerCase();
  const signEvent = opts.signEvent;

  const [isLoading, setIsLoading] = useState(true);
  const [actionsByAuthorTarget, setActionsByAuthorTarget] = useState<Record<string, StreamModerationRecord>>({});
  const [roleByTarget, setRoleByTarget] = useState<Record<string, RoleState>>({});

  const actionsSeenRef = useRef<Map<string, number>>(new Map());
  const rolesSeenRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setIsLoading(true);
    setActionsByAuthorTarget({});
    setRoleByTarget({});
    actionsSeenRef.current = new Map();
    rolesSeenRef.current = new Map();

    if (!streamPubkey || !streamId || !isHex64(streamPubkey)) {
      setIsLoading(false);
      return;
    }

    const streamTag = `${NOSTR_KINDS.STREAM_ANNOUNCE}:${streamPubkey}:${streamId}`;
    const filters: Filter[] = [
      {
        kinds: [NOSTR_KINDS.STREAM_MOD_ACTION],
        "#a": [streamTag],
        since: nowSec() - 30 * 24 * 3600,
        limit: 1000
      },
      {
        kinds: [NOSTR_KINDS.STREAM_MOD_ROLE],
        authors: [streamPubkey],
        "#a": [streamTag],
        since: nowSec() - 30 * 24 * 3600,
        limit: 1000
      }
    ];

    const sub = subscribeMany(relays, filters, {
      onevent: (event: any) => {
        const parsedRole = parseStreamModeratorRoleEvent(event, { streamPubkey, streamId });
        if (parsedRole) {
          const key = parsedRole.targetPubkey;
          const prevCreatedAt = rolesSeenRef.current.get(key);
          if (prevCreatedAt && prevCreatedAt >= parsedRole.createdAt) return;
          rolesSeenRef.current.set(key, parsedRole.createdAt);
          setRoleByTarget((prev) => ({ ...prev, [key]: { role: parsedRole.role, createdAt: parsedRole.createdAt } }));
          return;
        }

        const parsedAction = parseStreamModerationEvent(event, { streamPubkey, streamId });
        if (!parsedAction) return;
        const key = actionKey(parsedAction);
        const prevCreatedAt = actionsSeenRef.current.get(key);
        if (prevCreatedAt && prevCreatedAt >= parsedAction.createdAt) return;
        actionsSeenRef.current.set(key, parsedAction.createdAt);
        setActionsByAuthorTarget((prev) => ({ ...prev, [key]: parsedAction }));
      },
      oneose: () => setIsLoading(false)
    });

    const timeout = setTimeout(() => setIsLoading(false), 4500);
    return () => {
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [relays, streamId, streamPubkey]);

  const moderators = useMemo(() => {
    const set = new Set<string>();
    for (const [targetPubkey, roleState] of Object.entries(roleByTarget)) {
      if (roleState.role === "moderator") set.add(targetPubkey);
    }
    return set;
  }, [roleByTarget]);

  const subscribers = useMemo(() => {
    const set = new Set<string>();
    for (const [targetPubkey, roleState] of Object.entries(roleByTarget)) {
      if (roleState.role === "subscriber") set.add(targetPubkey);
    }
    return set;
  }, [roleByTarget]);

  const effectiveActionsByTarget = useMemo<EffectiveActionsByTarget>(() => {
    const latestByTarget = new Map<string, StreamModerationRecord>();
    for (const record of Object.values(actionsByAuthorTarget)) {
      const issuer = record.pubkey;
      const issuerAuthorized = issuer === streamPubkey || moderators.has(issuer);
      if (!issuerAuthorized) continue;

      const prev = latestByTarget.get(record.targetPubkey);
      if (!prev || record.createdAt > prev.createdAt) latestByTarget.set(record.targetPubkey, record);
    }

    const out: EffectiveActionsByTarget = {};
    for (const [targetPubkey, record] of latestByTarget.entries()) {
      out[targetPubkey] = record.action;
    }
    return out;
  }, [actionsByAuthorTarget, moderators, streamPubkey]);

  const remoteMuted = useMemo(() => {
    const set = new Set<string>();
    for (const [targetPubkey, action] of Object.entries(effectiveActionsByTarget)) {
      if (action === "mute") set.add(targetPubkey);
    }
    return set;
  }, [effectiveActionsByTarget]);

  const remoteBlocked = useMemo(() => {
    const set = new Set<string>();
    for (const [targetPubkey, action] of Object.entries(effectiveActionsByTarget)) {
      if (action === "block") set.add(targetPubkey);
    }
    return set;
  }, [effectiveActionsByTarget]);

  const isOwner = identityPubkey !== "" && identityPubkey === streamPubkey;
  const canModerate = isOwner || (identityPubkey !== "" && moderators.has(identityPubkey));

  const publishModerationAction = useCallback(
    async (targetPubkeyInput: string, action: StreamModerationAction, reason?: string): Promise<boolean> => {
      const targetPubkey = (targetPubkeyInput ?? "").trim().toLowerCase();
      if (!signEvent || !identityPubkey || !canModerate || !isHex64(targetPubkey)) return false;
      if (!streamPubkey || !streamId) return false;

      try {
        const unsigned = buildStreamModerationEvent({
          pubkey: identityPubkey,
          createdAt: nowSec(),
          streamPubkey,
          streamId,
          targetPubkey,
          action,
          reason
        });
        const signed = await signEvent(unsigned as Omit<NostrEvent, "id" | "sig">);
        const ok = await publishEvent(relays, signed);
        if (!ok) return false;

        const parsed = parseStreamModerationEvent(signed as any, { streamPubkey, streamId });
        if (parsed) {
          const key = actionKey(parsed);
          actionsSeenRef.current.set(key, parsed.createdAt);
          setActionsByAuthorTarget((prev) => ({ ...prev, [key]: parsed }));
        }
        return true;
      } catch {
        return false;
      }
    },
    [canModerate, identityPubkey, relays, signEvent, streamId, streamPubkey]
  );

  const publishModeratorRole = useCallback(
    async (targetPubkeyInput: string, role: StreamModeratorRole): Promise<boolean> => {
      const targetPubkey = (targetPubkeyInput ?? "").trim().toLowerCase();
      if (!signEvent || !identityPubkey || !isOwner || !isHex64(targetPubkey)) return false;
      if (!streamPubkey || !streamId) return false;

      try {
        const unsigned = buildStreamModeratorRoleEvent({
          pubkey: identityPubkey,
          createdAt: nowSec(),
          streamPubkey,
          streamId,
          targetPubkey,
          role
        });
        const signed = await signEvent(unsigned as Omit<NostrEvent, "id" | "sig">);
        const ok = await publishEvent(relays, signed);
        if (!ok) return false;

        const parsed = parseStreamModeratorRoleEvent(signed as any, { streamPubkey, streamId });
        if (parsed) {
          rolesSeenRef.current.set(parsed.targetPubkey, parsed.createdAt);
          setRoleByTarget((prev) => ({ ...prev, [parsed.targetPubkey]: { role: parsed.role, createdAt: parsed.createdAt } }));
        }
        return true;
      } catch {
        return false;
      }
    },
    [identityPubkey, isOwner, relays, signEvent, streamId, streamPubkey]
  );

  return {
    isLoading,
    isOwner,
    canModerate,
    moderators,
    subscribers,
    effectiveActionsByTarget,
    remoteMuted,
    remoteBlocked,
    publishModerationAction,
    publishModeratorRole
  };
}
