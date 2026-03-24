import type {
  DiscoveryModerationAction,
  DiscoveryModerationRecord,
  DiscoveryModerationTargetType,
  NostrEvent,
  StreamModerationAction,
  StreamModerationRecord,
  StreamModeratorRole,
  StreamModeratorRoleAssignment
} from "./types";
import { NOSTR_KINDS } from "./types";
import { assertStreamIdentity, getFirstTagValue, makeATag, makeStreamKey } from "./nostr";
import { isHex64 } from "./validate";

const MOD_ACTIONS: ReadonlySet<StreamModerationAction> = new Set(["mute", "block", "clear"]);
const MOD_ROLES: ReadonlySet<StreamModeratorRole> = new Set(["moderator", "subscriber", "none"]);
const DISCOVERY_ACTIONS: ReadonlySet<DiscoveryModerationAction> = new Set(["hide", "show"]);
const DISCOVERY_TARGET_TYPES: ReadonlySet<DiscoveryModerationTargetType> = new Set(["pubkey", "stream"]);

function makeModerationDTag(input: { streamPubkey: string; streamId: string; targetPubkey: string }): string {
  return `${makeStreamKey(input.streamPubkey, input.streamId)}:${input.targetPubkey}`;
}

function makeDiscoveryModerationDTag(input: {
  targetType: DiscoveryModerationTargetType;
  targetPubkey: string;
  targetStreamId?: string;
}): string {
  if (input.targetType === "pubkey") return `pubkey:${input.targetPubkey}`;
  return `stream:${makeStreamKey(input.targetPubkey, input.targetStreamId ?? "")}`;
}

export interface BuildStreamModerationInput {
  pubkey: string;
  createdAt: number;
  streamPubkey: string;
  streamId: string;
  targetPubkey: string;
  action: StreamModerationAction;
  reason?: string;
}

export function buildStreamModerationEvent(input: BuildStreamModerationInput): Omit<NostrEvent, "id" | "sig"> {
  if (!isHex64(input.pubkey)) throw new Error("pubkey must be 64-hex");
  if (!isHex64(input.targetPubkey)) throw new Error("targetPubkey must be 64-hex");
  assertStreamIdentity(input.streamPubkey, input.streamId);
  if (!MOD_ACTIONS.has(input.action)) throw new Error("action must be one of: mute, block, clear");

  const tags: string[][] = [
    ["a", makeATag(input.streamPubkey, input.streamId)],
    ["d", makeModerationDTag(input)],
    ["p", input.targetPubkey],
    ["action", input.action]
  ];
  if (input.reason) tags.push(["reason", input.reason.trim()]);

  return {
    kind: NOSTR_KINDS.STREAM_MOD_ACTION,
    pubkey: input.pubkey.toLowerCase(),
    created_at: input.createdAt,
    tags,
    content: ""
  };
}

export function parseStreamModerationEvent(
  event: NostrEvent,
  scope: { streamPubkey: string; streamId: string }
): StreamModerationRecord | null {
  if (!event || event.kind !== NOSTR_KINDS.STREAM_MOD_ACTION) return null;
  if (!isHex64(event.pubkey)) return null;

  const aTag = getFirstTagValue(event.tags ?? [], "a");
  if (!aTag || aTag !== makeATag(scope.streamPubkey, scope.streamId)) return null;

  const targetPubkey = getFirstTagValue(event.tags ?? [], "p")?.toLowerCase();
  if (!targetPubkey || !isHex64(targetPubkey)) return null;

  const actionRaw = getFirstTagValue(event.tags ?? [], "action");
  if (!actionRaw || !MOD_ACTIONS.has(actionRaw as StreamModerationAction)) return null;
  const action = actionRaw as StreamModerationAction;

  const dTag = getFirstTagValue(event.tags ?? [], "d");
  if (!dTag || dTag !== makeModerationDTag({ streamPubkey: scope.streamPubkey, streamId: scope.streamId, targetPubkey })) return null;

  const reason = getFirstTagValue(event.tags ?? [], "reason")?.trim() || undefined;

  return {
    pubkey: event.pubkey.toLowerCase(),
    streamPubkey: scope.streamPubkey,
    streamId: scope.streamId,
    targetPubkey,
    action,
    reason,
    createdAt: event.created_at,
    raw: event
  };
}

export interface BuildStreamModeratorRoleInput {
  pubkey: string;
  createdAt: number;
  streamPubkey: string;
  streamId: string;
  targetPubkey: string;
  role: StreamModeratorRole;
}

export function buildStreamModeratorRoleEvent(input: BuildStreamModeratorRoleInput): Omit<NostrEvent, "id" | "sig"> {
  if (!isHex64(input.pubkey)) throw new Error("pubkey must be 64-hex");
  if (!isHex64(input.targetPubkey)) throw new Error("targetPubkey must be 64-hex");
  assertStreamIdentity(input.streamPubkey, input.streamId);
  if (input.pubkey.toLowerCase() !== input.streamPubkey.toLowerCase()) {
    throw new Error("pubkey must equal streamPubkey for moderator role events");
  }
  if (!MOD_ROLES.has(input.role)) throw new Error("role must be one of: moderator, subscriber, none");

  return {
    kind: NOSTR_KINDS.STREAM_MOD_ROLE,
    pubkey: input.pubkey.toLowerCase(),
    created_at: input.createdAt,
    tags: [
      ["a", makeATag(input.streamPubkey, input.streamId)],
      ["d", makeModerationDTag(input)],
      ["p", input.targetPubkey.toLowerCase()],
      ["role", input.role]
    ],
    content: ""
  };
}

export function parseStreamModeratorRoleEvent(
  event: NostrEvent,
  scope: { streamPubkey: string; streamId: string }
): StreamModeratorRoleAssignment | null {
  if (!event || event.kind !== NOSTR_KINDS.STREAM_MOD_ROLE) return null;
  if (!isHex64(event.pubkey)) return null;
  if (event.pubkey.toLowerCase() !== scope.streamPubkey.toLowerCase()) return null;

  const aTag = getFirstTagValue(event.tags ?? [], "a");
  if (!aTag || aTag !== makeATag(scope.streamPubkey, scope.streamId)) return null;

  const targetPubkey = getFirstTagValue(event.tags ?? [], "p")?.toLowerCase();
  if (!targetPubkey || !isHex64(targetPubkey)) return null;

  const roleRaw = getFirstTagValue(event.tags ?? [], "role");
  if (!roleRaw || !MOD_ROLES.has(roleRaw as StreamModeratorRole)) return null;
  const role = roleRaw as StreamModeratorRole;

  const dTag = getFirstTagValue(event.tags ?? [], "d");
  if (!dTag || dTag !== makeModerationDTag({ streamPubkey: scope.streamPubkey, streamId: scope.streamId, targetPubkey })) return null;

  return {
    pubkey: event.pubkey.toLowerCase(),
    streamPubkey: scope.streamPubkey,
    streamId: scope.streamId,
    targetPubkey,
    role,
    createdAt: event.created_at,
    raw: event
  };
}

export interface BuildDiscoveryModerationInput {
  pubkey: string;
  createdAt: number;
  action: DiscoveryModerationAction;
  targetType: DiscoveryModerationTargetType;
  targetPubkey: string;
  targetStreamId?: string;
  reason?: string;
}

export function buildDiscoveryModerationEvent(input: BuildDiscoveryModerationInput): Omit<NostrEvent, "id" | "sig"> {
  if (!isHex64(input.pubkey)) throw new Error("pubkey must be 64-hex");
  if (!DISCOVERY_ACTIONS.has(input.action)) throw new Error("action must be one of: hide, show");
  if (!DISCOVERY_TARGET_TYPES.has(input.targetType)) throw new Error("targetType must be one of: pubkey, stream");
  if (!isHex64(input.targetPubkey)) throw new Error("targetPubkey must be 64-hex");

  const targetPubkey = input.targetPubkey.toLowerCase();
  let targetStreamId: string | undefined;
  if (input.targetType === "stream") {
    targetStreamId = (input.targetStreamId ?? "").trim();
    if (!targetStreamId) throw new Error("targetStreamId required for stream target");
    assertStreamIdentity(targetPubkey, targetStreamId);
  }

  const tags: string[][] = [
    ["d", makeDiscoveryModerationDTag({ targetType: input.targetType, targetPubkey, targetStreamId })],
    ["action", input.action],
    ["target_type", input.targetType],
    ["target_pubkey", targetPubkey]
  ];

  if (targetStreamId) tags.push(["target_stream_id", targetStreamId]);
  if (input.reason?.trim()) tags.push(["reason", input.reason.trim()]);

  return {
    kind: NOSTR_KINDS.APP_DISCOVERY_MOD,
    pubkey: input.pubkey.toLowerCase(),
    created_at: input.createdAt,
    tags,
    content: ""
  };
}

export function parseDiscoveryModerationEvent(event: NostrEvent): DiscoveryModerationRecord | null {
  if (!event || event.kind !== NOSTR_KINDS.APP_DISCOVERY_MOD) return null;
  if (!isHex64(event.pubkey)) return null;

  const actionRaw = getFirstTagValue(event.tags ?? [], "action");
  if (!actionRaw || !DISCOVERY_ACTIONS.has(actionRaw as DiscoveryModerationAction)) return null;
  const action = actionRaw as DiscoveryModerationAction;

  const targetTypeRaw = getFirstTagValue(event.tags ?? [], "target_type");
  if (!targetTypeRaw || !DISCOVERY_TARGET_TYPES.has(targetTypeRaw as DiscoveryModerationTargetType)) return null;
  const targetType = targetTypeRaw as DiscoveryModerationTargetType;

  const targetPubkey = getFirstTagValue(event.tags ?? [], "target_pubkey")?.toLowerCase();
  if (!targetPubkey || !isHex64(targetPubkey)) return null;

  let targetStreamId: string | undefined;
  if (targetType === "stream") {
    targetStreamId = (getFirstTagValue(event.tags ?? [], "target_stream_id") ?? "").trim();
    if (!targetStreamId) return null;
    try {
      assertStreamIdentity(targetPubkey, targetStreamId);
    } catch {
      return null;
    }
  }

  const dTag = getFirstTagValue(event.tags ?? [], "d");
  if (!dTag || dTag !== makeDiscoveryModerationDTag({ targetType, targetPubkey, targetStreamId })) return null;

  return {
    pubkey: event.pubkey.toLowerCase(),
    action,
    targetType,
    targetPubkey,
    targetStreamId,
    reason: getFirstTagValue(event.tags ?? [], "reason")?.trim() || undefined,
    createdAt: event.created_at,
    raw: event
  };
}
