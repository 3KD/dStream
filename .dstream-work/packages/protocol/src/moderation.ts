import type {
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

function makeModerationDTag(input: { streamPubkey: string; streamId: string; targetPubkey: string }): string {
  return `${makeStreamKey(input.streamPubkey, input.streamId)}:${input.targetPubkey}`;
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
