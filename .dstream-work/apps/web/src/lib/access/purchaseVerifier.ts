import type { VideoAccessPackage } from "./packages";
import { PAYMENT_RAIL_IDS, type PaymentRailId, type PaymentSettlementProof, type VerifiedPaymentSettlement } from "@dstream/protocol";
import { makeATag } from "@dstream/protocol";
import { buildCanonicalSettlementSourceRef, normalizeVerifiedPaymentSettlement } from "../payments/settlement";
import { getPaymentRailForAsset } from "../payments/rails";
import { parseZapReceiptEvent } from "../zaps";
import { validateEvent, verifyEvent } from "nostr-tools";
import { verifyOnchainPurchase } from "./onchainPurchaseVerifier";

const DEFAULT_VERIFY_TIMEOUT_MS = 12_000;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  try {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function resolveRailId(input: string | null | undefined, fallbackAsset: VideoAccessPackage["paymentAsset"]): PaymentRailId {
  const candidate = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (PAYMENT_RAIL_IDS.includes(candidate as PaymentRailId)) {
    return candidate as PaymentRailId;
  }
  return getPaymentRailForAsset(fallbackAsset).id;
}

function parseBtcAmountToSats(amountRaw: string): bigint | null {
  const raw = amountRaw.trim();
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fractionRaw = match[2] ?? "";
  if (fractionRaw.length > 8) return null;
  const fraction = fractionRaw.padEnd(8, "0");
  try {
    const sats = BigInt(whole) * 100_000_000n + BigInt(fraction || "0");
    return sats > 0n ? sats : null;
  } catch {
    return null;
  }
}

function extractZapReceiptProofEvent(input: unknown): Record<string, unknown> | null {
  const direct = asObject(input);
  if (direct && direct.kind === 9735) return direct;

  const proof = asObject(input);
  if (!proof) return null;
  if (proof.proofType !== "nip57_zap_receipt") return null;
  const payload = asObject(proof.payload);
  if (!payload) return null;
  const event = asObject(payload.receiptEvent ?? payload.event);
  if (!event || event.kind !== 9735) return null;
  return event;
}

function buildLightningZapSettlement(receiptId: string, amountSats: number): VerifiedPaymentSettlement {
  return {
    version: 1,
    railId: "lightning",
    asset: "btc",
    settlementKind: "nip57_zap_receipt",
    settlementRef: `receipt:${receiptId}`,
    txRef: receiptId,
    amountAtomic: String(Math.max(1, Math.floor(amountSats))),
    confirmed: true,
    observedAtMs: Date.now(),
    verifier: "host_origin"
  };
}

function buildCompatSettlement(input: {
  package: VideoAccessPackage;
  settlementRef?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}): VerifiedPaymentSettlement {
  const railId = resolveRailId(input.package.paymentRailId, input.package.paymentAsset);
  const settlementRef = asString(input.settlementRef) || asString(input.sourceRef) || `${railId}:verified`;
  const txRef = asString((input.metadata as { txRef?: unknown } | undefined)?.txRef) || settlementRef;
  return {
    version: 1,
    railId,
    asset: input.package.paymentAsset,
    settlementKind: "purchase",
    settlementRef,
    txRef,
    confirmed: true,
    observedAtMs: Date.now(),
    verifier: "external_verifier",
    metadata: input.metadata
  };
}

function parseTimeoutMs(): number {
  const raw = Number((process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_TIMEOUT_MS ?? "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_VERIFY_TIMEOUT_MS;
  return Math.max(500, Math.min(Math.trunc(raw), 60_000));
}

function buildVerifierUrl(): string {
  return (process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_URL ?? "").trim();
}

function buildVerifierSecret(): string {
  return (process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_SECRET ?? "").trim();
}

async function parseVerifierError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body === "object") {
      const message = asString((body as { error?: unknown }).error);
      if (message) return message;
    }
  } catch {
    // ignore json parse failure
  }
  try {
    const text = (await response.text()).trim();
    if (text) return text.slice(0, 500);
  } catch {
    // ignore text parse failure
  }
  return `verification failed (${response.status})`;
}

export interface ExternalPurchaseVerificationInput {
  package: VideoAccessPackage;
  buyerPubkey: string;
  buyerProofEvent: unknown;
  sourceRef?: string;
  settlementRef?: string;
  paymentProof?: PaymentSettlementProof | Record<string, unknown> | null;
  settlementProof?: PaymentSettlementProof | Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export interface ExternalPurchaseVerificationResult {
  supported: boolean;
  verified: boolean;
  status: number;
  error?: string;
  sourceRef?: string;
  settlementRef?: string;
  settlement?: VerifiedPaymentSettlement;
  metadata?: Record<string, unknown>;
}

export function hasExternalPurchaseVerifier(): boolean {
  return !!buildVerifierUrl();
}

async function verifyBuiltInPurchase(input: ExternalPurchaseVerificationInput): Promise<ExternalPurchaseVerificationResult> {
  const railId = resolveRailId(input.package.paymentRailId, input.package.paymentAsset);
  if (railId !== "lightning") return verifyOnchainPurchase(input);

  const requiredSats = parseBtcAmountToSats(input.package.paymentAmount);
  if (requiredSats === null) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "Lightning package amount is invalid."
    };
  }

  const receiptEvent = extractZapReceiptProofEvent(input.settlementProof) ?? extractZapReceiptProofEvent(input.paymentProof);
  if (!receiptEvent) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "Lightning packages require a signed NIP-57 zap receipt settlement proof."
    };
  }

  if (!validateEvent(receiptEvent as any) || !verifyEvent(receiptEvent as any)) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "Lightning settlement proof must be a valid signed zap receipt."
    };
  }

  const receipt = parseZapReceiptEvent(receiptEvent);
  if (!receipt) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "Lightning settlement proof could not be parsed as a zap receipt."
    };
  }

  if (receipt.recipientPubkey !== input.package.hostPubkey) {
    return {
      supported: true,
      verified: false,
      status: 403,
      error: "Lightning zap receipt recipient does not match package host."
    };
  }

  if (!receipt.request) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "Lightning zap receipt is missing the signed zap request description."
    };
  }

  if (receipt.request.pubkey !== input.buyerPubkey) {
    return {
      supported: true,
      verified: false,
      status: 403,
      error: "Lightning zap receipt buyer does not match purchase proof."
    };
  }

  if (receipt.request.packageId !== input.package.id) {
    return {
      supported: true,
      verified: false,
      status: 403,
      error: "Lightning zap receipt package tag does not match the requested package."
    };
  }

  const expectedATag = makeATag(input.package.hostPubkey, input.package.streamId);
  if (receipt.request.streamATag && receipt.request.streamATag !== expectedATag) {
    return {
      supported: true,
      verified: false,
      status: 403,
      error: "Lightning zap receipt stream scope does not match package stream."
    };
  }

  if (BigInt(receipt.sats) < requiredSats) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: `Lightning settlement is below package price (${requiredSats.toString()} sats required).`
    };
  }

  const settlement = buildLightningZapSettlement(receipt.id, receipt.sats);
  settlement.metadata = {
    proofType: "nip57_zap_receipt",
    receiptId: receipt.id,
    receiptCreatedAt: receipt.createdAt,
    recipientPubkey: receipt.recipientPubkey,
    streamATag: receipt.request.streamATag ?? null,
    packageId: receipt.request.packageId ?? null,
    buyerPubkey: receipt.request.pubkey,
    amountSats: receipt.sats,
    eventId: receipt.eventId ?? null
  };

  return {
    supported: true,
    verified: true,
    status: 200,
    sourceRef: buildCanonicalSettlementSourceRef(settlement),
    settlementRef: settlement.settlementRef,
    settlement,
    metadata: settlement.metadata
  };
}

export async function verifyPurchaseSettlement(input: ExternalPurchaseVerificationInput): Promise<ExternalPurchaseVerificationResult> {
  const builtIn = await verifyBuiltInPurchase(input);
  if (builtIn.supported) return builtIn;
  return verifyExternalPurchase(input);
}

export async function verifyExternalPurchase(input: ExternalPurchaseVerificationInput): Promise<ExternalPurchaseVerificationResult> {
  const url = buildVerifierUrl();
  if (!url) {
    return {
      supported: false,
      verified: false,
      status: 200
    };
  }

  const timeoutMs = parseTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const secret = buildVerifierSecret();
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (secret) headers.authorization = `Bearer ${secret}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        package: {
          id: input.package.id,
          hostPubkey: input.package.hostPubkey,
          streamId: input.package.streamId,
          playlistId: input.package.playlistId,
          relativePath: input.package.relativePath,
          resourceId: input.package.resourceId,
          paymentAsset: input.package.paymentAsset,
          paymentAmount: input.package.paymentAmount,
          paymentRailId: input.package.paymentRailId,
          paymentTarget: input.package.paymentTarget,
          durationHours: input.package.durationHours
        },
        buyerPubkey: input.buyerPubkey,
        buyerProofEvent: input.buyerProofEvent,
        sourceRef: input.sourceRef,
        settlementRef: input.settlementRef,
        paymentProof: input.paymentProof,
        settlementProof: input.settlementProof ?? input.paymentProof,
        metadata: input.metadata ?? {}
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        supported: true,
        verified: false,
        status: response.status >= 400 && response.status < 600 ? response.status : 502,
        error: await parseVerifierError(response)
      };
    }

    const body = (await response.json().catch(() => null)) as
      | {
          ok?: unknown;
          verified?: unknown;
          sourceRef?: unknown;
          settlementRef?: unknown;
          metadata?: unknown;
          error?: unknown;
        }
      | null;

    const bodyOk = body?.ok === true || body?.ok === undefined;
    const verified = body?.verified === true;
    if (!bodyOk || !verified) {
      const message = asString(body?.error) || "payment verification did not confirm settlement";
      return {
        supported: true,
        verified: false,
        status: 402,
        error: message
      };
    }

    const settlementMetadata = sanitizeMetadata(body?.metadata);
    const settlement =
      normalizeVerifiedPaymentSettlement((body as { settlement?: unknown } | null)?.settlement) ??
      buildCompatSettlement({
        package: input.package,
        settlementRef: asString(body?.settlementRef) || undefined,
        sourceRef: asString(body?.sourceRef) || undefined,
        metadata: settlementMetadata
      });

    return {
      supported: true,
      verified: true,
      status: 200,
      sourceRef: asString(body?.sourceRef) || (settlement ? buildCanonicalSettlementSourceRef(settlement) : undefined),
      settlementRef: asString(body?.settlementRef) || settlement?.settlementRef,
      settlement: settlement ?? undefined,
      metadata: settlementMetadata
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      return {
        supported: true,
        verified: false,
        status: 504,
        error: `payment verification timeout (${timeoutMs}ms)`
      };
    }
    return {
      supported: true,
      verified: false,
      status: 502,
      error: `payment verification request failed (${error?.message ?? "unknown error"})`
    };
  } finally {
    clearTimeout(timeout);
  }
}
