import type { NostrEvent, P2PSignalEnvelope, P2PSignalPayloadV1, P2PSignalType } from "./types";
import { NOSTR_KINDS } from "./types";
import { assertStreamIdentity, getAllTagValues, getFirstTagValue, makeATag, parseStreamATag } from "./nostr";
import { isHex64 } from "./validate";

export interface BuildP2PSignalEventInput {
  pubkey: string;
  createdAt: number;
  recipientPubkey: string;
  streamPubkey: string;
  streamId: string;
  content: string;
  expiresAt?: number;
}

export function buildP2PSignalEvent(input: BuildP2PSignalEventInput): Omit<NostrEvent, "id" | "sig"> {
  assertStreamIdentity(input.pubkey, input.streamId);
  assertStreamIdentity(input.streamPubkey, input.streamId);
  if (!isHex64(input.recipientPubkey)) throw new Error("recipientPubkey must be 64-hex");
  if (typeof input.content !== "string") throw new Error("content must be a string");

  const tags: string[][] = [
    ["p", input.recipientPubkey],
    ["a", makeATag(input.streamPubkey, input.streamId)]
  ];

  if (typeof input.expiresAt === "number" && Number.isFinite(input.expiresAt) && input.expiresAt > 0) {
    tags.push(["expiration", String(Math.floor(input.expiresAt))]);
  }

  return {
    kind: NOSTR_KINDS.P2P_SIGNAL,
    pubkey: input.pubkey,
    created_at: input.createdAt,
    content: input.content,
    tags
  };
}

export function parseP2PSignalEvent(
  event: NostrEvent,
  scope?: { streamPubkey?: string; streamId?: string; recipientPubkey?: string }
): P2PSignalEnvelope | null {
  if (!event || event.kind !== NOSTR_KINDS.P2P_SIGNAL) return null;
  if (!event.pubkey || !event.tags) return null;

  const recipientPubkey = getFirstTagValue(event.tags, "p");
  if (!recipientPubkey || !isHex64(recipientPubkey)) return null;

  if (scope?.recipientPubkey && recipientPubkey !== scope.recipientPubkey) return null;

  const aTags = getAllTagValues(event.tags ?? [], "a");
  const parsed = aTags.map(parseStreamATag).find(Boolean) ?? null;
  if (!parsed) return null;

  if (scope?.streamPubkey && scope?.streamId) {
    const expectedATag = makeATag(scope.streamPubkey, scope.streamId);
    if (!aTags.includes(expectedATag)) return null;
  }

  try {
    assertStreamIdentity(event.pubkey, parsed.streamId);
    assertStreamIdentity(parsed.streamPubkey, parsed.streamId);
  } catch {
    return null;
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    recipientPubkey,
    streamPubkey: parsed.streamPubkey,
    streamId: parsed.streamId,
    createdAt: event.created_at,
    content: event.content ?? "",
    raw: event
  };
}

const ALLOWED_TYPES: P2PSignalType[] = ["offer", "answer", "candidate", "bye", "ping", "pong"];

export function encodeP2PSignalPayload(payload: P2PSignalPayloadV1): string {
  return JSON.stringify(payload);
}

export function decodeP2PSignalPayload(json: string): P2PSignalPayloadV1 | null {
  if (!json || typeof json !== "string") return null;
  let obj: any;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }

  if (!obj || typeof obj !== "object") return null;
  if (obj.v !== 1) return null;
  if (!ALLOWED_TYPES.includes(obj.type)) return null;
  if (typeof obj.sessionId !== "string" || obj.sessionId.length === 0) return null;
  if (typeof obj.streamPubkey !== "string" || !isHex64(obj.streamPubkey)) return null;
  if (typeof obj.streamId !== "string" || obj.streamId.length === 0) return null;

  if (obj.swarmId !== undefined && typeof obj.swarmId !== "string") return null;

  if ((obj.type === "offer" || obj.type === "answer") && typeof obj.sdp !== "string") return null;
  if (obj.type === "candidate" && (typeof obj.candidate !== "object" || obj.candidate === null)) return null;

  return obj as P2PSignalPayloadV1;
}
