"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { NOSTR_KINDS, parseGuildMembershipEvent, parseGuildRoleEvent, type GuildRole, type GuildMembershipStatus } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

type MembershipState = { status: GuildMembershipStatus; createdAt: number };
type RoleState = { role: GuildRole; createdAt: number };

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function isHex64(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test((value ?? "").trim());
}

export interface GuildRosterMember {
  pubkey: string;
  role: GuildRole;
  joinedAt: number;
}

export function useGuildRoster(opts: { guildPubkey: string; guildId: string; viewerPubkey?: string }) {
  const guildPubkey = (opts.guildPubkey ?? "").trim().toLowerCase();
  const guildId = (opts.guildId ?? "").trim();
  const viewerPubkey = (opts.viewerPubkey ?? "").trim().toLowerCase();
  const relays = useMemo(() => getNostrRelays(), []);

  const [isLoading, setIsLoading] = useState(true);
  const [membershipByPubkey, setMembershipByPubkey] = useState<Record<string, MembershipState>>({});
  const [roleByPubkey, setRoleByPubkey] = useState<Record<string, RoleState>>({});
  const seenMembership = useRef<Map<string, number>>(new Map());
  const seenRoles = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setIsLoading(true);
    setMembershipByPubkey({});
    setRoleByPubkey({});
    seenMembership.current = new Map();
    seenRoles.current = new Map();

    if (!guildPubkey || !guildId || !isHex64(guildPubkey)) {
      setIsLoading(false);
      return;
    }

    const guildTag = `${NOSTR_KINDS.GUILD}:${guildPubkey}:${guildId}`;
    const filters: Filter[] = [
      {
        kinds: [NOSTR_KINDS.GUILD_MEMBERSHIP],
        "#a": [guildTag],
        since: nowSec() - 365 * 24 * 3600,
        limit: 2000
      },
      {
        kinds: [NOSTR_KINDS.GUILD_ROLE],
        authors: [guildPubkey],
        "#a": [guildTag],
        since: nowSec() - 365 * 24 * 3600,
        limit: 2000
      }
    ];

    const sub = subscribeMany(relays, filters, {
      onevent: (event: any) => {
        const membership = parseGuildMembershipEvent(event);
        if (membership && membership.guildPubkey === guildPubkey && membership.guildId === guildId) {
          const prev = seenMembership.current.get(membership.pubkey);
          if (prev && prev >= membership.createdAt) return;
          seenMembership.current.set(membership.pubkey, membership.createdAt);
          setMembershipByPubkey((existing) => ({ ...existing, [membership.pubkey]: { status: membership.status, createdAt: membership.createdAt } }));
          return;
        }

        const role = parseGuildRoleEvent(event);
        if (!role || role.guildPubkey !== guildPubkey || role.guildId !== guildId) return;
        const prev = seenRoles.current.get(role.targetPubkey);
        if (prev && prev >= role.createdAt) return;
        seenRoles.current.set(role.targetPubkey, role.createdAt);
        setRoleByPubkey((existing) => ({ ...existing, [role.targetPubkey]: { role: role.role, createdAt: role.createdAt } }));
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
  }, [guildId, guildPubkey, relays]);

  const members = useMemo<GuildRosterMember[]>(() => {
    if (!guildPubkey || !guildId || !isHex64(guildPubkey)) return [];
    const memberPubkeys = new Set<string>();
    memberPubkeys.add(guildPubkey);

    for (const [pubkey, membership] of Object.entries(membershipByPubkey)) {
      if (membership.status === "joined") memberPubkeys.add(pubkey);
    }

    const list = Array.from(memberPubkeys).map((pubkey) => {
      if (pubkey === guildPubkey) {
        return { pubkey, role: "admin" as GuildRole, joinedAt: membershipByPubkey[pubkey]?.createdAt ?? 0 };
      }

      const role = roleByPubkey[pubkey]?.role;
      const resolvedRole: GuildRole = role && role !== "none" ? role : "member";
      return {
        pubkey,
        role: resolvedRole,
        joinedAt: membershipByPubkey[pubkey]?.createdAt ?? 0
      };
    });

    list.sort((left, right) => {
      const roleScore = (role: GuildRole) => (role === "admin" ? 3 : role === "moderator" ? 2 : role === "member" ? 1 : 0);
      const roleDelta = roleScore(right.role) - roleScore(left.role);
      if (roleDelta !== 0) return roleDelta;
      if (right.joinedAt !== left.joinedAt) return right.joinedAt - left.joinedAt;
      return left.pubkey.localeCompare(right.pubkey);
    });

    return list;
  }, [guildId, guildPubkey, membershipByPubkey, roleByPubkey]);

  const viewerMembershipStatus = useMemo<GuildMembershipStatus | null>(() => {
    if (!viewerPubkey || !isHex64(viewerPubkey)) return null;
    if (viewerPubkey === guildPubkey) return "joined";
    return membershipByPubkey[viewerPubkey]?.status ?? null;
  }, [guildPubkey, membershipByPubkey, viewerPubkey]);

  const viewerRole = useMemo<GuildRole | null>(() => {
    if (!viewerPubkey || !isHex64(viewerPubkey)) return null;
    if (viewerPubkey === guildPubkey) return "admin";
    const role = roleByPubkey[viewerPubkey]?.role;
    if (role && role !== "none") return role;
    return viewerMembershipStatus === "joined" ? "member" : null;
  }, [guildPubkey, roleByPubkey, viewerMembershipStatus, viewerPubkey]);

  return {
    isLoading,
    members,
    membershipByPubkey,
    roleByPubkey,
    viewerMembershipStatus,
    viewerRole
  };
}
