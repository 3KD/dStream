import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { StreamPaymentAsset } from "@dstream/protocol";
import type { PaymentRailId } from "../rails";
import { readTextFileWithBackup, updateJsonFileAtomic } from "../../storage/jsonFileStore";
import type { VerifiedPayment } from "./types";
import { PaymentVerificationError } from "./types";

const STORE_PATH =
  (process.env.DSTREAM_PAYMENT_INTENT_STORE_PATH ?? "/var/lib/dstream/payment-intents.json").trim() ||
  "/var/lib/dstream/payment-intents.json";
const DEFAULT_TTL_SEC = 30 * 60;
const MAX_TTL_SEC = 24 * 60 * 60;
const MAX_INTENTS = 100_000;

export type PaymentIntentStatus = "pending" | "settled" | "expired" | "failed";
export type PaymentIntentScope =
  | {
      type: "video_package";
      id: string;
      hostPubkey: string;
      streamId: string;
      resourceId: string;
      packageUpdatedAtSec: number;
    }
  | { type: "tip"; id: string; streamPubkey: string; streamId: string };

export interface PaymentIntent {
  id: string;
  scope: PaymentIntentScope;
  buyerPubkey: string;
  recipientPubkey?: string;
  asset: StreamPaymentAsset;
  railId: PaymentRailId;
  network: string;
  address: string;
  amount: string;
  status: PaymentIntentStatus;
  createdAtSec: number;
  expiresAtSec: number;
  settledAtSec?: number;
  settlementKey?: string;
  payment?: VerifiedPayment;
  failureReason?: string;
}

interface StoredPaymentIntent extends PaymentIntent {
  secretHash: string;
  verificationContext?: Record<string, unknown>;
}

interface PaymentIntentStore {
  version: 1;
  intents: StoredPaymentIntent[];
}

export interface AuthorizedPaymentIntent {
  intent: PaymentIntent;
  verificationContext: Record<string, unknown>;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function emptyStore(): PaymentIntentStore {
  return { version: 1, intents: [] };
}

function secretDigest(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function secretMatches(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(secretDigest(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function publicIntent(intent: StoredPaymentIntent): PaymentIntent {
  const value = JSON.parse(JSON.stringify(intent)) as Partial<StoredPaymentIntent>;
  delete value.secretHash;
  delete value.verificationContext;
  return value as PaymentIntent;
}

function normalizeStore(input: PaymentIntentStore): PaymentIntentStore {
  if (!input || input.version !== 1 || !Array.isArray(input.intents)) {
    throw new PaymentVerificationError("Payment intent store has an invalid schema.", 500);
  }
  for (const intent of input.intents) {
    if (
      !intent ||
      typeof intent.id !== "string" ||
      typeof intent.secretHash !== "string" ||
      typeof intent.buyerPubkey !== "string" ||
      typeof intent.address !== "string" ||
      typeof intent.amount !== "string" ||
      typeof intent.expiresAtSec !== "number"
    ) {
      throw new PaymentVerificationError("Payment intent store contains an invalid record.", 500);
    }
  }
  return { version: 1, intents: [...input.intents] };
}

function readStore(): PaymentIntentStore {
  const raw = readTextFileWithBackup(STORE_PATH);
  if (!raw) return emptyStore();
  try {
    return normalizeStore(JSON.parse(raw) as PaymentIntentStore);
  } catch (error) {
    if (error instanceof PaymentVerificationError) throw error;
    throw new PaymentVerificationError("Payment intent store is corrupt.", 500);
  }
}

function expireIfNeeded(intent: StoredPaymentIntent, atSec: number): void {
  if (intent.status === "pending" && intent.expiresAtSec <= atSec) intent.status = "expired";
}

export function createPaymentIntent(input: {
  scope: PaymentIntentScope;
  buyerPubkey: string;
  recipientPubkey?: string;
  asset: StreamPaymentAsset;
  railId: PaymentRailId;
  network: string;
  address: string;
  amount: string;
  ttlSec?: number;
  verificationContext?: Record<string, unknown>;
}): { intent: PaymentIntent; secret: string } {
  const createdAtSec = nowSec();
  const ttlSec = Math.min(MAX_TTL_SEC, Math.max(60, Math.trunc(input.ttlSec ?? DEFAULT_TTL_SEC)));
  const secret = randomBytes(32).toString("base64url");
  let created: StoredPaymentIntent | null = null;
  updateJsonFileAtomic<PaymentIntentStore>(STORE_PATH, emptyStore(), (rawStore) => {
    const store = normalizeStore(rawStore);
    for (const intent of store.intents) expireIfNeeded(intent, createdAtSec);
    created = {
      id: randomUUID(),
      scope: input.scope,
      buyerPubkey: input.buyerPubkey.toLowerCase(),
      ...(input.recipientPubkey ? { recipientPubkey: input.recipientPubkey.toLowerCase() } : {}),
      asset: input.asset,
      railId: input.railId,
      network: input.network,
      address: input.address,
      amount: input.amount,
      status: "pending",
      createdAtSec,
      expiresAtSec: createdAtSec + ttlSec,
      secretHash: secretDigest(secret),
      verificationContext: input.verificationContext ?? {}
    };
    store.intents.push(created);
    store.intents = store.intents
      .sort((a, b) => b.createdAtSec - a.createdAtSec)
      .slice(0, MAX_INTENTS);
    return store;
  });
  if (!created) throw new PaymentVerificationError("Failed to create payment intent.", 500);
  return { intent: publicIntent(created), secret };
}

export function getPaymentIntent(id: string): PaymentIntent | null {
  const intent = readStore().intents.find((row) => row.id === id);
  if (!intent) return null;
  expireIfNeeded(intent, nowSec());
  return publicIntent(intent);
}

export function authorizePaymentIntent(id: string, secret: string): AuthorizedPaymentIntent {
  const intent = readStore().intents.find((row) => row.id === id);
  if (!intent || !secret || !secretMatches(secret, intent.secretHash)) {
    throw new PaymentVerificationError("Payment intent credentials are invalid.", 404);
  }
  expireIfNeeded(intent, nowSec());
  if (intent.status === "expired") throw new PaymentVerificationError("Payment intent has expired.", 410);
  if (intent.status === "failed") throw new PaymentVerificationError(intent.failureReason || "Payment intent failed.", 409);
  return {
    intent: publicIntent(intent),
    verificationContext: { ...(intent.verificationContext ?? {}) }
  };
}

export function settlePaymentIntent(id: string, secret: string, payment: VerifiedPayment): PaymentIntent {
  let settled: StoredPaymentIntent | null = null;
  const timestamp = nowSec();
  updateJsonFileAtomic<PaymentIntentStore>(STORE_PATH, emptyStore(), (rawStore) => {
    const store = normalizeStore(rawStore);
    const intent = store.intents.find((row) => row.id === id);
    if (!intent || !secret || !secretMatches(secret, intent.secretHash)) {
      throw new PaymentVerificationError("Payment intent credentials are invalid.", 404);
    }
    expireIfNeeded(intent, timestamp);
    if (intent.status === "expired") throw new PaymentVerificationError("Payment intent has expired.", 410);
    if (intent.status === "settled") {
      if (intent.settlementKey !== payment.settlementKey) {
        throw new PaymentVerificationError("Payment intent was already settled with another payment.", 409);
      }
      settled = intent;
      return store;
    }
    const replay = store.intents.find(
      (row) => row.id !== id && row.status === "settled" && row.settlementKey === payment.settlementKey
    );
    if (replay) throw new PaymentVerificationError("This payment was already used by another payment intent.", 409);
    intent.status = "settled";
    intent.settledAtSec = timestamp;
    intent.settlementKey = payment.settlementKey;
    intent.payment = payment;
    settled = intent;
    return store;
  });
  if (!settled) throw new PaymentVerificationError("Failed to settle payment intent.", 500);
  return publicIntent(settled);
}
