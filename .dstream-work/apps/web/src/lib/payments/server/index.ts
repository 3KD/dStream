import { STREAM_PAYMENT_ASSETS, type StreamPaymentAsset } from "@dstream/protocol";
import type { PaymentRailId } from "../rails";
import { getUtxoCapabilities, verifyUtxoPayment } from "./bitcoin";
import { getCardanoCapabilities, verifyCardanoPayment } from "./cardano";
import { getEvmCapabilities, verifyEvmPayment } from "./ethereum";
import { getLightningCapabilities, verifyLightningPayment } from "./lightning";
import { getMoneroCapabilities, verifyMoneroPayment } from "./monero";
import { getSolanaCapabilities, verifySolanaPayment } from "./solana";
import { getTronCapabilities, verifyTronPayment } from "./tron";
import type {
  PaymentRailCapability,
  PaymentVerificationInput,
  VerifiedPayment,
  NativePaymentRailCapability,
  NativePaymentVerificationInput,
  VerifiedNativePayment,
  VerifiedNativePaymentAsset
} from "./types";
import { PaymentVerificationError } from "./types";
import { getXrplCapabilities, verifyXrplPayment } from "./xrpl";

export { NativePaymentVerificationError, PaymentVerificationError } from "./types";
export type {
  PaymentProof,
  PaymentRailCapability,
  PaymentVerificationInput,
  VerifiedPayment,
  NativePaymentRailCapability,
  NativePaymentVerificationInput,
  VerifiedNativePayment,
  VerifiedNativePaymentAsset
} from "./types";

const PAYMENT_ASSET_SET = new Set<StreamPaymentAsset>(STREAM_PAYMENT_ASSETS);
const UTXO_ASSETS = new Set<StreamPaymentAsset>(["btc", "doge", "bch"]);
const EVM_ASSETS = new Set<StreamPaymentAsset>(["eth", "usdt", "usdc", "pepe"]);
const SOLANA_ASSETS = new Set<StreamPaymentAsset>(["sol", "usdt", "usdc"]);

function normalizeNetwork(input: string | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function resolvePaymentRail(input: PaymentVerificationInput): PaymentRailId {
  const explicitRail = input.paymentRailId?.trim().toLowerCase() as PaymentRailId | undefined;
  const network = normalizeNetwork(input.network);
  if (explicitRail) return explicitRail;
  if (input.asset === "btc" && ["lightning", "ln", "lnurl", "bolt11"].includes(network)) return "lightning";
  if (UTXO_ASSETS.has(input.asset)) return "utxo";
  if (input.asset === "trx") return "tron";
  if (input.asset === "sol") return "solana";
  if (input.asset === "xrp") return "xrpl";
  if (input.asset === "ada") return "cardano";
  if (input.asset === "xmr") return "xmr";
  if (input.asset === "usdt" && (network.includes("tron") || network.includes("trc20"))) return "tron";
  if ((input.asset === "usdt" || input.asset === "usdc") && (network.includes("solana") || network.includes("spl"))) {
    return "solana";
  }
  if (EVM_ASSETS.has(input.asset)) return "evm";
  throw new PaymentVerificationError(`${input.asset.toUpperCase()} has no supported settlement rail.`, 400);
}

function assertRailSupportsAsset(railId: PaymentRailId, asset: StreamPaymentAsset): void {
  const supported =
    (railId === "lightning" && asset === "btc") ||
    (railId === "utxo" && UTXO_ASSETS.has(asset)) ||
    (railId === "evm" && EVM_ASSETS.has(asset)) ||
    (railId === "tron" && (asset === "trx" || asset === "usdt")) ||
    (railId === "solana" && SOLANA_ASSETS.has(asset)) ||
    (railId === "xrpl" && asset === "xrp") ||
    (railId === "cardano" && asset === "ada") ||
    (railId === "xmr" && asset === "xmr");
  if (!supported) {
    throw new PaymentVerificationError(`${asset.toUpperCase()} cannot be verified on the ${railId} rail.`, 400);
  }
}

export function isVerifiedPaymentAsset(input: unknown): input is StreamPaymentAsset {
  return typeof input === "string" && PAYMENT_ASSET_SET.has(input as StreamPaymentAsset);
}

export function isVerifiedNativePaymentAsset(input: unknown): input is VerifiedNativePaymentAsset {
  return input === "btc" || input === "eth" || input === "trx";
}

export function getPaymentRailCapabilities(): PaymentRailCapability[] {
  return [
    ...getLightningCapabilities(),
    ...getMoneroCapabilities(),
    ...getUtxoCapabilities(),
    ...getEvmCapabilities(),
    ...getTronCapabilities(),
    ...getSolanaCapabilities(),
    ...getXrplCapabilities(),
    ...getCardanoCapabilities()
  ];
}

export function getNativePaymentRailCapabilities(): NativePaymentRailCapability[] {
  return getPaymentRailCapabilities();
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
  return verifyPayment(input);
}

export async function verifyPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  if (!isVerifiedPaymentAsset(input.asset)) throw new PaymentVerificationError("Payment asset is unsupported.", 400);
  const railId = resolvePaymentRail(input);
  assertRailSupportsAsset(railId, input.asset);
  const normalized = { ...input, paymentRailId: railId };
  if (railId === "lightning") return verifyLightningPayment(normalized);
  if (railId === "utxo") return verifyUtxoPayment(normalized);
  if (railId === "evm") return verifyEvmPayment(normalized);
  if (railId === "tron") return verifyTronPayment(normalized);
  if (railId === "solana") return verifySolanaPayment(normalized);
  if (railId === "xrpl") return verifyXrplPayment(normalized);
  if (railId === "cardano") return verifyCardanoPayment(normalized);
  if (railId === "xmr") return verifyMoneroPayment(normalized);
  throw new PaymentVerificationError("Payment rail is unsupported.", 400);
}
