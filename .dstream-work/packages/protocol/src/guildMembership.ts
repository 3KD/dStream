import type { GuildMembership, GuildMembershipStatus, GuildRole, GuildRoleAssignment, NostrEvent } from "./types";
import { NOSTR_KINDS } from "./types";
import { getFirstTagValue, makeGuildATag, makeGuildKey, parseGuildATag } from "./nostr";
import { isHex64 } from "./validate";

const MEMBERSHIP_STATUSES: ReadonlySet<GuildMembershipStatus> = new Set(["joined", "left"]);
const GUILD_ROLES: ReadonlySet<GuildRole> = new Set(["member", "moderator", "admin", "none"]);

function makeGuildMembershipDTag(input: { guildPubkey: string; guildId: string; memberPubkey: string }): string {
  return `${makeGuildKey(input.guildPubkey, input.guildId)}:${input.memberPubkey}`;
}

export interface BuildGuildMembershipInput {
  pubkey: string;
  createdAt: number;
  guildPubkey: string;
  guildId: string;
  status: GuildMembershipStatus;
}

export function buildGuildMembershipEvent(input: BuildGuildMembershipInput): Omit<NostrEvent, "id" | "sig"> {
  if (!isHex64(input.pubkey)) throw new Error("pubkey must be 64-hex");
  if (!isHex64(input.guildPubkey)) throw new Error("guildPubkey must be 64-hex");
  if (!input.guildId.trim()) throw new Error("guildId must be non-empty");
  if (!MEMBERSHIP_STATUSES.has(input.status)) throw new Error("status must be one of: joined, left");

  return {
    kind: NOSTR_KINDS.GUILD_MEMBERSHIP,
    pubkey: input.pubkey.toLowerCase(),
    created_at: input.createdAt,
    tags: [
      ["a", makeGuildATag(input.guildPubkey.toLowerCase(), input.guildId)],
      ["d", makeGuildMembershipDTag({ guildPubkey: input.guildPubkey.toLowerCase(), guildId: input.guildId, memberPubkey: input.pubkey.toLowerCase() })],
      ["status", input.status]
    ],
    content: ""
  };
}

export function parseGuildMembershipEvent(event: NostrEvent): GuildMembership | null {
  if (!event || event.kind !== NOSTR_KINDS.GUILD_MEMBERSHIP) return null;
  if (!event.pubkey || !isHex64(event.pubkey)) return null;

  const parsedGuild = parseGuildATag(getFirstTagValue(event.tags ?? [], "a") ?? "");
  if (!parsedGuild) return null;

  const statusRaw = getFirstTagValue(event.tags ?? [], "status");
  if (!statusRaw || !MEMBERSHIP_STATUSES.has(statusRaw as GuildMembershipStatus)) return null;
  const status = statusRaw as GuildMembershipStatus;

  const memberPubkey = event.pubkey.toLowerCase();
  const dTag = getFirstTagValue(event.tags ?? [], "d");
  if (!dTag || dTag !== makeGuildMembershipDTag({ guildPubkey: parsedGuild.guildPubkey, guildId: parsedGuild.guildId, memberPubkey })) {
    return null;
  }

  return {
    pubkey: memberPubkey,
    guildPubkey: parsedGuild.guildPubkey,
    guildId: parsedGuild.guildId,
    status,
    createdAt: event.created_at,
    raw: event
  };
}

export interface BuildGuildRoleInput {
  pubkey: string; // guild owner
  createdAt: number;
  guildPubkey: string;
  guildId: string;
  targetPubkey: string;
  role: GuildRole;
}

export function buildGuildRoleEvent(input: BuildGuildRoleInput): Omit<NostrEvent, "id" | "sig"> {
  if (!isHex64(input.pubkey)) throw new Error("pubkey must be 64-hex");
  if (!isHex64(input.guildPubkey)) throw new Error("guildPubkey must be 64-hex");
  if (!isHex64(input.targetPubkey)) throw new Error("targetPubkey must be 64-hex");
  if (!input.guildId.trim()) throw new Error("guildId must be non-empty");
  if (input.pubkey.toLowerCase() !== input.guildPubkey.toLowerCase()) {
    throw new Error("pubkey must equal guildPubkey for role assignment events");
  }
  if (!GUILD_ROLES.has(input.role)) throw new Error("role must be one of: member, moderator, admin, none");

  return {
    kind: NOSTR_KINDS.GUILD_ROLE,
    pubkey: input.pubkey.toLowerCase(),
    created_at: input.createdAt,
    tags: [
      ["a", makeGuildATag(input.guildPubkey.toLowerCase(), input.guildId)],
      ["d", makeGuildMembershipDTag({ guildPubkey: input.guildPubkey.toLowerCase(), guildId: input.guildId, memberPubkey: input.targetPubkey.toLowerCase() })],
      ["p", input.targetPubkey.toLowerCase()],
      ["role", input.role]
    ],
    content: ""
  };
}

export function parseGuildRoleEvent(event: NostrEvent): GuildRoleAssignment | null {
  if (!event || event.kind !== NOSTR_KINDS.GUILD_ROLE) return null;
  if (!event.pubkey || !isHex64(event.pubkey)) return null;

  const parsedGuild = parseGuildATag(getFirstTagValue(event.tags ?? [], "a") ?? "");
  if (!parsedGuild) return null;
  if (event.pubkey.toLowerCase() !== parsedGuild.guildPubkey) return null;

  const targetPubkey = getFirstTagValue(event.tags ?? [], "p")?.toLowerCase();
  if (!targetPubkey || !isHex64(targetPubkey)) return null;

  const roleRaw = getFirstTagValue(event.tags ?? [], "role");
  if (!roleRaw || !GUILD_ROLES.has(roleRaw as GuildRole)) return null;
  const role = roleRaw as GuildRole;

  const dTag = getFirstTagValue(event.tags ?? [], "d");
  if (!dTag || dTag !== makeGuildMembershipDTag({ guildPubkey: parsedGuild.guildPubkey, guildId: parsedGuild.guildId, memberPubkey: targetPubkey })) {
    return null;
  }

  return {
    pubkey: event.pubkey.toLowerCase(),
    guildPubkey: parsedGuild.guildPubkey,
    guildId: parsedGuild.guildId,
    targetPubkey,
    role,
    createdAt: event.created_at,
    raw: event
  };
}
