import type { NostrEvent, P2PBytesReceipt } from "./types";
import { NOSTR_KINDS } from "./types";
import { assertStreamIdentity, getFirstTagValue, makeATag } from "./nostr";
import { isHex64 } from "./validate";

export interface BuildP2PBytesReceiptInput {
  pubkey: string; // receipt publisher
  createdAt: number;
  streamPubkey: string;
  streamId: string;
  fromPubkey: string; // peer credited for served bytes
  servedBytes: number;
  observedAtMs: number;
  sessionId?: string;
}

export function buildP2PBytesReceiptEvent(input: BuildP2PBytesReceiptInput): Omit<NostrEvent, "id" | "sig"> {
  if (!isHex64(input.pubkey)) throw new Error("pubkey must be 64-hex");
  if (!isHex64(input.fromPubkey)) throw new Error("fromPubkey must be 64-hex");
  assertStreamIdentity(input.streamPubkey, input.streamId);
  if (!Number.isInteger(input.servedBytes) || input.servedBytes < 0) throw new Error("servedBytes must be a non-negative integer");
  if (!Number.isFinite(input.observedAtMs) || input.observedAtMs <= 0) throw new Error("observedAtMs must be a positive number");

  return {
    kind: NOSTR_KINDS.P2P_BYTES_RECEIPT,
    pubkey: input.pubkey,
    created_at: input.createdAt,
    tags: [
      ["a", makeATag(input.streamPubkey, input.streamId)],
      ["p", input.fromPubkey]
    ],
    content: JSON.stringify({
      v: 1,
      t: "p2p_bytes_receipt",
      streamPubkey: input.streamPubkey,
      streamId: input.streamId,
      fromPubkey: input.fromPubkey,
      servedBytes: input.servedBytes,
      observedAtMs: input.observedAtMs,
      sessionId: input.sessionId
    })
  };
}

export function parseP2PBytesReceiptEvent(
  event: NostrEvent,
  scope: { streamPubkey: string; streamId: string }
): P2PBytesReceipt | null {
  if (!event || event.kind !== NOSTR_KINDS.P2P_BYTES_RECEIPT) return null;
  if (!event.pubkey || !event.tags) return null;

  const a = getFirstTagValue(event.tags, "a");
  if (!a || a !== makeATag(scope.streamPubkey, scope.streamId)) return null;

  let obj: any;
  try {
    obj = JSON.parse(event.content || "{}");
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || obj.v !== 1 || obj.t !== "p2p_bytes_receipt") return null;
  if (obj.streamPubkey !== scope.streamPubkey || obj.streamId !== scope.streamId) return null;
  if (typeof obj.fromPubkey !== "string" || !isHex64(obj.fromPubkey)) return null;
  if (typeof obj.servedBytes !== "number" || !Number.isInteger(obj.servedBytes) || obj.servedBytes < 0) return null;
  if (typeof obj.observedAtMs !== "number" || !Number.isFinite(obj.observedAtMs) || obj.observedAtMs <= 0) return null;
  if (obj.sessionId != null && typeof obj.sessionId !== "string") return null;

  const tagFrom = getFirstTagValue(event.tags, "p");
  if (!tagFrom || tagFrom !== obj.fromPubkey) return null;

  return {
    pubkey: event.pubkey,
    fromPubkey: obj.fromPubkey.toLowerCase(),
    streamPubkey: scope.streamPubkey,
    streamId: scope.streamId,
    servedBytes: obj.servedBytes,
    observedAtMs: obj.observedAtMs,
    sessionId: obj.sessionId,
    createdAt: event.created_at,
    raw: event
  };
}

