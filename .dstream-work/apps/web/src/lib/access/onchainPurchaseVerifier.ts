import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { PaymentSettlementProof, PaymentSettlementTarget, VerifiedPaymentSettlement } from "@dstream/protocol";
import type { PaymentRailId, StreamPaymentAsset } from "@dstream/protocol";
import bs58 from "bs58";
import { buildCanonicalSettlementRef, buildCanonicalSettlementSourceRef } from "../payments/settlement";
import { normalizePaymentSettlementTarget } from "../payments/targets";
import { TRON_USDT_CONTRACT, normalizeNetworkKey, resolveEvmTokenMeta } from "../payments/chains";
import { PAYMENT_ASSET_DECIMALS, formatUnits, parseAmountToUnits } from "../payments/units";
import { getPaymentRailForAsset } from "../payments/rails";
import type { VideoAccessPackage } from "./packages";

const DEFAULT_FETCH_TIMEOUT_MS = 12_000;
const BLOCKSTREAM_BTC_API = "https://blockstream.info/api";
const DEFAULT_EVM_RPC_BY_NETWORK: Record<string, string> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  mainnet: "https://ethereum-rpc.publicnode.com",
  polygon: "https://polygon-bor-rpc.publicnode.com",
  matic: "https://polygon-bor-rpc.publicnode.com",
  bsc: "https://bsc-rpc.publicnode.com",
  optimism: "https://optimism-rpc.publicnode.com",
  arbitrum: "https://arbitrum-one-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com"
};
const DEFAULT_SOLANA_RPC_BY_NETWORK: Record<string, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
  solana: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com"
};
const DEFAULT_TRON_RPC_URL = "https://api.trongrid.io";
const DEFAULT_XRPL_RPC_URL = "https://s1.ripple.com:51234/";
const HEX_40_RE = /^0x[a-f0-9]{40}$/;

interface OnchainPurchaseVerificationInput {
  package: VideoAccessPackage;
  settlementRef?: string;
  paymentProof?: PaymentSettlementProof | Record<string, unknown> | null;
  settlementProof?: PaymentSettlementProof | Record<string, unknown> | null;
}

export interface OnchainPurchaseVerificationResult {
  supported: boolean;
  verified: boolean;
  status: number;
  error?: string;
  sourceRef?: string;
  settlementRef?: string;
  settlement?: VerifiedPaymentSettlement;
  metadata?: Record<string, unknown>;
}

interface ChainTxProof {
  txRef: string;
  network?: string;
  amount?: string;
  amountAtomic?: string;
  payload: Record<string, unknown>;
}

interface JsonRpcConfig {
  url: string;
  headers?: Record<string, string>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sanitizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  try {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeRailId(input: string | null | undefined, asset: StreamPaymentAsset): PaymentRailId {
  const value = (input ?? "").trim().toLowerCase();
  switch (value) {
    case "lightning":
    case "utxo":
    case "evm":
    case "tron":
    case "solana":
    case "xrpl":
    case "cardano":
    case "xmr":
      return value;
    default:
      return getPaymentRailForAsset(asset).id;
  }
}

function buildConfiguredEnvName(prefix: string, network: string): string {
  return `${prefix}_${network.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function normalizeAtomicString(input: string | undefined): string | undefined {
  if (!input || !/^\d+$/.test(input)) return undefined;
  return input.replace(/^0+(?=\d)/, "");
}

function packageTarget(pkg: VideoAccessPackage, railId: PaymentRailId): PaymentSettlementTarget | null {
  return (
    normalizePaymentSettlementTarget(pkg.paymentTarget, {
      asset: pkg.paymentAsset,
      railId,
      amount: pkg.paymentAmount,
      recipientPubkey: pkg.hostPubkey
    }) ?? null
  );
}

function requiredAmountAtomic(pkg: VideoAccessPackage): bigint | null {
  const decimals = PAYMENT_ASSET_DECIMALS[pkg.paymentAsset] ?? 8;
  return parseAmountToUnits(pkg.paymentAmount, decimals);
}

function formatSettlementAmount(asset: StreamPaymentAsset, amountAtomic: bigint): string {
  return formatUnits(amountAtomic, PAYMENT_ASSET_DECIMALS[asset] ?? 8);
}

function buildSettlement(input: {
  railId: PaymentRailId;
  asset: StreamPaymentAsset;
  settlementKind: string;
  txRef: string;
  network?: string;
  amountAtomic: bigint;
  metadata?: Record<string, unknown>;
}): VerifiedPaymentSettlement {
  const amountAtomic = input.amountAtomic.toString();
  return {
    version: 1,
    railId: input.railId,
    asset: input.asset,
    settlementKind: input.settlementKind,
    settlementRef: buildCanonicalSettlementRef({
      railId: input.railId,
      settlementKind: input.settlementKind,
      txRef: input.txRef
    }),
    txRef: input.txRef,
    network: input.network,
    amount: formatSettlementAmount(input.asset, input.amountAtomic),
    amountAtomic,
    confirmed: true,
    observedAtMs: Date.now(),
    verifier: "host_origin",
    metadata: input.metadata
  };
}

function successResult(settlement: VerifiedPaymentSettlement): OnchainPurchaseVerificationResult {
  return {
    supported: true,
    verified: true,
    status: 200,
    sourceRef: buildCanonicalSettlementSourceRef(settlement),
    settlementRef: settlement.settlementRef,
    settlement,
    metadata: sanitizeMetadata(settlement.metadata)
  };
}

function proofCandidate(input: unknown): ChainTxProof | null {
  const proof = asObject(input);
  if (!proof) return null;
  const payload = asObject(proof.payload) ?? {};
  const txRef =
    asString(proof.txRef) ||
    asString(proof.settlementRef) ||
    asString(payload.txRef) ||
    asString(payload.txHash) ||
    asString(payload.txid) ||
    asString(payload.signature) ||
    "";
  if (!txRef) return null;
  return {
    txRef,
    network: asString(proof.network) || asString(payload.network) || undefined,
    amount: asString(proof.amount) || asString(payload.amount) || undefined,
    amountAtomic: normalizeAtomicString(asString(proof.amountAtomic) || asString(payload.amountAtomic)),
    payload
  };
}

function extractChainProof(input: OnchainPurchaseVerificationInput): ChainTxProof | null {
  return (
    proofCandidate(input.settlementProof) ??
    proofCandidate(input.paymentProof) ??
    (input.settlementRef ? { txRef: input.settlementRef, payload: {} } : null)
  );
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function postJsonRpc<T>(config: JsonRpcConfig, method: string, params: unknown[]): Promise<T> {
  const response = await fetchWithTimeout(config.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.headers ?? {})
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });
  const body = (await response.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
  if (!response.ok || body?.error || body?.result === undefined) {
    throw new Error(body?.error?.message || `${method} failed (${response.status})`);
  }
  return body.result;
}

function basicAuthHeaders(user: string, pass: string): Record<string, string> | undefined {
  if (!user || !pass) return undefined;
  const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  return {
    authorization: `Basic ${token}`
  };
}

function envJsonRpc(baseName: string): JsonRpcConfig | null {
  const url = env(`${baseName}_URL`);
  if (!url) return null;
  return {
    url,
    headers: basicAuthHeaders(env(`${baseName}_USER`), env(`${baseName}_PASS`))
  };
}

function normalizeHexAddress(input: string): string {
  return input.trim().toLowerCase();
}

function decodeHexQuantity(input: string | null | undefined): bigint | null {
  const value = asString(input);
  if (!value) return null;
  const normalized = value.toLowerCase();
  try {
    if (normalized.startsWith("0x")) return BigInt(normalized);
    if (/^\d+$/.test(normalized)) return BigInt(normalized);
    return null;
  } catch {
    return null;
  }
}

function decodeErc20TransferInput(dataRaw: string | null | undefined): { recipient: string; amount: bigint } | null {
  const data = asString(dataRaw).toLowerCase();
  if (!data.startsWith("0xa9059cbb") || data.length < 138) return null;
  try {
    const recipient = `0x${data.slice(34, 74)}`;
    const amount = BigInt(`0x${data.slice(74, 138)}`);
    return {
      recipient,
      amount
    };
  } catch {
    return null;
  }
}

function decodeTrc20TransferInput(dataRaw: string | null | undefined): { recipient: string; amount: bigint } | null {
  const data = asString(dataRaw).toLowerCase().replace(/^0x/, "");
  if (!data.startsWith("a9059cbb") || data.length < 136) return null;
  try {
    const recipientHex = `41${data.slice(8, 72).slice(-40)}`;
    const amount = BigInt(`0x${data.slice(72, 136)}`);
    return {
      recipient: tronHexToBase58(recipientHex),
      amount
    };
  } catch {
    return null;
  }
}

function compareAddress(asset: StreamPaymentAsset, left: string, right: string): boolean {
  if (asset === "bch") {
    const normalize = (value: string) => value.trim().toLowerCase().replace(/^bitcoincash:/, "");
    return normalize(left) === normalize(right);
  }
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function tronHexToBase58(input: string): string {
  const hex = input.trim().replace(/^0x/i, "");
  const payload = Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, "hex");
  const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, checksum]));
}

async function verifyEvmPurchase(input: OnchainPurchaseVerificationInput, proof: ChainTxProof): Promise<OnchainPurchaseVerificationResult> {
  const target = packageTarget(input.package, "evm");
  if (!target) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "EVM packages require a settlement target before they can be verified."
    };
  }
  const network = normalizeNetworkKey(proof.network || target.network || "ethereum");
  const rpcUrl = env(buildConfiguredEnvName("DSTREAM_ACCESS_EVM_RPC", network)) || env("DSTREAM_ACCESS_EVM_RPC_URL") || DEFAULT_EVM_RPC_BY_NETWORK[network];
  if (!rpcUrl) {
    return {
      supported: true,
      verified: false,
      status: 503,
      error: `No EVM RPC configured for network "${network}".`
    };
  }
  const rpc: JsonRpcConfig = { url: rpcUrl };
  const [tx, receipt] = await Promise.all([
    postJsonRpc<any>(rpc, "eth_getTransactionByHash", [proof.txRef]),
    postJsonRpc<any>(rpc, "eth_getTransactionReceipt", [proof.txRef])
  ]);
  if (!tx || !receipt || receipt.status !== "0x1" || !receipt.blockNumber) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "EVM transaction is missing, failed, or not confirmed yet."
    };
  }
  const required = requiredAmountAtomic(input.package);
  if (required === null) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "Package amount is invalid for EVM verification."
    };
  }
  const metadata: Record<string, unknown> = {
    network,
    from: asString(tx.from) || null,
    target: target.destination
  };

  if (input.package.paymentAsset === "eth") {
    if (!compareAddress("eth", asString(tx.to), target.destination)) {
      return {
        supported: true,
        verified: false,
        status: 403,
        error: "EVM native transfer destination does not match package target."
      };
    }
    const value = decodeHexQuantity(tx.value);
    if (value === null || value < required) {
      return {
        supported: true,
        verified: false,
        status: 402,
        error: "EVM native transfer is below the package amount."
      };
    }
    return successResult(
      buildSettlement({
        railId: "evm",
        asset: input.package.paymentAsset,
        settlementKind: "evm_native_transfer",
        txRef: proof.txRef,
        network,
        amountAtomic: value,
        metadata
      })
    );
  }

  const tokenMeta = resolveEvmTokenMeta(input.package.paymentAsset, network, target.contractAddress);
  if (!tokenMeta) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: `No token contract is configured for ${input.package.paymentAsset.toUpperCase()} on ${network}.`
    };
  }
  if (!HEX_40_RE.test(asString(tx.to)) || normalizeHexAddress(asString(tx.to)) !== normalizeHexAddress(tokenMeta.contract)) {
    return {
      supported: true,
      verified: false,
      status: 403,
      error: "EVM token transfer contract does not match package target."
    };
  }
  const transfer = decodeErc20TransferInput(tx.input);
  if (!transfer || normalizeHexAddress(transfer.recipient) !== normalizeHexAddress(target.destination)) {
    return {
      supported: true,
      verified: false,
      status: 403,
      error: "EVM token transfer recipient does not match package target."
    };
  }
  if (transfer.amount < required) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "EVM token transfer is below the package amount."
    };
  }
  metadata.contractAddress = tokenMeta.contract;
  return successResult(
    buildSettlement({
      railId: "evm",
      asset: input.package.paymentAsset,
      settlementKind: "evm_erc20_transfer",
      txRef: proof.txRef,
      network,
      amountAtomic: transfer.amount,
      metadata
    })
  );
}

async function verifySolanaPurchase(input: OnchainPurchaseVerificationInput, proof: ChainTxProof): Promise<OnchainPurchaseVerificationResult> {
  const target = packageTarget(input.package, "solana");
  if (!target) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "Solana packages require a settlement target before they can be verified."
    };
  }
  const network = normalizeNetworkKey(proof.network || target.network || "mainnet-beta");
  const rpcUrl = env("DSTREAM_ACCESS_SOLANA_RPC_URL") || DEFAULT_SOLANA_RPC_BY_NETWORK[network] || DEFAULT_SOLANA_RPC_BY_NETWORK["mainnet-beta"];
  const transaction = await postJsonRpc<any>(new JsonRpcConfigImpl(rpcUrl), "getTransaction", [
    proof.txRef,
    { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }
  ]);
  if (!transaction || transaction.meta?.err) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "Solana transaction is missing, failed, or not confirmed yet."
    };
  }
  const required = requiredAmountAtomic(input.package);
  if (required === null) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "Package amount is invalid for Solana verification."
    };
  }
  const instructions = Array.isArray(transaction.transaction?.message?.instructions) ? transaction.transaction.message.instructions : [];
  const matched = instructions.find((instruction: any) => {
    const parsed = instruction?.parsed;
    if (!parsed || instruction?.program !== "system" || parsed?.type !== "transfer") return false;
    const info = parsed.info ?? {};
    return asString(info.destination) === target.destination;
  });
  if (!matched) {
    return {
      supported: true,
      verified: false,
      status: 403,
      error: "Solana transfer destination does not match package target."
    };
  }
  const lamports = BigInt((matched.parsed?.info?.lamports ?? 0).toString());
  if (lamports < required) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "Solana transfer is below the package amount."
    };
  }
  return successResult(
    buildSettlement({
      railId: "solana",
      asset: input.package.paymentAsset,
      settlementKind: "solana_native_transfer",
      txRef: proof.txRef,
      network,
      amountAtomic: lamports,
      metadata: {
        network,
        target: target.destination
      }
    })
  );
}

class JsonRpcConfigImpl implements JsonRpcConfig {
  url: string;
  headers?: Record<string, string>;
  constructor(url: string, headers?: Record<string, string>) {
    this.url = url;
    this.headers = headers;
  }
}

async function verifyTronPurchase(input: OnchainPurchaseVerificationInput, proof: ChainTxProof): Promise<OnchainPurchaseVerificationResult> {
  const target = packageTarget(input.package, "tron");
  if (!target) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "TRON packages require a settlement target before they can be verified."
    };
  }
  const baseUrl = env("DSTREAM_ACCESS_TRON_RPC_URL") || DEFAULT_TRON_RPC_URL;
  const [txResponse, infoResponse] = await Promise.all([
    fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/wallet/gettransactionbyid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: proof.txRef })
    }),
    fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/walletsolidity/gettransactioninfobyid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: proof.txRef })
    })
  ]);
  const tx = await txResponse.json().catch(() => null);
  const info = await infoResponse.json().catch(() => null);
  if (!txResponse.ok || !tx || !infoResponse.ok || !info || !info.blockNumber) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "TRON transaction is missing or not confirmed yet."
    };
  }
  if (asString(info.receipt?.result).toUpperCase() === "FAILED" || asString(tx.ret?.[0]?.contractRet).toUpperCase() === "REVERT") {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "TRON transaction failed."
    };
  }
  const required = requiredAmountAtomic(input.package);
  if (required === null) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "Package amount is invalid for TRON verification."
    };
  }
  const contract = tx.raw_data?.contract?.[0];
  const value = contract?.parameter?.value ?? {};
  let amount = 0n;
  if (input.package.paymentAsset === "usdt") {
    const contractAddress = asString(value.contract_address) ? tronHexToBase58(asString(value.contract_address)) : "";
    const expectedContract = target.contractAddress || TRON_USDT_CONTRACT;
    if (!contractAddress || contractAddress !== expectedContract) {
      return {
        supported: true,
        verified: false,
        status: 403,
        error: "TRON token contract does not match package target."
      };
    }
    const transfer = decodeTrc20TransferInput(value.data);
    if (!transfer || transfer.recipient !== target.destination) {
      return {
        supported: true,
        verified: false,
        status: 403,
        error: "TRON token recipient does not match package target."
      };
    }
    amount = transfer.amount;
  } else {
    const toAddress = asString(value.to_address) ? tronHexToBase58(asString(value.to_address)) : "";
    if (!toAddress || toAddress !== target.destination) {
      return {
        supported: true,
        verified: false,
        status: 403,
        error: "TRON transfer destination does not match package target."
      };
    }
    amount = BigInt((value.amount ?? 0).toString());
  }
  if (amount < required) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "TRON transfer is below the package amount."
    };
  }
  return successResult(
    buildSettlement({
      railId: "tron",
      asset: input.package.paymentAsset,
      settlementKind: input.package.paymentAsset === "usdt" ? "tron_trc20_transfer" : "tron_native_transfer",
      txRef: proof.txRef,
      network: "tron",
      amountAtomic: amount,
      metadata: {
        target: target.destination,
        contractAddress: input.package.paymentAsset === "usdt" ? target.contractAddress || TRON_USDT_CONTRACT : null,
        blockNumber: info.blockNumber
      }
    })
  );
}

async function verifyXrplPurchase(input: OnchainPurchaseVerificationInput, proof: ChainTxProof): Promise<OnchainPurchaseVerificationResult> {
  const target = packageTarget(input.package, "xrpl");
  if (!target) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "XRPL packages require a settlement target before they can be verified."
    };
  }
  const rpcUrl = env("DSTREAM_ACCESS_XRPL_RPC_URL") || DEFAULT_XRPL_RPC_URL;
  const result = await postJsonRpc<any>(new JsonRpcConfigImpl(rpcUrl), "tx", [
    {
      transaction: proof.txRef,
      binary: false
    }
  ]);
  if (!result || !result.validated || asString(result.meta?.TransactionResult) !== "tesSUCCESS") {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "XRPL payment is missing, failed, or not validated yet."
    };
  }
  if (asString(result.Destination) !== target.destination) {
    return {
      supported: true,
      verified: false,
      status: 403,
      error: "XRPL destination does not match package target."
    };
  }
  if (target.reference && String(result.DestinationTag ?? "") !== target.reference) {
    return {
      supported: true,
      verified: false,
      status: 403,
      error: "XRPL destination tag does not match package target."
    };
  }
  const delivered = asString(result.meta?.delivered_amount) || asString(result.Amount);
  const amount = BigInt(delivered || "0");
  const required = requiredAmountAtomic(input.package);
  if (required === null || amount < required) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "XRPL payment is below the package amount."
    };
  }
  return successResult(
    buildSettlement({
      railId: "xrpl",
      asset: input.package.paymentAsset,
      settlementKind: "xrpl_payment",
      txRef: proof.txRef,
      network: "xrpl",
      amountAtomic: amount,
      metadata: {
        target: target.destination,
        destinationTag: result.DestinationTag ?? null
      }
    })
  );
}

async function verifyCardanoPurchase(input: OnchainPurchaseVerificationInput, proof: ChainTxProof): Promise<OnchainPurchaseVerificationResult> {
  const target = packageTarget(input.package, "cardano");
  if (!target) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "Cardano packages require a settlement target before they can be verified."
    };
  }
  const baseUrl = env("DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL");
  const projectId = env("DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID");
  if (!baseUrl || !projectId) {
    return {
      supported: true,
      verified: false,
      status: 503,
      error: "Cardano verification requires DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL and DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID."
    };
  }
  const response = await fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/txs/${encodeURIComponent(proof.txRef)}/utxos`, {
    headers: {
      project_id: projectId
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || !Array.isArray(body.outputs)) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "Cardano transaction is missing or unavailable from the configured provider."
    };
  }
  const required = requiredAmountAtomic(input.package);
  if (required === null) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "Package amount is invalid for Cardano verification."
    };
  }
  const output = body.outputs.find((row: any) => {
    if (asString(row.address) !== target.destination) return false;
    const lovelace = Array.isArray(row.amount)
      ? row.amount.find((entry: any) => asString(entry.unit) === "lovelace")
      : null;
    return !!lovelace;
  });
  if (!output) {
    return {
      supported: true,
      verified: false,
      status: 403,
      error: "Cardano output destination does not match package target."
    };
  }
  const lovelace = Array.isArray(output.amount)
    ? output.amount.find((entry: any) => asString(entry.unit) === "lovelace")
    : null;
  const amount = BigInt(asString(lovelace?.quantity) || "0");
  if (amount < required) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "Cardano output is below the package amount."
    };
  }
  return successResult(
    buildSettlement({
      railId: "cardano",
      asset: input.package.paymentAsset,
      settlementKind: "cardano_utxo_output",
      txRef: proof.txRef,
      network: target.network || "cardano",
      amountAtomic: amount,
      metadata: {
        target: target.destination
      }
    })
  );
}

async function verifyUtxoViaRpc(
  input: OnchainPurchaseVerificationInput,
  proof: ChainTxProof,
  target: PaymentSettlementTarget
): Promise<OnchainPurchaseVerificationResult> {
  const assetKey = input.package.paymentAsset.toUpperCase();
  const baseName = `DSTREAM_ACCESS_${assetKey}_RPC`;
  const rpc = envJsonRpc(baseName);
  if (!rpc) {
    if (input.package.paymentAsset === "btc") {
      const response = await fetchWithTimeout(`${BLOCKSTREAM_BTC_API}/tx/${encodeURIComponent(proof.txRef)}`, {});
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || !Array.isArray(body.vout) || typeof body.status?.confirmed !== "boolean") {
        return {
          supported: true,
          verified: false,
          status: 402,
          error: "BTC transaction is missing or unavailable from the public verifier endpoint."
        };
      }
      if (!body.status.confirmed) {
        return {
          supported: true,
          verified: false,
          status: 402,
          error: "BTC transaction is not confirmed yet."
        };
      }
      const required = requiredAmountAtomic(input.package);
      const matched = body.vout.find((output: any) => compareAddress("btc", asString(output.scriptpubkey_address), target.destination));
      const value = BigInt((matched?.value ?? 0).toString());
      if (!matched || !required || value < required) {
        return {
          supported: true,
          verified: false,
          status: 402,
          error: "BTC output does not satisfy the package target and amount."
        };
      }
      return successResult(
        buildSettlement({
          railId: "utxo",
          asset: input.package.paymentAsset,
          settlementKind: "utxo_output",
          txRef: proof.txRef,
          network: target.network || input.package.paymentAsset,
          amountAtomic: value,
          metadata: {
            target: target.destination
          }
        })
      );
    }
    return {
      supported: true,
      verified: false,
      status: 503,
      error: `${assetKey} verification requires ${baseName}_URL (and optional ${baseName}_USER / ${baseName}_PASS).`
    };
  }
  const tx = await postJsonRpc<any>(rpc, "getrawtransaction", [proof.txRef, true]);
  const confirmations = Number(tx?.confirmations ?? 0);
  if (!tx || !Array.isArray(tx.vout) || !Number.isFinite(confirmations) || confirmations <= 0) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: `${assetKey} transaction is missing or not confirmed yet.`
    };
  }
  const required = requiredAmountAtomic(input.package);
  if (!required) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "Package amount is invalid for UTXO verification."
    };
  }
  const matched = tx.vout.find((output: any) => {
    const address =
      asString(output?.scriptPubKey?.address) ||
      asString(output?.scriptPubKey?.addresses?.[0]) ||
      "";
    return address && compareAddress(input.package.paymentAsset, address, target.destination);
  });
  const valueRaw = matched?.value;
  const value =
    typeof valueRaw === "number" || typeof valueRaw === "string"
      ? parseAmountToUnits(String(valueRaw), PAYMENT_ASSET_DECIMALS[input.package.paymentAsset] ?? 8)
      : null;
  if (!matched || value === null || value < required) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: `${assetKey} output does not satisfy the package target and amount.`
    };
  }
  return successResult(
    buildSettlement({
      railId: "utxo",
      asset: input.package.paymentAsset,
      settlementKind: "utxo_output",
      txRef: proof.txRef,
      network: target.network || input.package.paymentAsset,
      amountAtomic: value,
      metadata: {
        target: target.destination,
        confirmations
      }
    })
  );
}

async function verifyUtxoPurchase(input: OnchainPurchaseVerificationInput, proof: ChainTxProof): Promise<OnchainPurchaseVerificationResult> {
  const target = packageTarget(input.package, "utxo");
  if (!target) {
    return {
      supported: true,
      verified: false,
      status: 400,
      error: "UTXO packages require a settlement target before they can be verified."
    };
  }
  return verifyUtxoViaRpc(input, proof, target);
}

export async function verifyOnchainPurchase(input: OnchainPurchaseVerificationInput): Promise<OnchainPurchaseVerificationResult> {
  const railId = normalizeRailId(input.package.paymentRailId, input.package.paymentAsset);
  if (railId === "xmr" || railId === "lightning") {
    return {
      supported: false,
      verified: false,
      status: 200
    };
  }
  const proof = extractChainProof(input);
  if (!proof) {
    return {
      supported: true,
      verified: false,
      status: 402,
      error: "This rail requires a transaction reference proof before access can be granted."
    };
  }
  try {
    switch (railId) {
      case "evm":
        return verifyEvmPurchase(input, proof);
      case "solana":
        return verifySolanaPurchase(input, proof);
      case "tron":
        return verifyTronPurchase(input, proof);
      case "utxo":
        return verifyUtxoPurchase(input, proof);
      case "xrpl":
        return verifyXrplPurchase(input, proof);
      case "cardano":
        return verifyCardanoPurchase(input, proof);
      default:
        return {
          supported: false,
          verified: false,
          status: 200
        };
    }
  } catch (error: any) {
    return {
      supported: true,
      verified: false,
      status: 502,
      error: error?.message ?? "On-chain purchase verification failed."
    };
  }
}
