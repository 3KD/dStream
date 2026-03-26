"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Filter, validateEvent, verifyEvent } from "nostr-tools";
import {
  NOSTR_KINDS,
  makeGuildKey,
  parseGuildEvent,
  parseGuildMembershipEvent,
  parseGuildRoleEvent,
  type Guild,
  type GuildMembershipStatus,
  type GuildRole
} from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";

function isHex64(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test((value ?? "").trim());
}

type MembershipState = {
  guildPubkey: string;
  guildId: string;
  status: GuildMembershipStatus;
  createdAt: number;
};

type RoleState = {
  guildPubkey: string;
  guildId: string;
  role: GuildRole;
  createdAt: number;
};

export type ProfileGuildStatus = "owner" | "admin" | "member" | "guest_vip";

export interface ProfileGuildStatusRow {
  key: string;
  guildPubkey: string;
  guildId: string;
  guildName: string;
  guildImage?: string;
  status: ProfileGuildStatus;
  updatedAt: number;
}

const STATUS_SORT: Record<ProfileGuildStatus, number> = {
  owner: 4,
  admin: 3,
  guest_vip: 2,
  member: 1
};

export function useProfileGuildStatuses(profilePubkeyRaw?: string | null) {
  const profilePubkey = (profilePubkeyRaw ?? "").trim().toLowerCase();
  const relays = useMemo(() => getNostrRelays(), []);

  const [isLoading, setIsLoading] = useState(true);
  const [guildByKey, setGuildByKey] = useState<Record<string, Guild>>({});
  const [membershipByKey, setMembershipByKey] = useState<Record<string, MembershipState>>({});
  const [roleByKey, setRoleByKey] = useState<Record<string, RoleState>>({});

  const seenGuild = useRef<Map<string, number>>(new Map());
  const seenMembership = useRef<Map<string, number>>(new Map());
  const seenRole = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setGuildByKey({});
    setMembershipByKey({});
    setRoleByKey({});
    seenGuild.current = new Map();
    seenMembership.current = new Map();
    seenRole.current = new Map();

    if (!profilePubkey || !isHex64(profilePubkey)) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const filters: Filter[] = [
      { kinds: [NOSTR_KINDS.GUILD], limit: 2500 },
      { kinds: [NOSTR_KINDS.GUILD_MEMBERSHIP], authors: [profilePubkey], limit: 1200 },
      { kinds: [NOSTR_KINDS.GUILD_ROLE], "#p": [profilePubkey], limit: 1200 }
    ];

    const sub = subscribeMany(relays, filters, {
      onevent: (event: any) => {
        if (!validateEvent(event) || !verifyEvent(event)) return;
        const guild = parseGuildEvent(event);
        if (guild) {
          const key = makeGuildKey(guild.pubkey, guild.guildId);
          const prevTs = seenGuild.current.get(key);
          if (!prevTs || guild.createdAt > prevTs) {
            seenGuild.current.set(key, guild.createdAt);
            setGuildByKey((existing) => ({ ...existing, [key]: guild }));
          }
          return;
        }

        const membership = parseGuildMembershipEvent(event);
        if (membership && membership.pubkey === profilePubkey) {
          const key = makeGuildKey(membership.guildPubkey, membership.guildId);
          const prevTs = seenMembership.current.get(key);
          if (!prevTs || membership.createdAt > prevTs) {
            seenMembership.current.set(key, membership.createdAt);
            setMembershipByKey((existing) => ({
              ...existing,
              [key]: {
                guildPubkey: membership.guildPubkey,
                guildId: membership.guildId,
                status: membership.status,
                createdAt: membership.createdAt
              }
            }));
          }
          return;
        }

        const role = parseGuildRoleEvent(event);
        if (role && role.targetPubkey === profilePubkey) {
          const key = makeGuildKey(role.guildPubkey, role.guildId);
          const prevTs = seenRole.current.get(key);
          if (!prevTs || role.createdAt > prevTs) {
            seenRole.current.set(key, role.createdAt);
            setRoleByKey((existing) => ({
              ...existing,
              [key]: {
                guildPubkey: role.guildPubkey,
                guildId: role.guildId,
                role: role.role,
                createdAt: role.createdAt
              }
            }));
          }
        }
      },
      oneose: () => setIsLoading(false)
    });

    const timeout = setTimeout(() => setIsLoading(false), 5000);
    return () => {
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [profilePubkey, relays]);

  const guildRows = useMemo<ProfileGuildStatusRow[]>(() => {
    if (!profilePubkey || !isHex64(profilePubkey)) return [];

    const keys = new Set<string>();
    for (const guild of Object.values(guildByKey)) {
      if (guild.pubkey === profilePubkey) keys.add(makeGuildKey(guild.pubkey, guild.guildId));
    }
    for (const [key, membership] of Object.entries(membershipByKey)) {
      if (membership.status === "joined") keys.add(key);
    }
    for (const [key, role] of Object.entries(roleByKey)) {
      if (role.role !== "none") keys.add(key);
    }

    const rows: ProfileGuildStatusRow[] = [];
    for (const key of keys) {
      const guild = guildByKey[key];
      const membership = membershipByKey[key];
      const role = roleByKey[key];
      const guildPubkey = guild?.pubkey ?? membership?.guildPubkey ?? role?.guildPubkey ?? "";
      const guildId = guild?.guildId ?? membership?.guildId ?? role?.guildId ?? "";
      if (!guildPubkey || !guildId) continue;

      let status: ProfileGuildStatus | null = null;
      if (guildPubkey === profilePubkey) status = "owner";
      else if (role?.role === "admin") status = "admin";
      else if (role?.role === "moderator") status = "guest_vip";
      else if (role?.role === "member" || membership?.status === "joined") status = "member";

      if (!status) continue;
      rows.push({
        key,
        guildPubkey,
        guildId,
        guildName: guild?.name?.trim() || guildId,
        guildImage: guild?.image,
        status,
        updatedAt: Math.max(guild?.createdAt ?? 0, membership?.createdAt ?? 0, role?.createdAt ?? 0)
      });
    }

    rows.sort((left, right) => {
      const statusDelta = STATUS_SORT[right.status] - STATUS_SORT[left.status];
      if (statusDelta !== 0) return statusDelta;
      if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
      return left.guildName.localeCompare(right.guildName);
    });

    return rows;
  }, [guildByKey, membershipByKey, profilePubkey, roleByKey]);

  return {
    isLoading,
    guildRows
  };
}

