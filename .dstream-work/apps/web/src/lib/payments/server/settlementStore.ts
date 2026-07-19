import { randomUUID } from "node:crypto";
import { updateJsonFileAtomic } from "../../storage/jsonFileStore";
import type { VerifiedNativePayment } from "./types";
import { NativePaymentVerificationError } from "./types";

const STORE_PATH =
  (process.env.DSTREAM_PAYMENT_SETTLEMENT_STORE_PATH ?? "/var/lib/dstream/payment-settlements.json").trim() ||
  "/var/lib/dstream/payment-settlements.json";

export interface NativePaymentSettlementRecord extends VerifiedNativePayment {
  id: string;
  packageId: string;
  buyerPubkey: string;
  verifiedAtSec: number;
}

interface SettlementStore {
  version: 1;
  settlements: NativePaymentSettlementRecord[];
}

function emptyStore(): SettlementStore {
  return { version: 1, settlements: [] };
}

function normalizeStore(input: SettlementStore): SettlementStore {
  if (!input || input.version !== 1 || !Array.isArray(input.settlements)) {
    throw new NativePaymentVerificationError("Payment settlement store has an invalid schema.", 500);
  }
  const valid = input.settlements.every(
    (row) =>
      !!row &&
      typeof row.id === "string" &&
      typeof row.settlementKey === "string" &&
      typeof row.packageId === "string" &&
      typeof row.buyerPubkey === "string"
  );
  if (!valid) throw new NativePaymentVerificationError("Payment settlement store contains an invalid record.", 500);
  return { version: 1, settlements: [...input.settlements] };
}

export function recordNativePaymentSettlement(input: {
  payment: VerifiedNativePayment;
  packageId: string;
  buyerPubkey: string;
}): { record: NativePaymentSettlementRecord; existing: boolean } {
  let record: NativePaymentSettlementRecord | null = null;
  let existing = false;
  updateJsonFileAtomic<SettlementStore>(STORE_PATH, emptyStore(), (rawStore) => {
    const store = normalizeStore(rawStore);
    const prior = store.settlements.find((row) => row.settlementKey === input.payment.settlementKey);
    if (prior) {
      if (prior.packageId !== input.packageId || prior.buyerPubkey !== input.buyerPubkey) {
        throw new NativePaymentVerificationError("This blockchain payment has already been used for another purchase.", 409);
      }
      record = prior;
      existing = true;
      return store;
    }

    record = {
      id: randomUUID(),
      ...input.payment,
      packageId: input.packageId,
      buyerPubkey: input.buyerPubkey,
      verifiedAtSec: Math.floor(Date.now() / 1000)
    };
    store.settlements.push(record);
    return store;
  });
  if (!record) throw new NativePaymentVerificationError("Failed to record verified settlement.", 500);
  return { record, existing };
}
