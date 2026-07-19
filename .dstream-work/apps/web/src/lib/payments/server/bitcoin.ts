import type { StreamPaymentAsset } from "@dstream/protocol";
import { decimalToAtomic, parsePositiveEnvInt } from "./amount";
import { postJson } from "./http";
import type { PaymentRailCapability, PaymentVerificationInput, VerifiedPayment } from "./types";
import { PaymentVerificationError } from "./types";

type UtxoAsset = Extract<StreamPaymentAsset, "btc" | "doge" | "bch">;

interface BitcoinRpcResponse<T> {
  result?: T;
  error?: { code?: number; message?: string } | null;
}

interface UtxoTransaction {
  txid?: string;
  confirmations?: number;
  vout?: Array<{
    n?: number;
    value?: number | string;
    scriptPubKey?: { address?: string; addresses?: string[] };
  }>;
}

interface BlockchainInfo {
  chain?: string;
  blocks?: number;
}

interface UtxoConfig {
  asset: UtxoAsset;
  envPrefix: "BTC" | "DOGE" | "BCH";
  defaultNetwork: string;
  defaultConfirmations: number;
  label: string;
}

const CONFIGS: Record<UtxoAsset, UtxoConfig> = {
  btc: { asset: "btc", envPrefix: "BTC", defaultNetwork: "main", defaultConfirmations: 3, label: "Bitcoin" },
  doge: { asset: "doge", envPrefix: "DOGE", defaultNetwork: "main", defaultConfirmations: 12, label: "Dogecoin" },
  bch: { asset: "bch", envPrefix: "BCH", defaultNetwork: "main", defaultConfirmations: 6, label: "Bitcoin Cash" }
};

function getConfig(asset: StreamPaymentAsset): UtxoConfig {
  const config = CONFIGS[asset as UtxoAsset];
  if (!config) throw new PaymentVerificationError(`${asset.toUpperCase()} is not a UTXO settlement asset.`, 400);
  return config;
}

function getOrigin(config: UtxoConfig): string {
  return (process.env[`DSTREAM_${config.envPrefix}_RPC_ORIGIN`] ?? "").trim();
}

function getNetwork(config: UtxoConfig): string {
  return (process.env[`DSTREAM_${config.envPrefix}_NETWORK`] ?? config.defaultNetwork).trim().toLowerCase() || config.defaultNetwork;
}

function getConfirmationsRequired(config: UtxoConfig): number {
  return parsePositiveEnvInt(
    `DSTREAM_${config.envPrefix}_CONFIRMATIONS_REQUIRED`,
    config.defaultConfirmations,
    10000
  );
}

function authHeader(config: UtxoConfig): Record<string, string> {
  const user = (process.env[`DSTREAM_${config.envPrefix}_RPC_USER`] ?? "").trim();
  const pass = process.env[`DSTREAM_${config.envPrefix}_RPC_PASS`] ?? "";
  if (!user && !pass) return {};
  return { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
}

let rpcSequence = 0;

async function utxoRpc<T>(config: UtxoConfig, method: string, params: unknown[] = []): Promise<T> {
  const origin = getOrigin(config);
  if (!origin) throw new PaymentVerificationError(`${config.label} settlement verification is not configured.`, 503);
  const response = await postJson<BitcoinRpcResponse<T>>({
    url: origin,
    headers: authHeader(config),
    body: { jsonrpc: "1.0", id: `dstream-${++rpcSequence}`, method, params },
    label: `${config.label} RPC`
  });
  if (response.error) {
    const detail = response.error.message?.trim() || `RPC error ${response.error.code ?? "unknown"}`;
    throw new PaymentVerificationError(`${config.label} RPC rejected the request: ${detail}`, 502);
  }
  if (response.result === undefined || response.result === null) {
    throw new PaymentVerificationError(`${config.label} RPC returned no result.`, 502);
  }
  return response.result;
}

function valueToAtomic(input: number | string | undefined, label: string): bigint {
  if (typeof input === "string") return decimalToAtomic(input, 8);
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    throw new PaymentVerificationError(`${label} output value is malformed.`, 502);
  }
  const atomic = Math.round(input * 100_000_000);
  if (!Number.isSafeInteger(atomic)) {
    throw new PaymentVerificationError(`${label} output value exceeds the safe integer range.`, 502);
  }
  return BigInt(atomic);
}

function normalizeAddress(asset: UtxoAsset, input: string): string {
  const value = input.trim();
  if (asset !== "bch") return value;
  return value.toLowerCase().replace(/^bitcoincash:/, "");
}

function assertRequestedNetwork(config: UtxoConfig, requestedRaw: string | undefined): void {
  const requested = (requestedRaw ?? "").trim().toLowerCase();
  if (!requested) return;
  const network = getNetwork(config);
  const assetAliases: Record<UtxoAsset, string[]> = {
    btc: ["btc", "bitcoin"],
    doge: ["doge", "dogecoin"],
    bch: ["bch", "bitcoincash", "bitcoin-cash"]
  };
  const aliases = new Set(["utxo", network, ...assetAliases[config.asset]]);
  if (network === "main") aliases.add("mainnet");
  if (network === "test") aliases.add("testnet");
  if (!aliases.has(requested)) {
    throw new PaymentVerificationError(`${config.label} payment intent network does not match ${network}.`, 400);
  }
}

function outputAddresses(asset: UtxoAsset, output: NonNullable<UtxoTransaction["vout"]>[number]): string[] {
  const values = [output.scriptPubKey?.address, ...(output.scriptPubKey?.addresses ?? [])];
  return values
    .filter((value): value is string => typeof value === "string" && !!value)
    .map((value) => normalizeAddress(asset, value));
}

export function getUtxoCapabilities(): PaymentRailCapability[] {
  return Object.values(CONFIGS).map((config) => ({
    asset: config.asset,
    railId: "utxo",
    network: getNetwork(config),
    configured: !!getOrigin(config),
    confirmationsRequired: getConfirmationsRequired(config),
    verifier: "json_rpc",
    ...(!getOrigin(config) ? { reason: `${config.label} RPC endpoint is not configured.` } : {})
  }));
}

export function getBitcoinCapability(): PaymentRailCapability {
  return getUtxoCapabilities().find((entry) => entry.asset === "btc")!;
}

export async function verifyUtxoPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  const config = getConfig(input.asset);
  const txId = (input.txId ?? input.proof?.txId ?? input.proof?.transactionHash ?? "").trim().toLowerCase();
  const address = normalizeAddress(config.asset, input.address);
  if (!/^[a-f0-9]{64}$/.test(txId)) throw new PaymentVerificationError(`${config.label} transaction ID is malformed.`, 400);
  if (!address || address.length > 200) throw new PaymentVerificationError(`${config.label} recipient address is missing.`, 400);
  const expectedAtomic = decimalToAtomic(input.amount, 8);
  assertRequestedNetwork(config, input.network);

  const chain = await utxoRpc<BlockchainInfo>(config, "getblockchaininfo");
  const network = getNetwork(config);
  if ((chain.chain ?? "").toLowerCase() !== network) {
    throw new PaymentVerificationError(
      `${config.label} RPC network mismatch: expected ${network}, received ${chain.chain ?? "unknown"}.`,
      503
    );
  }

  const tx = await utxoRpc<UtxoTransaction>(config, "getrawtransaction", [txId, true]);
  if ((tx.txid ?? "").toLowerCase() !== txId) {
    throw new PaymentVerificationError(`${config.label} RPC returned a different transaction.`, 502);
  }
  const confirmations = Number.isInteger(tx.confirmations) ? Number(tx.confirmations) : 0;
  const required = getConfirmationsRequired(config);
  if (confirmations < required) {
    throw new PaymentVerificationError(`${config.label} payment has ${confirmations}/${required} confirmations.`, 409);
  }

  const match = (tx.vout ?? []).find((output) => {
    if (!outputAddresses(config.asset, output).includes(address)) return false;
    return valueToAtomic(output.value, config.label) >= expectedAtomic;
  });
  if (!match || !Number.isInteger(match.n) || Number(match.n) < 0) {
    throw new PaymentVerificationError(`${config.label} transaction does not pay the required recipient and amount.`);
  }

  const paidAtomic = valueToAtomic(match.value, config.label);
  const outputIndex = Number(match.n);
  const headHeight = Number.isSafeInteger(chain.blocks) ? Number(chain.blocks) : 0;
  const blockHeight = headHeight > 0 ? headHeight - confirmations + 1 : 0;

  return {
    asset: config.asset,
    railId: "utxo",
    network,
    txId,
    settlementKey: `${config.asset}:${network}:${txId}:${outputIndex}`,
    recipient: address,
    amountAtomic: paidAtomic.toString(),
    confirmations,
    blockHeight,
    finality: "confirmed",
    ...(typeof input.proof?.payerAddress === "string" ? { payer: input.proof.payerAddress.trim() } : {}),
    metadata: { outputIndex }
  };
}

export function verifyBitcoinPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  if (input.asset !== "btc") throw new PaymentVerificationError("Bitcoin verifier requires the BTC asset.", 400);
  return verifyUtxoPayment(input);
}
