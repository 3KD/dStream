import type { StreamPaymentAsset } from "@dstream/protocol";
import { createHash } from "node:crypto";
import { decimalToAtomic, parsePositiveEnvInt } from "./amount";
import { getJson, getText, joinOriginPath, postJson } from "./http";
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

interface EsploraTransaction {
  txid?: string;
  status?: {
    confirmed?: boolean;
    block_height?: number;
    block_hash?: string;
  };
  vout?: Array<{
    scriptpubkey?: string;
    scriptpubkey_address?: string;
    value?: number;
  }>;
}

interface EsploraObservation {
  txId: string;
  transactionFingerprint: string;
  blockHash: string;
  blockHeight: number;
  outputIndex: number;
  amountAtomic: bigint;
  confirmations: number;
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

function getBitcoinEsploraOrigins(): string[] {
  const raw = (process.env.DSTREAM_BTC_ESPLORA_ORIGINS ?? "").trim();
  if (!raw) return [];
  let values: string[];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      values = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  } else {
    values = raw.split(",");
  }
  const origins = new Set<string>();
  for (const value of values) {
    const candidate = value.trim().replace(/\/+$/, "");
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password) {
        origins.add(candidate);
      }
    } catch {
      // Invalid operator configuration is reported by the capability check.
    }
  }
  return Array.from(origins);
}

function getBitcoinEsploraQuorum(): number {
  return Math.max(2, parsePositiveEnvInt("DSTREAM_BTC_ESPLORA_QUORUM", 2, 10));
}

function hasBitcoinEsploraQuorum(): boolean {
  return getBitcoinEsploraOrigins().length >= getBitcoinEsploraQuorum();
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
  return Object.values(CONFIGS).map((config) => {
    const rpcConfigured = !!getOrigin(config);
    const esploraConfigured = config.asset === "btc" && getNetwork(config) === "main" && hasBitcoinEsploraQuorum();
    const configured = rpcConfigured || esploraConfigured;
    const esploraOrigins = config.asset === "btc" ? getBitcoinEsploraOrigins() : [];
    const esploraQuorum = config.asset === "btc" ? getBitcoinEsploraQuorum() : 0;
    return {
      asset: config.asset,
      railId: "utxo",
      network: getNetwork(config),
      configured,
      confirmationsRequired: getConfirmationsRequired(config),
      verifier: rpcConfigured ? "json_rpc" : "rest",
      ...(!configured
        ? {
            reason:
              config.asset === "btc" && esploraOrigins.length > 0
                ? getNetwork(config) !== "main"
                  ? "Bitcoin Esplora verification supports mainnet only."
                  : `Bitcoin Esplora verification requires ${esploraQuorum} unique endpoints; ${esploraOrigins.length} configured.`
                : `${config.label} settlement verifier is not configured.`
          }
        : {})
    };
  });
}

export function getBitcoinCapability(): PaymentRailCapability {
  return getUtxoCapabilities().find((entry) => entry.asset === "btc")!;
}

function esploraObservationKey(observation: EsploraObservation): string {
  return [
    observation.txId,
    observation.transactionFingerprint,
    observation.blockHash || "unconfirmed",
    observation.blockHeight,
    observation.outputIndex,
    observation.amountAtomic.toString()
  ].join(":");
}

async function readEsploraObservation(input: {
  origin: string;
  txId: string;
  address: string;
  expectedAtomic: bigint;
}): Promise<EsploraObservation> {
  const label = `Bitcoin indexer ${new URL(input.origin).hostname}`;
  const [tx, tipRaw] = await Promise.all([
    getJson<EsploraTransaction>({
      url: joinOriginPath(input.origin, `tx/${input.txId}`),
      label
    }),
    getText({
      url: joinOriginPath(input.origin, "blocks/tip/height"),
      label
    })
  ]);
  if ((tx.txid ?? "").trim().toLowerCase() !== input.txId) {
    throw new PaymentVerificationError(`${label} returned a different transaction.`, 502);
  }
  const tipHeight = Number.parseInt(tipRaw.trim(), 10);
  if (!Number.isSafeInteger(tipHeight) || tipHeight < 0) {
    throw new PaymentVerificationError(`${label} returned a malformed chain height.`, 502);
  }
  const status = tx.status;
  const confirmed = status?.confirmed === true;
  const blockHeight = confirmed && Number.isSafeInteger(status?.block_height) ? Number(status?.block_height) : 0;
  const blockHash = confirmed && /^[a-f0-9]{64}$/i.test(status?.block_hash ?? "") ? status!.block_hash!.toLowerCase() : "";
  if (confirmed && (!blockHeight || !blockHash || blockHeight > tipHeight)) {
    throw new PaymentVerificationError(`${label} returned malformed confirmation data.`, 502);
  }

  const transactionFingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        (tx.vout ?? []).map((output) => [
          typeof output.scriptpubkey === "string" ? output.scriptpubkey.toLowerCase() : "",
          Number.isSafeInteger(output.value) ? output.value : null
        ])
      )
    )
    .digest("hex");

  let outputIndex = -1;
  let amountAtomic = 0n;
  for (let index = 0; index < (tx.vout ?? []).length; index++) {
    const output = tx.vout![index]!;
    if ((output.scriptpubkey_address ?? "").trim() !== input.address) continue;
    if (!Number.isSafeInteger(output.value) || Number(output.value) < 0) {
      throw new PaymentVerificationError(`${label} returned a malformed output value.`, 502);
    }
    const value = BigInt(Number(output.value));
    if (value < input.expectedAtomic) continue;
    outputIndex = index;
    amountAtomic = value;
    break;
  }

  return {
    txId: input.txId,
    transactionFingerprint,
    blockHash,
    blockHeight,
    outputIndex,
    amountAtomic,
    confirmations: confirmed ? tipHeight - blockHeight + 1 : 0
  };
}

async function verifyBitcoinWithEsplora(input: {
  txId: string;
  address: string;
  expectedAtomic: bigint;
  network: string;
  confirmationsRequired: number;
}): Promise<VerifiedPayment> {
  if (input.network !== "main") {
    throw new PaymentVerificationError("Bitcoin public indexer verification is configured for mainnet only.", 503);
  }
  const origins = getBitcoinEsploraOrigins();
  const quorum = getBitcoinEsploraQuorum();
  if (origins.length < quorum) {
    throw new PaymentVerificationError(`Bitcoin indexer quorum is not configured (${origins.length}/${quorum}).`, 503);
  }
  const observations = (
    await Promise.allSettled(
      origins.map((origin) =>
        readEsploraObservation({
          origin,
          txId: input.txId,
          address: input.address,
          expectedAtomic: input.expectedAtomic
        })
      )
    )
  )
    .filter((result): result is PromiseFulfilledResult<EsploraObservation> => result.status === "fulfilled")
    .map((result) => result.value);
  if (observations.length < quorum) {
    throw new PaymentVerificationError(`Bitcoin indexer quorum is unavailable (${observations.length}/${quorum}).`, 502);
  }

  const groups = new Map<string, EsploraObservation[]>();
  for (const observation of observations) {
    const key = esploraObservationKey(observation);
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  const agreed = Array.from(groups.values())
    .filter((group) => group.length >= quorum)
    .sort((a, b) => b.length - a.length)[0];
  if (!agreed) {
    throw new PaymentVerificationError("Bitcoin indexers disagree on the transaction settlement data.", 502);
  }
  const observation = agreed[0]!;
  if (observation.outputIndex < 0) {
    throw new PaymentVerificationError("Bitcoin transaction does not pay the required recipient and amount.");
  }
  const confirmations = Math.min(...agreed.map((row) => row.confirmations));
  if (confirmations < input.confirmationsRequired) {
    throw new PaymentVerificationError(
      `Bitcoin payment has ${confirmations}/${input.confirmationsRequired} confirmations.`,
      402
    );
  }
  return {
    asset: "btc",
    railId: "utxo",
    network: input.network,
    txId: input.txId,
    settlementKey: `btc:${input.network}:${input.txId}:${observation.outputIndex}`,
    recipient: input.address,
    amountAtomic: observation.amountAtomic.toString(),
    confirmations,
    blockHeight: observation.blockHeight,
    finality: "confirmed",
    metadata: {
      outputIndex: observation.outputIndex,
      blockHash: observation.blockHash,
      verifier: "esplora_quorum",
      quorum,
      agreeingProviders: agreed.length
    }
  };
}

export async function verifyUtxoPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  const config = getConfig(input.asset);
  const txId = (input.txId ?? input.proof?.txId ?? input.proof?.transactionHash ?? "").trim().toLowerCase();
  const address = normalizeAddress(config.asset, input.address);
  if (!/^[a-f0-9]{64}$/.test(txId)) throw new PaymentVerificationError(`${config.label} transaction ID is malformed.`, 400);
  if (!address || address.length > 200) throw new PaymentVerificationError(`${config.label} recipient address is missing.`, 400);
  const expectedAtomic = decimalToAtomic(input.amount, 8);
  assertRequestedNetwork(config, input.network);

  const network = getNetwork(config);
  if (config.asset === "btc" && !getOrigin(config)) {
    return verifyBitcoinWithEsplora({
      txId,
      address,
      expectedAtomic,
      network,
      confirmationsRequired: getConfirmationsRequired(config)
    });
  }

  const chain = await utxoRpc<BlockchainInfo>(config, "getblockchaininfo");
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
    throw new PaymentVerificationError(`${config.label} payment has ${confirmations}/${required} confirmations.`, 402);
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
