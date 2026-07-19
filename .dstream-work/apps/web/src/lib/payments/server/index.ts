import { getBitcoinCapability, verifyBitcoinPayment } from "./bitcoin";
import { getEthereumCapability, verifyEthereumPayment } from "./ethereum";
import { getTronCapability, verifyTronPayment } from "./tron";
import type {
  NativePaymentRailCapability,
  NativePaymentVerificationInput,
  VerifiedNativePayment,
  VerifiedNativePaymentAsset
} from "./types";
import { NativePaymentVerificationError } from "./types";

export { NativePaymentVerificationError } from "./types";
export type {
  NativePaymentRailCapability,
  NativePaymentVerificationInput,
  VerifiedNativePayment,
  VerifiedNativePaymentAsset
} from "./types";

const EXPECTED_RAIL_BY_ASSET: Record<VerifiedNativePaymentAsset, VerifiedNativePayment["railId"]> = {
  btc: "utxo",
  eth: "evm",
  trx: "tron"
};

export function isVerifiedNativePaymentAsset(input: unknown): input is VerifiedNativePaymentAsset {
  return input === "btc" || input === "eth" || input === "trx";
}

export function getNativePaymentRailCapabilities(): NativePaymentRailCapability[] {
  return [getBitcoinCapability(), getEthereumCapability(), getTronCapability()];
}

export function validateNativePaymentAddress(asset: VerifiedNativePaymentAsset, input: string): string {
  const value = input.trim();
  if (asset === "eth") {
    if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error("paymentAddress must be a valid Ethereum address.");
    return value.toLowerCase();
  }
  if (asset === "trx") {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) throw new Error("paymentAddress must be a valid TRON address.");
    return value;
  }
  if (!value || value.length > 120) throw new Error("paymentAddress must be a valid Bitcoin address.");
  return value;
}

export async function verifyNativePayment(input: NativePaymentVerificationInput): Promise<VerifiedNativePayment> {
  const expectedRail = EXPECTED_RAIL_BY_ASSET[input.asset];
  if (input.paymentRailId && input.paymentRailId !== expectedRail) {
    throw new NativePaymentVerificationError(
      `${input.asset.toUpperCase()} native verification requires the ${expectedRail} rail.`,
      400
    );
  }
  if (input.asset === "btc") return verifyBitcoinPayment(input);
  if (input.asset === "eth") return verifyEthereumPayment(input);
  return verifyTronPayment(input);
}
