import { validateEvent, verifyEvent } from "nostr-tools";
import type { NostrEvent } from "@dstream/protocol";

const MAX_PROOF_FUTURE_SEC = 60 * 60;
const MAX_PROOF_AGE_SEC = 15 * 60;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizePubkeyHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function getFirstTagValue(tags: string[][] | undefined, name: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (tag[0] !== name) continue;
    const value = (tag[1] ?? "").trim();
    if (!value) continue;
    return value;
  }
  return null;
}

function isSignedEvent(input: NostrEvent): input is NostrEvent & { id: string; sig: string } {
  return typeof input.id === "string" && input.id.length > 0 && typeof input.sig === "string" && input.sig.length > 0;
}

export function verifyAccessProof(
  proofEvent: unknown,
  scope: string
): { ok: true; pubkey: string } | { ok: false; status: number; error: string } {
  if (!proofEvent || typeof proofEvent !== "object") {
    return { ok: false, status: 401, error: "Signed proof is required." };
  }

  const event = proofEvent as NostrEvent;
  if (!isSignedEvent(event) || !validateEvent(event as any) || !verifyEvent(event as any)) {
    return { ok: false, status: 401, error: "Signed proof event is invalid." };
  }

  const pubkey = normalizePubkeyHex(event.pubkey);
  if (!pubkey) return { ok: false, status: 401, error: "Signed proof pubkey is invalid." };

  const scopeTag = getFirstTagValue(event.tags, "dstream");
  if (scopeTag !== scope) {
    return { ok: false, status: 401, error: `Signed proof scope must be ${scope}.` };
  }

  const now = nowSec();
  const expRaw = getFirstTagValue(event.tags, "exp");
  const expSec = expRaw && /^\d+$/.test(expRaw) ? Number(expRaw) : 0;
  if (!Number.isInteger(expSec) || expSec <= now || expSec > now + MAX_PROOF_FUTURE_SEC) {
    return { ok: false, status: 401, error: "Signed proof expiration is invalid." };
  }
  if (event.created_at > now + 30 || now - event.created_at > MAX_PROOF_AGE_SEC) {
    return { ok: false, status: 401, error: "Signed proof timestamp is stale." };
  }

  return { ok: true, pubkey };
}

export function readAccessOperatorPubkeys(): string[] {
  const raw = (process.env.DSTREAM_ACCESS_OPERATOR_PUBKEYS ?? process.env.NEXT_PUBLIC_DISCOVERY_OPERATOR_PUBKEYS ?? "").trim();
  if (!raw) return [];
  const set = new Set<string>();
  for (const part of raw.split(/[\n,]+/g)) {
    const normalized = normalizePubkeyHex(part);
    if (normalized) set.add(normalized);
  }
  return Array.from(set);
}

export function normalizeProofPubkey(input: unknown): string | null {
  return normalizePubkeyHex(input);
}

