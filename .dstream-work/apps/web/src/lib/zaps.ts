import { makeATag } from "@dstream/protocol";

export const NIP57_ZAP_REQUEST_KIND = 9734;
export const NIP57_ZAP_RECEIPT_KIND = 9735;

export interface ParsedZapRequest {
  pubkey: string;
  streamATag: string | null;
  eventId: string | null;
  amountMsat: number | null;
  comment: string;
}

export interface ParsedZapReceipt {
  id: string;
  createdAt: number;
  senderPubkey: string;
  recipientPubkey: string;
  sats: number;
  eventId: string | null;
  streamATag: string | null;
  request: ParsedZapRequest | null;
}

function parseAmountMsat(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function parseBolt11Sats(invoiceRaw: string | null | undefined): number | null {
  const invoice = (invoiceRaw ?? "").trim().toLowerCase();
  if (!invoice) return null;
  const match = invoice.match(/^ln(?:bc|tb|bcrt|sb|tbs)(\d+)?([munp]?)/i);
  if (!match) return null;

  const amountDigits = match[1];
  const unit = (match[2] ?? "").toLowerCase();
  if (!amountDigits) return null;

  const amount = Number(amountDigits);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const satMultipliers: Record<string, number> = {
    "": 100_000_000,
    m: 100_000,
    u: 100,
    n: 0.1,
    p: 0.0001
  };
  const sats = amount * (satMultipliers[unit] ?? satMultipliers[""]);
  if (!Number.isFinite(sats) || sats <= 0) return null;
  return Math.max(1, Math.floor(sats));
}

function parseZapRequestFromDescription(descriptionRaw: string | null | undefined): ParsedZapRequest | null {
  const description = (descriptionRaw ?? "").trim();
  if (!description) return null;
  try {
    const parsed = JSON.parse(description);
    if (!parsed || typeof parsed !== "object") return null;
    const kind = (parsed as any).kind;
    if (kind !== NIP57_ZAP_REQUEST_KIND) return null;
    const pubkey = String((parsed as any).pubkey ?? "").trim().toLowerCase();
    if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return null;
    const tags = Array.isArray((parsed as any).tags) ? ((parsed as any).tags as unknown[]) : [];
    let streamATag: string | null = null;
    let eventId: string | null = null;
    let amountMsat: number | null = null;
    for (const tag of tags) {
      if (!Array.isArray(tag) || tag.length < 2) continue;
      const name = String(tag[0] ?? "");
      const value = String(tag[1] ?? "").trim();
      if (!name || !value) continue;
      if (name === "a" && !streamATag) streamATag = value;
      if (name === "e" && !eventId) eventId = value;
      if (name === "amount" && amountMsat === null) amountMsat = parseAmountMsat(value);
    }
    const comment = String((parsed as any).content ?? "");
    return { pubkey, streamATag, eventId, amountMsat, comment };
  } catch {
    return null;
  }
}

function extractTagValue(tags: unknown, name: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length < 2) continue;
    if (String(tag[0] ?? "") !== name) continue;
    const value = String(tag[1] ?? "").trim();
    if (value) return value;
  }
  return null;
}

export function parseZapReceiptEvent(event: any): ParsedZapReceipt | null {
  if (!event || event.kind !== NIP57_ZAP_RECEIPT_KIND) return null;
  const id = String(event.id ?? "").trim();
  const createdAt = Number(event.created_at ?? 0);
  const senderPubkey = String(event.pubkey ?? "").trim().toLowerCase();
  if (!id || !Number.isFinite(createdAt) || createdAt <= 0 || !/^[0-9a-f]{64}$/i.test(senderPubkey)) return null;

  const recipientPubkey = extractTagValue(event.tags, "p");
  if (!recipientPubkey || !/^[0-9a-f]{64}$/i.test(recipientPubkey)) return null;

  const bolt11 = extractTagValue(event.tags, "bolt11");
  const description = extractTagValue(event.tags, "description");
  const request = parseZapRequestFromDescription(description);
  const amountFromBolt = parseBolt11Sats(bolt11);
  const amountFromTag = parseAmountMsat(extractTagValue(event.tags, "amount"));
  const amountFromRequest = request?.amountMsat ?? null;
  const amountMsat = amountFromTag ?? amountFromRequest;
  const sats = amountFromBolt ?? (amountMsat !== null ? Math.max(1, Math.floor(amountMsat / 1000)) : 0);

  if (sats <= 0) return null;

  return {
    id,
    createdAt,
    senderPubkey,
    recipientPubkey,
    sats,
    eventId: request?.eventId ?? extractTagValue(event.tags, "e"),
    streamATag: request?.streamATag ?? extractTagValue(event.tags, "a"),
    request
  };
}

export function isZapReceiptForStream(receipt: ParsedZapReceipt, streamPubkey: string, streamId: string): boolean {
  const normalizedPubkey = (streamPubkey ?? "").trim().toLowerCase();
  const normalizedStreamId = (streamId ?? "").trim();
  if (!normalizedPubkey || !normalizedStreamId) return false;
  if (receipt.recipientPubkey !== normalizedPubkey) return false;
  const streamATag = makeATag(normalizedPubkey, normalizedStreamId);
  if (!receipt.streamATag) return true;
  return receipt.streamATag === streamATag;
}

export function buildZapRequestUnsigned(input: {
  senderPubkey: string;
  recipientPubkey: string;
  streamId: string;
  amountSats: number;
  relays: string[];
  comment?: string;
}) {
  const amountMsat = Math.max(1, Math.floor(input.amountSats)) * 1000;
  const relayValues = Array.from(
    new Set(
      (input.relays ?? [])
        .map((relay) => relay.trim())
        .filter((relay) => relay.length > 0)
        .slice(0, 8)
    )
  );
  return {
    kind: NIP57_ZAP_REQUEST_KIND,
    pubkey: input.senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: (input.comment ?? "").trim(),
    tags: [
      ["p", input.recipientPubkey],
      ["a", makeATag(input.recipientPubkey, input.streamId)],
      ["amount", String(amountMsat)],
      ["relays", ...relayValues]
    ]
  };
}
