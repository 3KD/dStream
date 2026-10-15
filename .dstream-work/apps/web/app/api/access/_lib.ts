import { normalizeProofPubkey, readAccessOperatorPubkeys, verifyAccessProof } from "@/lib/access/proof";
import { ACCESS_ACTIONS, type AccessAction } from "@/lib/access/types";
import { authorizeAdminRequest } from "@/lib/access/requestBinding";
import type { NostrEvent } from "@dstream/protocol";

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePubkey(value: unknown): string {
  const normalized = normalizeProofPubkey(value);
  return normalized ?? "";
}

export function parseActionList(input: unknown): AccessAction[] {
  if (!Array.isArray(input)) return [];
  const actions = new Set<AccessAction>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase();
    if (!ACCESS_ACTIONS.includes(normalized as AccessAction)) continue;
    actions.add(normalized as AccessAction);
  }
  return Array.from(actions);
}

export function parsePositiveInt(input: unknown): number | undefined {
  const value = Number(input);
  if (!Number.isInteger(value)) return undefined;
  if (value <= 0) return undefined;
  return value;
}

export function parseBoolean(input: unknown): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    const normalized = input.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  }
  return false;
}

export function authorizeAccessAdmin(
  proofEvent: unknown,
  hostPubkey: string,
  context?: { request: Request; payload: Record<string, unknown>; bodyDigest?: string }
): { ok: true; actorPubkey: string } | { ok: false; status: number; error: string } {
  if (process.env.NODE_ENV !== "production" && parseBoolean(process.env.DSTREAM_ACCESS_ALLOW_UNAUTH)) {
    return { ok: true, actorPubkey: "0".repeat(64) };
  }
  const proof = verifyAccessProof(proofEvent, "access_admin");
  if (!proof.ok) return proof;
  const operators = readAccessOperatorPubkeys();
  if (proof.pubkey !== hostPubkey && !operators.includes(proof.pubkey)) {
    return { ok: false, status: 403, error: "Signed proof pubkey is not authorized for this host." };
  }
  try {
    if (!context || !authorizeAdminRequest(proofEvent as NostrEvent, context.request, context.payload, context.bodyDigest)) {
      return { ok: false, status: 401, error: "A fresh request-bound admin proof is required." };
    }
  } catch { return { ok: false, status: 503, error: "Admin authorization storage is unavailable." }; }
  return { ok: true, actorPubkey: proof.pubkey };
}
