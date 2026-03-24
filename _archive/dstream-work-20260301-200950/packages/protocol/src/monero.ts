import type { NostrEvent, XmrTipReceipt } from "./types";
import { NOSTR_KINDS } from "./types";
import { assertStreamIdentity, getFirstTagValue, makeATag } from "./nostr";
import { isHex64 } from "./validate";

export interface BuildXmrTipReceiptInput {
  pubkey: string; // receipt publisher (typically broadcaster)
  createdAt: number;
  streamPubkey: string;
  streamId: string;
  amountAtomic: string;
  confirmed: boolean;
  observedAtMs: number;
}

export function buildXmrTipReceiptEvent(input: BuildXmrTipReceiptInput): Omit<NostrEvent, "id" | "sig"> {
  if (!isHex64(input.pubkey)) throw new Error("pubkey must be 64-hex");
  assertStreamIdentity(input.streamPubkey, input.streamId);
  if (!/^\d+$/.test(input.amountAtomic)) throw new Error("amountAtomic must be digits");

  return {
    kind: NOSTR_KINDS.XMR_RECEIPT,
    pubkey: input.pubkey,
    created_at: input.createdAt,
    tags: [["a", makeATag(input.streamPubkey, input.streamId)]],
    content: JSON.stringify({
      v: 1,
      t: "xmr_tip_verified",
      streamPubkey: input.streamPubkey,
      streamId: input.streamId,
      amountAtomic: input.amountAtomic,
      confirmed: input.confirmed,
      observedAtMs: input.observedAtMs
    })
  };
}

export function parseXmrTipReceiptEvent(event: NostrEvent, scope: { streamPubkey: string; streamId: string }): XmrTipReceipt | null {
  if (!event || event.kind !== NOSTR_KINDS.XMR_RECEIPT) return null;
  if (!event.pubkey || !event.tags) return null;

  const a = getFirstTagValue(event.tags, "a");
  if (!a || a !== makeATag(scope.streamPubkey, scope.streamId)) return null;

  let obj: any;
  try {
    obj = JSON.parse(event.content || "{}");
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || obj.v !== 1) return null;
  if (obj.t !== "xmr_tip_verified") return null;
  if (obj.streamPubkey !== scope.streamPubkey || obj.streamId !== scope.streamId) return null;
  if (typeof obj.amountAtomic !== "string" || !/^\d+$/.test(obj.amountAtomic)) return null;
  if (typeof obj.confirmed !== "boolean") return null;
  if (typeof obj.observedAtMs !== "number" || !Number.isFinite(obj.observedAtMs)) return null;

  return {
    pubkey: event.pubkey,
    streamPubkey: scope.streamPubkey,
    streamId: scope.streamId,
    amountAtomic: obj.amountAtomic,
    confirmed: obj.confirmed,
    observedAtMs: obj.observedAtMs,
    createdAt: event.created_at,
    raw: event
  };
}

