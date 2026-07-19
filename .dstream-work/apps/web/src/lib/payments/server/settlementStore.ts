import { randomUUID } from "node:crypto";
import { updateJsonFileAtomic } from "../../storage/jsonFileStore";
import type { VerifiedPayment } from "./types";
import { PaymentVerificationError } from "./types";

const STORE_PATH =
  (process.env.DSTREAM_PAYMENT_SETTLEMENT_STORE_PATH ?? "/var/lib/dstream/payment-settlements.json").trim() ||
  "/var/lib/dstream/payment-settlements.json";

export interface PaymentSettlementRecord extends VerifiedPayment {
  id: string;
  scopeType: string;
  scopeId: string;
  packageId?: string;
  buyerPubkey: string;
  verifiedAtSec: number;
}

export type NativePaymentSettlementRecord = PaymentSettlementRecord;

interface SettlementStore {
  version: 1;
  settlements: PaymentSettlementRecord[];
}

function emptyStore(): SettlementStore {
  return { version: 1, settlements: [] };
}

function normalizeStore(input: SettlementStore): SettlementStore {
  if (!input || input.version !== 1 || !Array.isArray(input.settlements)) {
    throw new PaymentVerificationError("Payment settlement store has an invalid schema.", 500);
  }
  const settlements = input.settlements.map((raw) => {
    const row = raw as PaymentSettlementRecord & { packageId?: string };
    const scopeId = typeof row.scopeId === "string" && row.scopeId ? row.scopeId : row.packageId;
    const scopeType = typeof row.scopeType === "string" && row.scopeType ? row.scopeType : row.packageId ? "video_package" : "payment";
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.settlementKey !== "string" ||
      typeof scopeId !== "string" ||
      typeof row.buyerPubkey !== "string"
    ) {
      throw new PaymentVerificationError("Payment settlement store contains an invalid record.", 500);
    }
    return {
      ...row,
      scopeType,
      scopeId,
      finality: row.finality ?? "confirmed"
    };
  });
  return { version: 1, settlements };
}

export function recordPaymentSettlement(input: {
  payment: VerifiedPayment;
  scopeType: string;
  scopeId: string;
  buyerPubkey: string;
}): { record: PaymentSettlementRecord; existing: boolean } {
  let record: PaymentSettlementRecord | null = null;
  let existing = false;
  updateJsonFileAtomic<SettlementStore>(STORE_PATH, emptyStore(), (rawStore) => {
    const store = normalizeStore(rawStore);
    const prior = store.settlements.find((row) => row.settlementKey === input.payment.settlementKey);
    if (prior) {
      if (prior.scopeType !== input.scopeType || prior.scopeId !== input.scopeId || prior.buyerPubkey !== input.buyerPubkey) {
        throw new PaymentVerificationError("This payment has already been used for another settlement.", 409);
      }
      record = prior;
      existing = true;
      return store;
    }

    record = {
      id: randomUUID(),
      ...input.payment,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      ...(input.scopeType === "video_package" ? { packageId: input.scopeId } : {}),
      buyerPubkey: input.buyerPubkey,
      verifiedAtSec: Math.floor(Date.now() / 1000)
    };
    store.settlements.push(record);
    return store;
  });
  if (!record) throw new PaymentVerificationError("Failed to record verified settlement.", 500);
  return { record, existing };
}

export function recordNativePaymentSettlement(input: {
  payment: VerifiedPayment;
  packageId: string;
  buyerPubkey: string;
}): { record: PaymentSettlementRecord; existing: boolean } {
  return recordPaymentSettlement({
    payment: input.payment,
    scopeType: "video_package",
    scopeId: input.packageId,
    buyerPubkey: input.buyerPubkey
  });
}
