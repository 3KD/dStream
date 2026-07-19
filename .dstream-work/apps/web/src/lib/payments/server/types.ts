import type { StreamPaymentAsset } from "@dstream/protocol";
import type { PaymentRailId } from "../rails";

export type PaymentFinality = "confirmed" | "finalized" | "provider_attested";

export interface PaymentProof {
  txId?: string;
  transactionHash?: string;
  invoice?: string;
  preimage?: string;
  zapReceipt?: unknown;
  lightningAddress?: string;
  destinationTag?: number | string;
  payerAddress?: string;
  tokenContract?: string;
  xmrSessionToken?: string;
  xmrSessionKind?: "stake" | "tip";
  [key: string]: unknown;
}

export interface PaymentVerificationInput {
  asset: StreamPaymentAsset;
  address: string;
  amount: string;
  txId?: string;
  network?: string;
  paymentRailId?: string;
  intentId?: string;
  recipientPubkey?: string;
  proof?: PaymentProof;
}

export interface VerifiedPayment {
  asset: StreamPaymentAsset;
  railId: PaymentRailId;
  network: string;
  txId: string;
  settlementKey: string;
  recipient: string;
  amountAtomic: string;
  confirmations: number;
  blockHeight: number;
  finality: PaymentFinality;
  payer?: string;
  tokenContract?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentRailCapability {
  asset: StreamPaymentAsset;
  railId: PaymentRailId;
  network: string;
  configured: boolean;
  confirmationsRequired: number;
  verifier: "wallet_rpc" | "json_rpc" | "rest" | "lnurl_nip57";
  reason?: string;
}

export interface PaymentVerifier {
  capabilities(): PaymentRailCapability[];
  verify(input: PaymentVerificationInput): Promise<VerifiedPayment>;
}

export class PaymentVerificationError extends Error {
  readonly status: number;

  constructor(message: string, status = 402) {
    super(message);
    this.name = "PaymentVerificationError";
    this.status = status;
  }
}

// Compatibility aliases for callers introduced before all rails shared one contract.
export type VerifiedNativePaymentAsset = Extract<StreamPaymentAsset, "btc" | "eth" | "trx">;
export type NativePaymentVerificationInput = PaymentVerificationInput;
export type VerifiedNativePayment = VerifiedPayment;
export type NativePaymentRailCapability = PaymentRailCapability;
export const NativePaymentVerificationError = PaymentVerificationError;
