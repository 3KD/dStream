import type { StreamPaymentAsset } from "@dstream/protocol";
import type { PaymentRailId } from "../rails";

export type VerifiedNativePaymentAsset = Extract<StreamPaymentAsset, "btc" | "eth" | "trx">;

export interface NativePaymentVerificationInput {
  asset: VerifiedNativePaymentAsset;
  address: string;
  amount: string;
  txId: string;
  paymentRailId?: string;
}

export interface VerifiedNativePayment {
  asset: VerifiedNativePaymentAsset;
  railId: Extract<PaymentRailId, "utxo" | "evm" | "tron">;
  network: string;
  txId: string;
  settlementKey: string;
  recipient: string;
  amountAtomic: string;
  confirmations: number;
  blockHeight: number;
}

export interface NativePaymentRailCapability {
  asset: VerifiedNativePaymentAsset;
  railId: VerifiedNativePayment["railId"];
  network: string;
  configured: boolean;
  confirmationsRequired: number;
}

export class NativePaymentVerificationError extends Error {
  readonly status: number;

  constructor(message: string, status = 402) {
    super(message);
    this.name = "NativePaymentVerificationError";
    this.status = status;
  }
}
