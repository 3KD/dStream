import { normalizeProofPubkey, readAccessOperatorPubkeys, verifyAccessProof } from "@/lib/access/proof";
import { ACCESS_ACTIONS, type AccessAction } from "@/lib/access/types";

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
  hostPubkey: string
): { ok: true; actorPubkey: string } | { ok: false; status: number; error: string } {
  if (parseBoolean(process.env.DSTREAM_ACCESS_ALLOW_UNAUTH)) {
    return { ok: true, actorPubkey: "0".repeat(64) };
  }
  const proof = verifyAccessProof(proofEvent, "access_admin");
  if (!proof.ok) return proof;
  if (proof.pubkey === hostPubkey) return { ok: true, actorPubkey: proof.pubkey };
  const operators = readAccessOperatorPubkeys();
  if (operators.includes(proof.pubkey)) return { ok: true, actorPubkey: proof.pubkey };
  return { ok: false, status: 403, error: "Signed proof pubkey is not authorized for this host." };
}

