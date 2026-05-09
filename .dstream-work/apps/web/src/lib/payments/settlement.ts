import {
  PAYMENT_RAIL_IDS,
  STREAM_PAYMENT_ASSETS,
  type PaymentRailId,
  type StreamPaymentAsset,
  type VerifiedPaymentSettlement
} from "@dstream/protocol";

function sanitizeToken(input: unknown, maxLen = 180): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value) return undefined;
  return value.replace(/[\s|]+/g, "-").slice(0, maxLen);
}

function sanitizeMetadata(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  try {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function normalizeRailId(input: unknown): PaymentRailId | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return PAYMENT_RAIL_IDS.includes(value as PaymentRailId) ? (value as PaymentRailId) : null;
}

function normalizeAsset(input: unknown): StreamPaymentAsset | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return STREAM_PAYMENT_ASSETS.includes(value as StreamPaymentAsset) ? (value as StreamPaymentAsset) : null;
}

function normalizeObservedAtMs(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) return Math.trunc(input);
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  }
  return null;
}

export function buildCanonicalSettlementRef(input: {
  railId: PaymentRailId;
  settlementKind: string;
  settlementRef?: string | null;
  txRef?: string | null;
}): string {
  const explicit = sanitizeToken(input.settlementRef, 220);
  if (explicit) return explicit;
  const txRef = sanitizeToken(input.txRef, 180);
  if (txRef) return `${input.settlementKind}:${txRef}`;
  return `${input.settlementKind}:unresolved`;
}

export function buildCanonicalSettlementSourceRef(settlement: Pick<VerifiedPaymentSettlement, "railId" | "settlementRef">): string {
  return `settlement:v1:${settlement.railId}:${sanitizeToken(settlement.settlementRef, 220) ?? "unknown"}`;
}

export function normalizeVerifiedPaymentSettlement(input: unknown): VerifiedPaymentSettlement | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const railId = normalizeRailId(row.railId);
  const asset = normalizeAsset(row.asset);
  const settlementKind = sanitizeToken(row.settlementKind, 80);
  const confirmed = row.confirmed === true;
  const observedAtMs = normalizeObservedAtMs(row.observedAtMs);
  const verifierRaw = typeof row.verifier === "string" ? row.verifier.trim().toLowerCase() : "";
  const verifier =
    verifierRaw === "host_origin" || verifierRaw === "external_verifier" || verifierRaw === "operator_override"
      ? verifierRaw
      : null;

  if (!railId || !asset || !settlementKind || observedAtMs === null || !verifier) return null;

  return {
    version: 1,
    railId,
    asset,
    settlementKind,
    settlementRef: buildCanonicalSettlementRef({
      railId,
      settlementKind,
      settlementRef: typeof row.settlementRef === "string" ? row.settlementRef : null,
      txRef: typeof row.txRef === "string" ? row.txRef : null
    }),
    txRef: sanitizeToken(row.txRef, 180),
    network: sanitizeToken(row.network, 80),
    amount: sanitizeToken(row.amount, 80),
    amountAtomic: sanitizeToken(row.amountAtomic, 120),
    confirmed,
    observedAtMs,
    verifier,
    metadata: sanitizeMetadata(row.metadata)
  };
}

export function buildSettlementMetadata(settlement: VerifiedPaymentSettlement): Record<string, unknown> {
  return {
    railId: settlement.railId,
    asset: settlement.asset,
    settlementKind: settlement.settlementKind,
    settlementRef: settlement.settlementRef,
    txRef: settlement.txRef ?? null,
    network: settlement.network ?? null,
    amount: settlement.amount ?? null,
    amountAtomic: settlement.amountAtomic ?? null,
    confirmed: settlement.confirmed,
    observedAtMs: settlement.observedAtMs,
    verifier: settlement.verifier,
    verifiedSettlement: settlement
  };
}
