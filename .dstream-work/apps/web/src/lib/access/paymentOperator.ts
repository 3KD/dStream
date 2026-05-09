import { createHash } from "node:crypto";
import type {
  PaymentOperatorSessionCreateRequest,
  PaymentOperatorSessionCreateResponse,
  PaymentOperatorSessionObserveRequest,
  PaymentOperatorSessionObserveResponse,
  PaymentOperatorSessionStatusRequest,
  PaymentOperatorSessionStatusResponse,
  PaymentRailId,
  PaymentSessionProofMode,
  PaymentSessionStatus,
  PaymentSessionTarget,
  PaymentSettlementProof,
  PaymentSettlementTarget,
  StreamPaymentAsset,
  VerifiedPaymentSettlement
} from "@dstream/protocol";
import { PAYMENT_RAIL_IDS, STREAM_PAYMENT_ASSETS, makeATag } from "@dstream/protocol";
import bs58 from "bs58";
import { SimplePool, type Event, type Filter, validateEvent, verifyEvent } from "nostr-tools";
import { readTextFileWithBackup, writeJsonFileAtomic } from "../storage/jsonFileStore";
import { buildPaymentUri } from "../payments/catalog";
import { normalizeNetworkKey, resolveEvmTokenMeta, TRON_USDT_CONTRACT } from "../payments/chains";
import { paymentSettlementTargetToMethod } from "../payments/targets";
import { PAYMENT_ASSET_DECIMALS, formatUnits, parseAmountToUnits } from "../payments/units";
import { buildCanonicalSettlementRef } from "../payments/settlement";
import { getNostrRelays } from "../config";
import { findLatestIncomingTip } from "../monero/tipVerify";
import { getXmrConfirmationsRequired, getXmrWalletRpcAccountIndex, getXmrWalletRpcClient } from "../monero/server";
import { NIP57_ZAP_RECEIPT_KIND, parseZapReceiptEvent, parseZapRequestEvent } from "../zaps";
import { getVideoAccessPackageById, type VideoAccessPackage } from "./packages";
import { resolveVideoPackageRailId } from "./paymentSessionConfig";
import { verifyPurchaseSettlement } from "./purchaseVerifier";

const STORE_PATH =
  (process.env.DSTREAM_PAYMENT_OPERATOR_STORE_PATH ?? "/var/lib/dstream/payment-operator-sessions.json").trim() ||
  "/var/lib/dstream/payment-operator-sessions.json";
const LIGHTNING_INVOICE_RE = /^(lnbc|lntb|lnbcrt|lnsb|lntbs)[0-9a-z]+$/i;
const LIGHTNING_ADDRESS_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const LIGHTNING_LNURL_RE = /^lnurl[0-9a-z]+$/i;
const LIGHTNING_SEARCH_SLACK_SEC = 5 * 60;
const LNURL_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
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
const DEFAULT_FETCH_TIMEOUT_MS = 12_000;
const EVM_BLOCK_SCAN_LIMIT = 768n;
const SOLANA_SIGNATURE_SCAN_LIMIT = 50;
const TRON_HISTORY_SCAN_LIMIT = 50;
const SESSION_AMOUNT_DELTA_MAX = 4096n;
const zapReceiptPool = new SimplePool();

interface PaymentOperatorSessionRecord {
  version: 1;
  id: string;
  packageId: string;
  hostPubkey: string;
  streamId: string;
  viewerPubkey: string;
  railId: PaymentRailId;
  asset: StreamPaymentAsset;
  status: PaymentSessionStatus;
  proofMode: PaymentSessionProofMode;
  target: PaymentSessionTarget;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs?: number;
  settlement?: VerifiedPaymentSettlement;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface OperatorSessionStoreShape {
  version: 1;
  updatedAtMs: number;
  sessions: PaymentOperatorSessionRecord[];
}

let loaded = false;
let sessionsCache: PaymentOperatorSessionRecord[] = [];

function nowMs(): number {
  return Date.now();
}

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function asObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function sanitizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  try {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parsePositiveInt(input: unknown): number | undefined {
  const value = Number(input);
  if (!Number.isInteger(value) || value < 0) return undefined;
  return Math.trunc(value);
}

function parseDigitsBigInt(input: unknown): bigint | null {
  const value = asString(input);
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseBtcAmountToMsats(amountRaw: string): number | null {
  const raw = amountRaw.trim();
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fractionRaw = match[2] ?? "";
  if (fractionRaw.length > 8) return null;
  const fraction = fractionRaw.padEnd(8, "0");
  const sats = Number(whole) * 100_000_000 + Number(fraction || "0");
  if (!Number.isSafeInteger(sats) || sats <= 0) return null;
  const msats = sats * 1000;
  return Number.isSafeInteger(msats) && msats > 0 ? msats : null;
}

function isLightningInvoice(destination: string): boolean {
  return LIGHTNING_INVOICE_RE.test(destination.trim());
}

function isLightningAddress(destination: string): boolean {
  return LIGHTNING_ADDRESS_RE.test(destination.trim());
}

function isLightningLnurl(destination: string): boolean {
  return LIGHTNING_LNURL_RE.test(destination.trim());
}

function convertBits(words: number[], fromBits: number, toBits: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const maxValue = (1 << toBits) - 1;
  const result: number[] = [];
  for (const value of words) {
    if (value < 0 || value >= 1 << fromBits) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxValue);
    }
  }
  if (pad) {
    if (bits > 0) result.push((acc << (toBits - bits)) & maxValue);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxValue) !== 0) {
    return null;
  }
  return result;
}

function decodeLnurlBech32(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const lowered = value.toLowerCase();
  const separatorIndex = lowered.lastIndexOf("1");
  if (separatorIndex <= 0 || separatorIndex + 7 > lowered.length) return null;
  const words = lowered
    .slice(separatorIndex + 1)
    .split("")
    .map((char) => LNURL_CHARSET.indexOf(char));
  if (words.some((word) => word < 0)) return null;
  const payload = words.slice(0, -6);
  const bytes = convertBits(payload, 5, 8, false);
  if (!bytes) return null;
  try {
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return null;
  }
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function buildConfiguredEnvName(prefix: string, network: string): string {
  return `${prefix}_${network.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`;
}

function networkLookupKey(input: unknown): string {
  const normalized = normalizeNetworkKey(asString(input));
  const parts = normalized.split(":").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
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

interface JsonRpcConfig {
  url: string;
  headers?: Record<string, string>;
}

function basicAuthHeaders(user: string, pass: string): Record<string, string> | undefined {
  if (!user || !pass) return undefined;
  const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  return { authorization: `Basic ${token}` };
}

function envJsonRpc(baseName: string): JsonRpcConfig | null {
  const url = env(`${baseName}_URL`);
  if (!url) return null;
  return {
    url,
    headers: basicAuthHeaders(env(`${baseName}_USER`), env(`${baseName}_PASS`))
  };
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

function compareAddress(asset: StreamPaymentAsset, left: string, right: string): boolean {
  if (asset === "bch") {
    const normalize = (value: string) => value.trim().toLowerCase().replace(/^bitcoincash:/, "");
    return normalize(left) === normalize(right);
  }
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function normalizeHexAddress(input: string): string {
  return input.trim().toLowerCase();
}

function parseHexQuantity(input: unknown): bigint | null {
  const value = asString(input).toLowerCase();
  if (!value) return null;
  try {
    if (value.startsWith("0x")) return BigInt(value);
    if (/^\d+$/.test(value)) return BigInt(value);
    return null;
  } catch {
    return null;
  }
}

function toHexQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function parseAtomicFromDecimalString(valueRaw: unknown, asset: StreamPaymentAsset): bigint | null {
  if (typeof valueRaw !== "number" && typeof valueRaw !== "string") return null;
  return parseAmountToUnits(String(valueRaw), PAYMENT_ASSET_DECIMALS[asset] ?? 8);
}

function decodeErc20TransferInput(dataRaw: unknown): { recipient: string; amount: bigint } | null {
  const data = asString(dataRaw).toLowerCase();
  if (!data.startsWith("0xa9059cbb") || data.length < 138) return null;
  try {
    return {
      recipient: `0x${data.slice(34, 74)}`,
      amount: BigInt(`0x${data.slice(74, 138)}`)
    };
  } catch {
    return null;
  }
}

function tronHexToBase58(input: string): string {
  const hex = input.trim().replace(/^0x/i, "");
  const payload = Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, "hex");
  const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, checksum]));
}

function allocateSessionAmountDelta(input: { railId: PaymentRailId; destination: string; sessionId: string }): bigint {
  const used = new Set<string>(
    sessionsCache
      .filter(
        (row) =>
          row.railId === input.railId &&
          row.target.destination === input.destination &&
          !isExpired(row) &&
          row.status !== "failed" &&
          row.status !== "expired" &&
          row.status !== "cancelled"
      )
      .map((row) => asString(row.metadata?.sessionAmountDeltaAtomic))
      .filter(Boolean)
  );
  const seedHex = createHash("sha256").update(`${input.railId}:${input.destination}:${input.sessionId}`).digest("hex").slice(0, 12);
  const seed = BigInt(`0x${seedHex}`);
  for (let offset = 0n; offset < SESSION_AMOUNT_DELTA_MAX; offset += 1n) {
    const candidate = ((seed + offset) % SESSION_AMOUNT_DELTA_MAX) + 1n;
    if (!used.has(candidate.toString())) return candidate;
  }
  throw new Error("Built-in operator could not reserve a unique session amount delta.");
}

function allocateSessionAmountTarget(input: {
  pkg: VideoAccessPackage;
  sessionId: string;
  operatorMode: string;
  referencePrefix: string;
}): { target: PaymentSessionTarget; metadata: Record<string, unknown> } {
  const baseTarget = input.pkg.paymentTarget;
  if (!baseTarget) throw new Error("Package is missing a settlement target.");
  const baseAmountAtomic = parseDigitsBigInt(baseTarget.amountAtomic) ?? packageRequiredAmountAtomic(input.pkg);
  if (baseAmountAtomic === null) throw new Error("Package amount is invalid.");
  const deltaAtomic = allocateSessionAmountDelta({
    railId: resolveVideoPackageRailId(input.pkg),
    destination: baseTarget.destination,
    sessionId: input.sessionId
  });
  const sessionAmountAtomic = baseAmountAtomic + deltaAtomic;
  const target = buildDefaultTarget(
    {
      ...baseTarget,
      amount: formatUnits(sessionAmountAtomic, PAYMENT_ASSET_DECIMALS[input.pkg.paymentAsset] ?? 8),
      amountAtomic: sessionAmountAtomic.toString(),
      reference: baseTarget.reference || `${input.referencePrefix}+${deltaAtomic.toString()}`
    },
    input.sessionId
  );
  return {
    target,
    metadata: {
      operatorMode: input.operatorMode,
      sessionBaseAmountAtomic: baseAmountAtomic.toString(),
      sessionAmountAtomic: sessionAmountAtomic.toString(),
      sessionAmountDeltaAtomic: deltaAtomic.toString()
    }
  };
}

function allocateXrplDestinationTag(sessionId: string, destination: string): string {
  const used = new Set<string>(
    sessionsCache
      .filter(
        (row) =>
          row.railId === "xrpl" &&
          row.target.destination === destination &&
          !isExpired(row) &&
          row.status !== "failed" &&
          row.status !== "expired" &&
          row.status !== "cancelled"
      )
      .map((row) => row.target.reference ?? "")
      .filter(Boolean)
  );
  const seedHex = createHash("sha256").update(`xrpl:${destination}:${sessionId}`).digest("hex").slice(0, 8);
  const candidate = (Number.parseInt(seedHex, 16) % 2_147_483_647) + 1;
  for (let i = 0; i < 4096; i += 1) {
    const value = String(((candidate + i) % 2_147_483_647) + 1);
    if (!used.has(value)) return value;
  }
  throw new Error("Built-in operator could not reserve a unique XRPL destination tag.");
}

function rippleTimeToUnixMs(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return (numeric + 946684800) * 1000;
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = readTextFileWithBackup(STORE_PATH);
    if (!raw) throw new Error("no store");
    const parsed = JSON.parse(raw) as Partial<OperatorSessionStoreShape> | null;
    const sessionRows = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    sessionsCache = sessionRows
      .map((row) => sanitizeSessionRecord(row))
      .filter((row): row is PaymentOperatorSessionRecord => !!row);
  } catch {
    sessionsCache = [];
  }
}

function persist(): void {
  writeJsonFileAtomic(STORE_PATH, {
    version: 1,
    updatedAtMs: nowMs(),
    sessions: sessionsCache
  } satisfies OperatorSessionStoreShape);
}

function cloneSession<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizePaymentSessionTarget(input: unknown): PaymentSessionTarget | null {
  const row = asObject(input);
  if (!row) return null;
  const destination = asString(row.destination);
  const railId = asString(row.railId).toLowerCase();
  const asset = asString(row.asset).toLowerCase();
  if (!destination) return null;
  if (!PAYMENT_RAIL_IDS.includes(railId as PaymentRailId)) return null;
  if (!STREAM_PAYMENT_ASSETS.includes(asset as StreamPaymentAsset)) return null;
  return {
    version: 1,
    railId: railId as PaymentRailId,
    asset: asset as StreamPaymentAsset,
    targetType: (asString(row.targetType) as PaymentSessionTarget["targetType"]) || "address",
    destination,
    network: asString(row.network) || undefined,
    label: asString(row.label) || undefined,
    reference: asString(row.reference) || undefined,
    contractAddress: asString(row.contractAddress) || undefined,
    amount: asString(row.amount) || undefined,
    amountAtomic: asString(row.amountAtomic) || undefined,
    walletUri: asString(row.walletUri) || undefined,
    qrValue: asString(row.qrValue) || undefined,
    metadata: sanitizeMetadata(row.metadata)
  };
}

function sanitizeSettlementProof(input: unknown): PaymentSettlementProof | undefined {
  const row = asObject(input);
  if (!row) return undefined;
  const railId = asString(row.railId).toLowerCase();
  const asset = asString(row.asset).toLowerCase();
  const proofType = asString(row.proofType);
  if (Number(row.version) !== 1) return undefined;
  if (!PAYMENT_RAIL_IDS.includes(railId as PaymentRailId)) return undefined;
  if (!STREAM_PAYMENT_ASSETS.includes(asset as StreamPaymentAsset)) return undefined;
  if (!proofType) return undefined;
  return {
    version: 1,
    railId: railId as PaymentRailId,
    asset: asset as StreamPaymentAsset,
    proofType,
    settlementRef: asString(row.settlementRef) || undefined,
    txRef: asString(row.txRef) || undefined,
    network: asString(row.network) || undefined,
    amount: asString(row.amount) || undefined,
    amountAtomic: asString(row.amountAtomic) || undefined,
    payload: sanitizeMetadata(row.payload),
    metadata: sanitizeMetadata(row.metadata)
  };
}

function sanitizeStatus(input: unknown): PaymentSessionStatus {
  const value = asString(input).toLowerCase();
  if (
    value === "created" ||
    value === "awaiting_payment" ||
    value === "pending_operator" ||
    value === "observed" ||
    value === "verified" ||
    value === "granted" ||
    value === "expired" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "pending_operator";
}

function sanitizeProofMode(input: unknown): PaymentSessionProofMode {
  const value = asString(input).toLowerCase();
  if (value === "none" || value === "operator_observed" || value === "client_tx_ref" || value === "client_settlement_proof") {
    return value;
  }
  return "operator_observed";
}

function sanitizeSessionRecord(input: unknown): PaymentOperatorSessionRecord | null {
  const row = asObject(input);
  if (!row) return null;
  const target = sanitizePaymentSessionTarget(row.target);
  const railId = asString(row.railId).toLowerCase();
  const asset = asString(row.asset).toLowerCase();
  if (!target) return null;
  if (!PAYMENT_RAIL_IDS.includes(railId as PaymentRailId)) return null;
  if (!STREAM_PAYMENT_ASSETS.includes(asset as StreamPaymentAsset)) return null;
  const id = asString(row.id);
  const packageId = asString(row.packageId);
  const hostPubkey = asString(row.hostPubkey).toLowerCase();
  const streamId = asString(row.streamId);
  const viewerPubkey = asString(row.viewerPubkey).toLowerCase();
  if (!id || !packageId || !/^[a-f0-9]{64}$/.test(hostPubkey) || !streamId || !/^[a-f0-9]{64}$/.test(viewerPubkey)) return null;
  return {
    version: 1,
    id,
    packageId,
    hostPubkey,
    streamId,
    viewerPubkey,
    railId: railId as PaymentRailId,
    asset: asset as StreamPaymentAsset,
    status: sanitizeStatus(row.status),
    proofMode: sanitizeProofMode(row.proofMode),
    target,
    createdAtMs: Number(row.createdAtMs) || nowMs(),
    updatedAtMs: Number(row.updatedAtMs) || nowMs(),
    expiresAtMs: Number.isFinite(Number(row.expiresAtMs)) ? Number(row.expiresAtMs) : undefined,
    settlement: (row.settlement as VerifiedPaymentSettlement | undefined) ?? undefined,
    error: asString(row.error) || undefined,
    metadata: sanitizeMetadata(row.metadata)
  };
}

function buildDefaultTarget(baseTarget: PaymentSettlementTarget, sessionId: string): PaymentSessionTarget {
  const method = paymentSettlementTargetToMethod(baseTarget, baseTarget.amount);
  const walletUri = method ? buildPaymentUri(method) : undefined;
  const fallbackReference = baseTarget.reference || `session:${sessionId.slice(0, 12)}`;
  const lightningTarget = baseTarget.railId === "lightning";
  return {
    version: 1,
    railId: baseTarget.railId,
    asset: baseTarget.asset,
    targetType: lightningTarget && walletUri?.startsWith("lightning:") ? "invoice" : "address",
    destination: baseTarget.destination,
    network: baseTarget.network,
    label: baseTarget.label,
    reference: lightningTarget ? baseTarget.reference : fallbackReference,
    contractAddress: baseTarget.contractAddress,
    amount: baseTarget.amount,
    amountAtomic: baseTarget.amountAtomic,
    walletUri: walletUri ?? undefined,
    qrValue: walletUri || baseTarget.destination,
    metadata: sanitizeMetadata(baseTarget.metadata)
  };
}

function isExpired(session: PaymentOperatorSessionRecord): boolean {
  return typeof session.expiresAtMs === "number" && session.expiresAtMs <= nowMs();
}

function findSession(sessionId: string): PaymentOperatorSessionRecord | null {
  ensureLoaded();
  const found = sessionsCache.find((row) => row.id === sessionId);
  return found ? found : null;
}

function updateSession(sessionId: string, updater: (current: PaymentOperatorSessionRecord) => PaymentOperatorSessionRecord): PaymentOperatorSessionRecord {
  ensureLoaded();
  const index = sessionsCache.findIndex((row) => row.id === sessionId);
  if (index < 0) throw new Error("Operator payment session not found.");
  const next = updater(cloneSession(sessionsCache[index]!));
  sessionsCache[index] = next;
  persist();
  return cloneSession(next);
}

function packageRequiredAmountAtomic(pkg: VideoAccessPackage): bigint | null {
  return parseAmountToUnits(pkg.paymentAmount, PAYMENT_ASSET_DECIMALS[pkg.paymentAsset] ?? 8);
}

function buildXmrSettlement(input: {
  pkg: VideoAccessPackage;
  txRef?: string;
  amountAtomic: bigint;
  observedAtMs: number;
  confirmations: number;
  accountIndex: number;
  addressIndex: number;
  label?: string;
}): VerifiedPaymentSettlement {
  const settlementKind = "xmr_subaddress_transfer";
  return {
    version: 1,
    railId: "xmr",
    asset: "xmr",
    settlementKind,
    settlementRef: buildCanonicalSettlementRef({
      railId: "xmr",
      settlementKind,
      txRef: input.txRef ?? `acct${input.accountIndex}-sub${input.addressIndex}`
    }),
    txRef: input.txRef,
    amount: formatUnits(input.amountAtomic, PAYMENT_ASSET_DECIMALS[input.pkg.paymentAsset] ?? 12),
    amountAtomic: input.amountAtomic.toString(),
    confirmed: true,
    observedAtMs: input.observedAtMs,
    verifier: "host_origin",
    metadata: {
      accountIndex: input.accountIndex,
      addressIndex: input.addressIndex,
      confirmations: input.confirmations,
      packageId: input.pkg.id,
      streamId: input.pkg.streamId,
      hostPubkey: input.pkg.hostPubkey,
      label: input.label ?? null
    }
  };
}

function makeXmrPackageLabel(input: { hostPubkey: string; streamId: string; packageId: string; viewerPubkey: string; sessionId: string }): string {
  return [
    "dstream_operator_pkg",
    input.hostPubkey.slice(0, 16),
    input.streamId,
    input.packageId.slice(0, 12),
    input.viewerPubkey.slice(0, 12),
    input.sessionId.slice(0, 12)
  ].join(":");
}

function resolveLocalPackage(input: PaymentOperatorSessionCreateRequest["package"]): VideoAccessPackage | null {
  const local = getVideoAccessPackageById(input.id);
  if (!local) return null;
  if (local.hostPubkey !== input.hostPubkey) return null;
  if (local.streamId !== input.streamId) return null;
  return local;
}

function buildObservedTxProof(session: PaymentOperatorSessionRecord, pkg: VideoAccessPackage, txRef: string): PaymentSettlementProof {
  return {
    version: 1,
    railId: session.railId,
    asset: pkg.paymentAsset,
    proofType: "transaction_reference",
    txRef,
    network: session.target.network,
    payload: {
      txRef,
      network: session.target.network
    }
  };
}

async function finalizeObservedTransactionSession(
  session: PaymentOperatorSessionRecord,
  pkg: VideoAccessPackage,
  txRef: string,
  metadata?: Record<string, unknown>
): Promise<PaymentOperatorSessionStatusResponse> {
  const verification = await verifyPurchaseSettlement({
    package: pkg,
    buyerPubkey: session.viewerPubkey,
    buyerProofEvent: null,
    settlementProof: buildObservedTxProof(session, pkg, txRef),
    metadata: {
      paymentOperatorSessionId: session.id,
      paymentOperatorMode: session.metadata?.operatorMode ?? "built_in",
      ...sanitizeMetadata(metadata)
    }
  });

  if (!verification.supported) {
    return { ok: false, error: "Built-in operator cannot verify observed settlement for this rail." };
  }
  if (!verification.verified || !verification.settlement) {
    return {
      ok: true,
      status: verification.status === 400 || verification.status === 403 ? "failed" : "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: {
        ...session.metadata,
        ...sanitizeMetadata(metadata),
        txRef
      },
      error: verification.error ?? "Observed settlement could not be verified."
    };
  }

  const updated = updateSession(session.id, (current) => ({
    ...current,
    status: "verified",
    settlement: verification.settlement,
    error: undefined,
    updatedAtMs: nowMs(),
    metadata: {
      ...current.metadata,
      ...sanitizeMetadata(verification.metadata),
      ...sanitizeMetadata(metadata),
      txRef
    }
  }));
  return {
    ok: true,
    status: updated.status,
    proofMode: updated.proofMode,
    target: updated.target,
    expiresAtMs: updated.expiresAtMs,
    metadata: updated.metadata,
    settlement: updated.settlement
  };
}

async function syncEvmSession(session: PaymentOperatorSessionRecord): Promise<PaymentOperatorSessionStatusResponse> {
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) return { ok: false, error: "Video package not found for operator session." };
  if (session.metadata?.operatorMode !== "built_in_evm_amount_watch") {
    return {
      ok: true,
      status: session.settlement ? "verified" : session.status,
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      settlement: session.settlement,
      error: session.error
    };
  }

  const expectedAmountAtomic = parseDigitsBigInt(session.target.amountAtomic) ?? packageRequiredAmountAtomic(pkg);
  if (expectedAmountAtomic === null) return { ok: false, error: "EVM operator session amount metadata is incomplete." };

  const network = networkLookupKey(session.target.network || pkg.paymentTarget?.network || "ethereum");
  const rpcUrl =
    env(buildConfiguredEnvName("DSTREAM_ACCESS_EVM_RPC", network)) ||
    env("DSTREAM_ACCESS_EVM_RPC_URL") ||
    DEFAULT_EVM_RPC_BY_NETWORK[network] ||
    DEFAULT_EVM_RPC_BY_NETWORK.ethereum;
  if (!rpcUrl) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error: `No EVM RPC configured for ${network}.`
    };
  }

  const latestBlock = await postJsonRpc<any>({ url: rpcUrl }, "eth_blockNumber", []).catch((error: any) => ({ error }));
  if ((latestBlock as { error?: unknown }).error) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error: ((latestBlock as { error?: any }).error?.message as string | undefined) ?? "EVM session observation failed."
    };
  }

  const latestBlockNumber = parseHexQuantity(latestBlock);
  if (latestBlockNumber === null) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata
    };
  }

  const tokenMeta =
    pkg.paymentAsset === "eth"
      ? null
      : resolveEvmTokenMeta(pkg.paymentAsset, session.target.network || pkg.paymentTarget?.network || network, session.target.contractAddress);
  if (pkg.paymentAsset !== "eth" && !tokenMeta) {
    return {
      ok: false,
      error: `No EVM token contract is configured for ${pkg.paymentAsset.toUpperCase()} on ${network}.`
    };
  }

  let scanned = 0n;
  for (let blockNumber = latestBlockNumber; blockNumber >= 0n && scanned < EVM_BLOCK_SCAN_LIMIT; blockNumber -= 1n, scanned += 1n) {
    const block = await postJsonRpc<any>({ url: rpcUrl }, "eth_getBlockByNumber", [toHexQuantity(blockNumber), true]).catch(() => null);
    if (!block) break;
    const blockTimestamp = parseHexQuantity(block.timestamp);
    if (blockTimestamp !== null && Number(blockTimestamp) * 1000 + LIGHTNING_SEARCH_SLACK_SEC * 1000 < session.createdAtMs) break;
    const transactions = Array.isArray(block.transactions) ? (block.transactions as unknown[]) : [];
    for (const entry of transactions) {
      const tx = asObject(entry);
      const txRef = asString(tx?.hash);
      if (!txRef) continue;
      if (pkg.paymentAsset === "eth") {
        if (!compareAddress("eth", asString(tx?.to), session.target.destination)) continue;
        const value = parseHexQuantity(tx?.value);
        if (value === null || value !== expectedAmountAtomic) continue;
        return finalizeObservedTransactionSession(session, pkg, txRef, {
          network,
          sessionAmountAtomic: expectedAmountAtomic.toString()
        });
      }
      if (!tokenMeta || normalizeHexAddress(asString(tx?.to)) !== normalizeHexAddress(tokenMeta.contract)) continue;
      const transfer = decodeErc20TransferInput(tx?.input);
      if (!transfer || normalizeHexAddress(transfer.recipient) !== normalizeHexAddress(session.target.destination)) continue;
      if (transfer.amount !== expectedAmountAtomic) continue;
      return finalizeObservedTransactionSession(session, pkg, txRef, {
        network,
        sessionAmountAtomic: expectedAmountAtomic.toString()
      });
    }
  }

  return {
    ok: true,
    status: "pending_operator",
    proofMode: session.proofMode,
    target: session.target,
    expiresAtMs: session.expiresAtMs,
    metadata: session.metadata
  };
}

async function syncSolanaSession(session: PaymentOperatorSessionRecord): Promise<PaymentOperatorSessionStatusResponse> {
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) return { ok: false, error: "Video package not found for operator session." };
  if (session.metadata?.operatorMode !== "built_in_solana_amount_watch") {
    return {
      ok: true,
      status: session.settlement ? "verified" : session.status,
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      settlement: session.settlement,
      error: session.error
    };
  }

  const expectedAmountAtomic = parseDigitsBigInt(session.target.amountAtomic) ?? packageRequiredAmountAtomic(pkg);
  if (expectedAmountAtomic === null) return { ok: false, error: "Solana operator session amount metadata is incomplete." };

  const network = networkLookupKey(session.target.network || pkg.paymentTarget?.network || "mainnet-beta");
  const rpcUrl = env("DSTREAM_ACCESS_SOLANA_RPC_URL") || DEFAULT_SOLANA_RPC_BY_NETWORK[network] || DEFAULT_SOLANA_RPC_BY_NETWORK["mainnet-beta"];
  const signatures = await postJsonRpc<any>(new (class implements JsonRpcConfig {
    url = rpcUrl;
  })(), "getSignaturesForAddress", [session.target.destination, { limit: SOLANA_SIGNATURE_SCAN_LIMIT }]).catch((error: any) => ({ error }));
  if ((signatures as { error?: unknown }).error) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error: ((signatures as { error?: any }).error?.message as string | undefined) ?? "Solana session observation failed."
    };
  }

  const entries = Array.isArray(signatures) ? (signatures as unknown[]) : [];
  for (const entry of entries) {
    const row = asObject(entry);
    if (!row || row.err) continue;
    const blockTimeMs = Number(row.blockTime ?? 0) * 1000;
    if (Number.isFinite(blockTimeMs) && blockTimeMs > 0 && blockTimeMs + LIGHTNING_SEARCH_SLACK_SEC * 1000 < session.createdAtMs) continue;
    const signature = asString(row.signature);
    if (!signature) continue;
    const transaction = await postJsonRpc<any>(new (class implements JsonRpcConfig {
      url = rpcUrl;
    })(), "getTransaction", [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]).catch(() => null);
    if (!transaction || transaction.meta?.err) continue;
    const instructions = Array.isArray(transaction.transaction?.message?.instructions)
      ? (transaction.transaction.message.instructions as unknown[])
      : [];
    const matched = instructions.find((instruction) => {
      const rowInstruction = asObject(instruction);
      const parsed = asObject(rowInstruction?.parsed);
      const info = asObject(parsed?.info);
      if (!parsed || asString(rowInstruction?.program) !== "system" || asString(parsed.type) !== "transfer" || !info) return false;
      if (asString(info.destination) !== session.target.destination) return false;
      return BigInt(asString(info.lamports) || "0") === expectedAmountAtomic;
    });
    if (!matched) continue;
    return finalizeObservedTransactionSession(session, pkg, signature, {
      network,
      sessionAmountAtomic: expectedAmountAtomic.toString()
    });
  }

  return {
    ok: true,
    status: "pending_operator",
    proofMode: session.proofMode,
    target: session.target,
    expiresAtMs: session.expiresAtMs,
    metadata: session.metadata
  };
}

async function syncTronSession(session: PaymentOperatorSessionRecord): Promise<PaymentOperatorSessionStatusResponse> {
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) return { ok: false, error: "Video package not found for operator session." };
  if (session.metadata?.operatorMode !== "built_in_tron_amount_watch") {
    return {
      ok: true,
      status: session.settlement ? "verified" : session.status,
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      settlement: session.settlement,
      error: session.error
    };
  }

  const expectedAmountAtomic = parseDigitsBigInt(session.target.amountAtomic) ?? packageRequiredAmountAtomic(pkg);
  if (expectedAmountAtomic === null) return { ok: false, error: "TRON operator session amount metadata is incomplete." };

  const baseUrl = (env("DSTREAM_ACCESS_TRON_RPC_URL") || DEFAULT_TRON_RPC_URL).replace(/\/$/, "");
  if (pkg.paymentAsset === "usdt") {
    const response = await fetchWithTimeout(
      `${baseUrl}/v1/accounts/${encodeURIComponent(session.target.destination)}/transactions/trc20?only_to=true&limit=${TRON_HISTORY_SCAN_LIMIT}&order_by=block_timestamp,desc`
    ).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    const rows = Array.isArray((body as { data?: unknown[] } | null)?.data) ? ((body as { data?: unknown[] }).data ?? []) : [];
    const expectedContract = session.target.contractAddress || pkg.paymentTarget?.contractAddress || TRON_USDT_CONTRACT;
    for (const entry of rows) {
      const row = asObject(entry);
      if (!row) continue;
      const blockTimeMs = Number(row.block_timestamp ?? 0);
      if (Number.isFinite(blockTimeMs) && blockTimeMs > 0 && blockTimeMs + LIGHTNING_SEARCH_SLACK_SEC * 1000 < session.createdAtMs) continue;
      if (asString(row.to) !== session.target.destination) continue;
      const tokenInfo = asObject(row.token_info);
      if (expectedContract && asString(tokenInfo?.address) !== expectedContract) continue;
      const amount = parseDigitsBigInt(row.value);
      if (amount === null || amount !== expectedAmountAtomic) continue;
      const txRef = asString(row.transaction_id);
      if (!txRef) continue;
      return finalizeObservedTransactionSession(session, pkg, txRef, {
        sessionAmountAtomic: expectedAmountAtomic.toString()
      });
    }
  } else {
    const response = await fetchWithTimeout(
      `${baseUrl}/v1/accounts/${encodeURIComponent(session.target.destination)}/transactions?only_to=true&limit=${TRON_HISTORY_SCAN_LIMIT}&order_by=block_timestamp,desc`
    ).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    const rows = Array.isArray((body as { data?: unknown[] } | null)?.data) ? ((body as { data?: unknown[] }).data ?? []) : [];
    for (const entry of rows) {
      const row = asObject(entry);
      if (!row) continue;
      const rawData = asObject(row.raw_data);
      const contractList = Array.isArray(rawData?.contract) ? rawData.contract : [];
      const blockTimeMs = Number(row.block_timestamp ?? rawData?.timestamp ?? 0);
      if (Number.isFinite(blockTimeMs) && blockTimeMs > 0 && blockTimeMs + LIGHTNING_SEARCH_SLACK_SEC * 1000 < session.createdAtMs) continue;
      const contract = asObject(contractList[0]);
      const value = asObject(asObject(contract?.parameter)?.value);
      const toAddress = asString(value?.to_address) ? tronHexToBase58(asString(value?.to_address)) : "";
      if (toAddress !== session.target.destination) continue;
      const amount = parseDigitsBigInt(value?.amount);
      if (amount === null || amount !== expectedAmountAtomic) continue;
      const txRef = asString(row.txID) || asString(row.txid);
      if (!txRef) continue;
      return finalizeObservedTransactionSession(session, pkg, txRef, {
        sessionAmountAtomic: expectedAmountAtomic.toString()
      });
    }
  }

  return {
    ok: true,
    status: "pending_operator",
    proofMode: session.proofMode,
    target: session.target,
    expiresAtMs: session.expiresAtMs,
    metadata: session.metadata
  };
}

async function syncUtxoSession(session: PaymentOperatorSessionRecord): Promise<PaymentOperatorSessionStatusResponse> {
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) return { ok: false, error: "Video package not found for operator session." };
  if (session.metadata?.operatorMode !== "built_in_utxo_amount_watch") {
    return {
      ok: true,
      status: session.settlement ? "verified" : session.status,
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      settlement: session.settlement,
      error: session.error
    };
  }

  const expectedAmountAtomic = parseDigitsBigInt(session.metadata?.sessionAmountAtomic) ?? parseDigitsBigInt(session.target.amountAtomic);
  if (expectedAmountAtomic === null) return { ok: false, error: "UTXO operator session amount metadata is incomplete." };

  const assetKey = pkg.paymentAsset.toUpperCase();
  const rpc = envJsonRpc(`DSTREAM_ACCESS_${assetKey}_RPC`);

  const findMatchingTxViaRpc = async (): Promise<string | null> => {
    if (!rpc) return null;
    const received = await postJsonRpc<any[]>(rpc, "listreceivedbyaddress", [0, true, true, session.target.destination]);
    const entry = Array.isArray(received)
      ? received.find((row) => compareAddress(pkg.paymentAsset, asString((row as { address?: unknown }).address), session.target.destination))
      : null;
    const txids = Array.isArray((entry as { txids?: unknown } | null)?.txids)
      ? (((entry as { txids?: unknown[] }).txids ?? []) as unknown[])
          .map((value) => asString(value))
          .filter(Boolean)
      : [];
    for (const txid of txids) {
      const tx = await postJsonRpc<any>(rpc, "getrawtransaction", [txid, true]);
      const confirmations = Number(tx?.confirmations ?? 0);
      if (!Number.isFinite(confirmations) || confirmations <= 0 || !Array.isArray(tx?.vout)) continue;
      const matched = tx.vout.find((output: any) => {
        const address = asString(output?.scriptPubKey?.address) || asString(output?.scriptPubKey?.addresses?.[0]) || "";
        if (!address || !compareAddress(pkg.paymentAsset, address, session.target.destination)) return false;
        const value = parseAtomicFromDecimalString(output?.value, pkg.paymentAsset);
        return value !== null && value === expectedAmountAtomic;
      });
      if (matched) return txid;
    }
    return null;
  };

  const findMatchingTxViaBlockstream = async (): Promise<string | null> => {
    const response = await fetchWithTimeout(
      `${BLOCKSTREAM_BTC_API}/address/${encodeURIComponent(session.target.destination)}/txs`,
      {}
    );
    const body = (await response.json().catch(() => null)) as Array<Record<string, unknown>> | null;
    if (!response.ok || !Array.isArray(body)) throw new Error(`BTC address lookup failed (${response.status}).`);
    const sinceSec = Math.floor(session.createdAtMs / 1000) - LIGHTNING_SEARCH_SLACK_SEC;
    for (const tx of body) {
      const status = asObject(tx.status);
      if (!status || status.confirmed !== true) continue;
      const blockTime = Number(status.block_time ?? 0);
      if (Number.isFinite(blockTime) && blockTime > 0 && blockTime < sinceSec) continue;
      const outputs = Array.isArray((tx as { vout?: unknown }).vout) ? ((tx as { vout?: unknown[] }).vout ?? []) : [];
      const matched = outputs.find((output) => {
        const row = asObject(output);
        if (!row) return false;
        if (!compareAddress("btc", asString(row.scriptpubkey_address), session.target.destination)) return false;
        const value = parseDigitsBigInt(row.value);
        return value !== null && value === expectedAmountAtomic;
      });
      const txid = asString((tx as { txid?: unknown }).txid);
      if (matched && txid) return txid;
    }
    return null;
  };

  let txRef: string | null = null;
  try {
    txRef = rpc ? await findMatchingTxViaRpc() : pkg.paymentAsset === "btc" ? await findMatchingTxViaBlockstream() : null;
  } catch (error: any) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error: error?.message ?? "UTXO session observation failed."
    };
  }

  if (!txRef) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error:
        rpc || pkg.paymentAsset === "btc"
          ? undefined
          : `${assetKey} session observation requires DSTREAM_ACCESS_${assetKey}_RPC_URL (and optional credentials).`
    };
  }

  return finalizeObservedTransactionSession(session, pkg, txRef, {
    sessionAmountAtomic: expectedAmountAtomic.toString()
  });
}

async function syncXrplSession(session: PaymentOperatorSessionRecord): Promise<PaymentOperatorSessionStatusResponse> {
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) return { ok: false, error: "Video package not found for operator session." };
  const operatorMode = asString(session.metadata?.operatorMode);
  if (operatorMode !== "built_in_xrpl_destination_tag" && operatorMode !== "built_in_xrpl_amount_watch") {
    return {
      ok: true,
      status: session.settlement ? "verified" : session.status,
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      settlement: session.settlement,
      error: session.error
    };
  }

  const rpcUrl = env("DSTREAM_ACCESS_XRPL_RPC_URL") || DEFAULT_XRPL_RPC_URL;
  const expectedAmountAtomic = parseDigitsBigInt(session.target.amountAtomic) ?? packageRequiredAmountAtomic(pkg);
  if (expectedAmountAtomic === null) return { ok: false, error: "XRPL operator session amount metadata is incomplete." };
  const expectedTag = session.target.reference;
  const result = await postJsonRpc<any>(new (class implements JsonRpcConfig {
    url = rpcUrl;
  })(), "account_tx", [
    {
      account: session.target.destination,
      ledger_index_min: -1,
      ledger_index_max: -1,
      binary: false,
      limit: 100,
      forward: false
    }
  ]).catch((error: any) => ({ error }));
  if ((result as { error?: unknown }).error) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error: ((result as { error?: any }).error?.message as string | undefined) ?? "XRPL session observation failed."
    };
  }

  const entries = Array.isArray((result as { transactions?: unknown }).transactions)
    ? (((result as { transactions?: unknown[] }).transactions ?? []) as unknown[])
    : [];
  const txEntry = entries.find((entry) => {
    const row = asObject(entry);
    const tx = asObject(row?.tx) ?? row;
    const meta = asObject(row?.meta) ?? asObject(tx?.meta);
    if (!tx || !meta) return false;
    if (row?.validated !== true && tx.validated !== true) return false;
    if (asString(tx.TransactionType) !== "Payment") return false;
    if (asString(tx.Destination) !== session.target.destination) return false;
    if (expectedTag && String(tx.DestinationTag ?? "") !== expectedTag) return false;
    if (asString(meta.TransactionResult) !== "tesSUCCESS") return false;
    const observedAtMs = rippleTimeToUnixMs(tx.date);
    if (observedAtMs && observedAtMs + LIGHTNING_SEARCH_SLACK_SEC * 1000 < session.createdAtMs) return false;
    const delivered = asString(meta.delivered_amount) || asString(tx.Amount);
    if (!/^\d+$/.test(delivered)) return false;
    return BigInt(delivered) === expectedAmountAtomic;
  });

  const tx = asObject(asObject(txEntry)?.tx) ?? asObject(txEntry);
  const txRef = asString(tx?.hash);
  if (!txRef) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata
    };
  }

  return finalizeObservedTransactionSession(session, pkg, txRef, {
    sessionAmountAtomic: expectedAmountAtomic.toString(),
    destinationTag: expectedTag ?? null
  });
}

async function syncCardanoSession(session: PaymentOperatorSessionRecord): Promise<PaymentOperatorSessionStatusResponse> {
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) return { ok: false, error: "Video package not found for operator session." };
  if (session.metadata?.operatorMode !== "built_in_cardano_amount_watch") {
    return {
      ok: true,
      status: session.settlement ? "verified" : session.status,
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      settlement: session.settlement,
      error: session.error
    };
  }

  const baseUrl = env("DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL");
  const projectId = env("DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID");
  if (!baseUrl || !projectId) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error: "Cardano session observation requires DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL and DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID."
    };
  }

  const expectedAmountAtomic = parseDigitsBigInt(session.metadata?.sessionAmountAtomic) ?? parseDigitsBigInt(session.target.amountAtomic);
  if (expectedAmountAtomic === null) return { ok: false, error: "Cardano operator session amount metadata is incomplete." };

  const txListResponse = await fetchWithTimeout(
    `${baseUrl.replace(/\/$/, "")}/addresses/${encodeURIComponent(session.target.destination)}/transactions?order=desc&count=50`,
    { headers: { project_id: projectId } }
  ).catch((error: any) => error);
  if (txListResponse instanceof Error) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error: txListResponse.message
    };
  }
  const txList = (await txListResponse.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  if (!txListResponse.ok || !Array.isArray(txList)) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error: `Cardano address transaction lookup failed (${txListResponse.status}).`
    };
  }

  const sinceSec = Math.floor(session.createdAtMs / 1000) - LIGHTNING_SEARCH_SLACK_SEC;
  for (const tx of txList) {
    const txRef = asString((tx as { tx_hash?: unknown }).tx_hash);
    const blockTime = Number((tx as { block_time?: unknown }).block_time ?? 0);
    if (!txRef) continue;
    if (Number.isFinite(blockTime) && blockTime > 0 && blockTime < sinceSec) continue;
    const utxoResponse = await fetchWithTimeout(
      `${baseUrl.replace(/\/$/, "")}/txs/${encodeURIComponent(txRef)}/utxos`,
      { headers: { project_id: projectId } }
    );
    const utxos = (await utxoResponse.json().catch(() => null)) as { outputs?: unknown[] } | null;
    if (!utxoResponse.ok || !utxos || !Array.isArray(utxos.outputs)) continue;
    const matched = utxos.outputs.find((output) => {
      const row = asObject(output);
      if (!row || asString(row.address) !== session.target.destination) return false;
      const amounts = Array.isArray(row.amount) ? (row.amount as unknown[]) : [];
      const lovelace = amounts.find((entry) => asString(asObject(entry)?.unit) === "lovelace");
      return parseDigitsBigInt(asObject(lovelace)?.quantity) === expectedAmountAtomic;
    });
    if (!matched) continue;
    return finalizeObservedTransactionSession(session, pkg, txRef, {
      sessionAmountAtomic: expectedAmountAtomic.toString()
    });
  }

  return {
    ok: true,
    status: "pending_operator",
    proofMode: session.proofMode,
    target: session.target,
    expiresAtMs: session.expiresAtMs,
    metadata: session.metadata
  };
}

interface LightningPayRequestTarget {
  payRequestUrl: string;
  sourceKind: "lightning_address" | "lnurl";
  lnurl?: string;
}

function resolveLightningPayRequestTarget(destinationRaw: string): LightningPayRequestTarget | null {
  const destination = destinationRaw.trim();
  if (isLightningAddress(destination)) {
    const [name, domain] = destination.split("@");
    if (!name || !domain) return null;
    return {
      payRequestUrl: `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`,
      sourceKind: "lightning_address"
    };
  }
  if (!isLightningLnurl(destination)) return null;
  const payRequestUrl = decodeLnurlBech32(destination);
  if (!payRequestUrl) return null;
  return {
    payRequestUrl,
    sourceKind: "lnurl",
    lnurl: destination
  };
}

async function createLightningSessionTarget(input: {
  pkg: VideoAccessPackage;
  sessionId: string;
  viewerPubkey: string;
  metadata?: Record<string, unknown>;
}): Promise<{ target: PaymentSessionTarget; metadata: Record<string, unknown> }> {
  const baseTarget = input.pkg.paymentTarget;
  if (!baseTarget) throw new Error("Lightning package is missing a payment target.");

  const destination = baseTarget.destination.trim();
  if (!destination) throw new Error("Lightning package target is invalid.");
  if (isLightningInvoice(destination)) {
    return {
      target: buildDefaultTarget(baseTarget, input.sessionId),
      metadata: {
        operatorMode: "built_in_static_target",
        lightningTargetKind: "invoice"
      }
    };
  }

  const payRequestTarget = resolveLightningPayRequestTarget(destination);
  if (!payRequestTarget) {
    return {
      target: buildDefaultTarget(baseTarget, input.sessionId),
      metadata: {
        operatorMode: "built_in_static_target",
        lightningTargetKind: "static"
      }
    };
  }

  const zapRequestEvent = asObject(input.metadata?.lightningZapRequestEvent);
  if (!zapRequestEvent) {
    throw new Error("Lightning operator sessions require a signed zap request for reusable Lightning targets.");
  }
  if (!validateEvent(zapRequestEvent as any) || !verifyEvent(zapRequestEvent as any)) {
    throw new Error("Lightning zap request must be a valid signed NIP-57 event.");
  }

  const zapRequest = parseZapRequestEvent(zapRequestEvent);
  if (!zapRequest) throw new Error("Lightning zap request could not be parsed.");
  if (zapRequest.pubkey !== input.viewerPubkey) {
    throw new Error("Lightning zap request signer does not match the payment session viewer.");
  }
  if (zapRequest.packageId !== input.pkg.id) {
    throw new Error("Lightning zap request package tag does not match the requested package.");
  }
  if (zapRequest.sessionId !== input.sessionId) {
    throw new Error("Lightning zap request session tag does not match the payment session.");
  }
  const expectedATag = makeATag(input.pkg.hostPubkey, input.pkg.streamId);
  if (zapRequest.streamATag && zapRequest.streamATag !== expectedATag) {
    throw new Error("Lightning zap request stream scope does not match the package stream.");
  }

  const amountMsat = parseBtcAmountToMsats(baseTarget.amount ?? input.pkg.paymentAmount);
  if (!amountMsat) throw new Error("Lightning package amount is invalid.");
  if (zapRequest.amountMsat !== null && zapRequest.amountMsat < amountMsat) {
    throw new Error("Lightning zap request amount is below the package price.");
  }

  const payInfoResponse = await fetch(payRequestTarget.payRequestUrl, { cache: "no-store" });
  if (!payInfoResponse.ok) {
    throw new Error(`Lightning pay request lookup failed (${payInfoResponse.status}).`);
  }
  const payInfo = (await payInfoResponse.json().catch(() => null)) as Record<string, unknown> | null;
  const callback = asString(payInfo?.callback);
  if (!callback) throw new Error("Lightning pay request did not return a callback URL.");
  if (payInfo?.allowsNostr !== true) {
    throw new Error("Lightning target does not advertise Nostr zap receipt support.");
  }
  const minSendable = parsePositiveInt(payInfo?.minSendable);
  const maxSendable = parsePositiveInt(payInfo?.maxSendable);
  if (minSendable !== undefined && amountMsat < minSendable) {
    throw new Error("Lightning package amount is below the LNURL minimum sendable value.");
  }
  if (maxSendable !== undefined && amountMsat > maxSendable) {
    throw new Error("Lightning package amount exceeds the LNURL maximum sendable value.");
  }

  const callbackUrl = new URL(callback);
  callbackUrl.searchParams.set("amount", String(amountMsat));
  callbackUrl.searchParams.set("nostr", JSON.stringify(zapRequestEvent));
  if (payRequestTarget.lnurl) callbackUrl.searchParams.set("lnurl", payRequestTarget.lnurl);

  const invoiceResponse = await fetch(callbackUrl.toString(), { cache: "no-store" });
  if (!invoiceResponse.ok) {
    throw new Error(`Lightning invoice allocation failed (${invoiceResponse.status}).`);
  }
  const invoicePayload = (await invoiceResponse.json().catch(() => null)) as Record<string, unknown> | null;
  if (asString(invoicePayload?.status).toUpperCase() === "ERROR") {
    throw new Error(asString(invoicePayload?.reason) || "Lightning invoice allocation failed.");
  }
  const invoice = asString(invoicePayload?.pr);
  if (!invoice || !isLightningInvoice(invoice)) {
    throw new Error("Lightning invoice allocation did not return a usable BOLT11 invoice.");
  }

  return {
    target: buildDefaultTarget(
      {
        version: 1,
        railId: "lightning",
        asset: "btc",
        destination: invoice,
        network: "lightning",
        label: baseTarget.label || "Lightning zap invoice",
        amount: baseTarget.amount ?? input.pkg.paymentAmount,
        amountAtomic: baseTarget.amountAtomic,
        reference: `zapreq:${asString((zapRequestEvent as { id?: unknown }).id).slice(0, 12)}`,
        metadata: {
          ...sanitizeMetadata(baseTarget.metadata),
          sourceKind: payRequestTarget.sourceKind
        }
      },
      input.sessionId
    ),
    metadata: {
      operatorMode: "built_in_lightning_zap_operator",
      lightningTargetKind: payRequestTarget.sourceKind,
      lightningPayRequestUrl: payRequestTarget.payRequestUrl,
      lightningZapRequestId: asString((zapRequestEvent as { id?: unknown }).id),
      lightningSessionTag: input.sessionId
    }
  };
}

async function syncLightningSession(session: PaymentOperatorSessionRecord): Promise<PaymentOperatorSessionStatusResponse> {
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) return { ok: false, error: "Video package not found for operator session." };
  if (session.metadata?.operatorMode !== "built_in_lightning_zap_operator") {
    return {
      ok: true,
      status: session.settlement ? "verified" : session.status,
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      settlement: session.settlement,
      error: session.error
    };
  }

  const relays = getNostrRelays();
  if (relays.length === 0) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error: "No Nostr relays are configured for Lightning settlement observation."
    };
  }

  const expectedATag = makeATag(pkg.hostPubkey, pkg.streamId);
  const expectedSessionTag = asString(session.metadata?.lightningSessionTag) || session.id;
  const sinceSec = Math.max(0, Math.floor(session.createdAtMs / 1000) - LIGHTNING_SEARCH_SLACK_SEC);
  const filter: Filter = {
    kinds: [NIP57_ZAP_RECEIPT_KIND],
    "#p": [pkg.hostPubkey],
    limit: 200,
    since: sinceSec
  };

  let receipts: Event[] = [];
  try {
    receipts = (await zapReceiptPool.querySync(relays, filter, { maxWait: 2500 })) as Event[];
  } catch {
    receipts = [];
  }

  const matchingReceipt = receipts
    .slice()
    .sort((left, right) => Number(right.created_at ?? 0) - Number(left.created_at ?? 0))
    .find((event) => {
      const receipt = parseZapReceiptEvent(event);
      if (!receipt?.request) return false;
      if (receipt.recipientPubkey !== pkg.hostPubkey) return false;
      if (receipt.request.pubkey !== session.viewerPubkey) return false;
      if (receipt.request.packageId !== pkg.id) return false;
      if (receipt.request.sessionId !== expectedSessionTag) return false;
      if (receipt.request.streamATag && receipt.request.streamATag !== expectedATag) return false;
      if (receipt.createdAt < sinceSec) return false;
      return true;
    });

  if (!matchingReceipt) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: {
        ...session.metadata,
        lightningRelaysObserved: relays
      }
    };
  }

  const verification = await verifyPurchaseSettlement({
    package: pkg,
    buyerPubkey: session.viewerPubkey,
    buyerProofEvent: null,
    settlementProof: {
      version: 1,
      railId: "lightning",
      asset: "btc",
      proofType: "nip57_zap_receipt",
      payload: { receiptEvent: matchingReceipt }
    },
    metadata: {
      paymentOperatorSessionId: session.id,
      paymentOperatorMode: session.metadata?.operatorMode ?? "built_in"
    }
  });

  if (!verification.supported) {
    return { ok: false, error: "Built-in operator cannot verify Lightning receipt settlement." };
  }
  if (!verification.verified || !verification.settlement) {
    return {
      ok: true,
      status: verification.status === 400 || verification.status === 403 ? "failed" : "pending_operator",
      proofMode: session.proofMode,
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: {
        ...session.metadata,
        lightningReceiptId: asString((matchingReceipt as { id?: unknown }).id) || undefined
      },
      error: verification.error ?? "Lightning receipt verification failed."
    };
  }

  const updated = updateSession(session.id, (current) => ({
    ...current,
    status: "verified",
    settlement: verification.settlement,
    error: undefined,
    updatedAtMs: nowMs(),
    metadata: {
      ...current.metadata,
      ...sanitizeMetadata(verification.metadata),
      lightningReceiptId: asString((matchingReceipt as { id?: unknown }).id) || undefined
    }
  }));
  return {
    ok: true,
    status: updated.status,
    proofMode: updated.proofMode,
    target: updated.target,
    expiresAtMs: updated.expiresAtMs,
    metadata: updated.metadata,
    settlement: updated.settlement
  };
}

async function syncXmrSession(session: PaymentOperatorSessionRecord): Promise<PaymentOperatorSessionStatusResponse> {
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) return { ok: false, error: "Video package not found for operator session." };
  const accountIndex = parsePositiveInt(session.metadata?.xmrAccountIndex);
  const addressIndex = parsePositiveInt(session.metadata?.xmrAddressIndex);
  if (accountIndex === undefined || addressIndex === undefined) {
    return { ok: false, error: "XMR operator session metadata is incomplete." };
  }
  const client = getXmrWalletRpcClient();
  if (!client) return { ok: false, error: "xmr wallet rpc not configured" };

  const match = await findLatestIncomingTip({
    client,
    accountIndex,
    addressIndex,
    confirmationsRequired: getXmrConfirmationsRequired()
  });
  if (!match || !match.confirmed) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: "operator_observed",
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: session.metadata,
      error: !match ? undefined : "Waiting for Monero confirmations."
    };
  }
  const requiredAmountAtomic = packageRequiredAmountAtomic(pkg);
  const observedAmountAtomic = parseDigitsBigInt(match.amountAtomic);
  if (requiredAmountAtomic === null || observedAmountAtomic === null) {
    return { ok: false, error: "XMR package amount is invalid." };
  }
  if (observedAmountAtomic < requiredAmountAtomic) {
    return {
      ok: true,
      status: "pending_operator",
      proofMode: "operator_observed",
      target: session.target,
      expiresAtMs: session.expiresAtMs,
      metadata: {
        ...session.metadata,
        observedAmountAtomic: observedAmountAtomic.toString(),
        requiredAmountAtomic: requiredAmountAtomic.toString(),
        observedConfirmations: match.confirmations,
        txRef: match.txid ?? null
      },
      error: "Observed Monero payment is below package price."
    };
  }

  const settlement = buildXmrSettlement({
    pkg,
    txRef: match.txid ?? undefined,
    amountAtomic: observedAmountAtomic,
    observedAtMs: match.observedAtMs,
    confirmations: match.confirmations,
    accountIndex,
    addressIndex,
    label: asString(session.metadata?.xmrLabel) || undefined
  });
  const updated = updateSession(session.id, (current) => ({
    ...current,
    status: "verified",
    settlement,
    error: undefined,
    updatedAtMs: nowMs(),
    metadata: {
      ...current.metadata,
      txRef: match.txid ?? null,
      observedAmountAtomic: observedAmountAtomic.toString(),
      observedConfirmations: match.confirmations
    }
  }));
  return {
    ok: true,
    status: updated.status,
    proofMode: updated.proofMode,
    target: updated.target,
    expiresAtMs: updated.expiresAtMs,
    metadata: updated.metadata,
    settlement: updated.settlement
  };
}

export async function createPaymentOperatorSession(input: PaymentOperatorSessionCreateRequest): Promise<PaymentOperatorSessionCreateResponse> {
  ensureLoaded();
  const sessionId = asString(input.sessionId);
  const viewerPubkey = asString(input.viewer?.pubkey).toLowerCase();
  if (!sessionId) return { ok: false, error: "sessionId is required." };
  if (!/^[a-f0-9]{64}$/.test(viewerPubkey)) return { ok: false, error: "viewer pubkey must be a 64-char hex pubkey." };
  const existing = findSession(sessionId);
  if (existing) {
    return {
      ok: true,
      status: existing.status,
      proofMode: existing.proofMode,
      target: existing.target,
      expiresAtMs: existing.expiresAtMs,
      metadata: existing.metadata,
      settlement: existing.settlement
    };
  }

  const pkg = resolveLocalPackage(input.package);
  if (!pkg) return { ok: false, error: "Video package not found for built-in payment operator." };
  const railId = resolveVideoPackageRailId(pkg);

  let target: PaymentSessionTarget | null = null;
  let metadata: Record<string, unknown> = {};
  if (railId === "xmr") {
    const client = getXmrWalletRpcClient();
    if (!client) return { ok: false, error: "xmr wallet rpc not configured" };
    const accountIndex = getXmrWalletRpcAccountIndex();
    const label = makeXmrPackageLabel({
      hostPubkey: pkg.hostPubkey,
      streamId: pkg.streamId,
      packageId: pkg.id,
      viewerPubkey,
      sessionId
    });
    const created = await client.createAddress({ accountIndex, label });
    target = buildDefaultTarget(
      {
        version: 1,
        railId: "xmr",
        asset: "xmr",
        destination: created.address,
        amount: pkg.paymentAmount,
        label: pkg.paymentTarget?.label || "Monero operator subaddress",
        reference: `subaddr:${accountIndex}:${created.addressIndex}`
      },
      sessionId
    );
    metadata = {
      xmrAccountIndex: accountIndex,
      xmrAddressIndex: created.addressIndex,
      xmrLabel: label,
      operatorMode: "built_in_xmr_wallet_rpc"
    };
  } else if (railId === "lightning") {
    try {
      const created = await createLightningSessionTarget({
        pkg,
        sessionId,
        viewerPubkey,
        metadata: sanitizeMetadata(input.metadata)
      });
      target = created.target;
      metadata = created.metadata;
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message ?? "Built-in Lightning operator could not allocate a session target."
      };
    }
  } else if (railId === "evm") {
    try {
      const created = allocateSessionAmountTarget({
        pkg,
        sessionId,
        operatorMode: "built_in_evm_amount_watch",
        referencePrefix: "wei+"
      });
      target = created.target;
      metadata = created.metadata;
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message ?? "Built-in EVM operator could not allocate a session target."
      };
    }
  } else if (railId === "solana") {
    try {
      const created = allocateSessionAmountTarget({
        pkg,
        sessionId,
        operatorMode: "built_in_solana_amount_watch",
        referencePrefix: "lamports+"
      });
      target = created.target;
      metadata = created.metadata;
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message ?? "Built-in Solana operator could not allocate a session target."
      };
    }
  } else if (railId === "tron") {
    try {
      const created = allocateSessionAmountTarget({
        pkg,
        sessionId,
        operatorMode: "built_in_tron_amount_watch",
        referencePrefix: "sun+"
      });
      target = created.target;
      metadata = created.metadata;
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message ?? "Built-in TRON operator could not allocate a session target."
      };
    }
  } else if (railId === "utxo") {
    try {
      const created = allocateSessionAmountTarget({
        pkg,
        sessionId,
        operatorMode: "built_in_utxo_amount_watch",
        referencePrefix: "amt"
      });
      target = created.target;
      metadata = created.metadata;
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message ?? "Built-in UTXO operator could not allocate a session target."
      };
    }
  } else if (railId === "xrpl") {
    try {
      if (!pkg.paymentTarget) throw new Error("XRPL package is missing a settlement target.");
      if (pkg.paymentTarget.reference) {
        const created = allocateSessionAmountTarget({
          pkg,
          sessionId,
          operatorMode: "built_in_xrpl_amount_watch",
          referencePrefix: "drops+"
        });
        target = created.target;
        metadata = created.metadata;
      } else {
        const reference = allocateXrplDestinationTag(sessionId, pkg.paymentTarget.destination);
        target = buildDefaultTarget(
          {
            ...pkg.paymentTarget,
            reference
          },
          sessionId
        );
        metadata = {
          operatorMode: "built_in_xrpl_destination_tag",
          xrplDestinationTag: reference
        };
      }
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message ?? "Built-in XRPL operator could not allocate a session target."
      };
    }
  } else if (railId === "cardano") {
    try {
      const created = allocateSessionAmountTarget({
        pkg,
        sessionId,
        operatorMode: "built_in_cardano_amount_watch",
        referencePrefix: "lovelace+"
      });
      target = created.target;
      metadata = created.metadata;
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message ?? "Built-in Cardano operator could not allocate a session target."
      };
    }
  } else if (pkg.paymentTarget) {
    target = buildDefaultTarget(pkg.paymentTarget, sessionId);
    metadata = {
      operatorMode: "built_in_static_target"
    };
  }

  if (!target) return { ok: false, error: "Built-in payment operator could not allocate a payment target for this package." };

  const session: PaymentOperatorSessionRecord = {
    version: 1,
    id: sessionId,
    packageId: pkg.id,
    hostPubkey: pkg.hostPubkey,
    streamId: pkg.streamId,
    viewerPubkey,
    railId,
    asset: pkg.paymentAsset,
    status: "pending_operator",
    proofMode: "operator_observed",
    target,
    createdAtMs: nowMs(),
    updatedAtMs: nowMs(),
    expiresAtMs: nowMs() + 20 * 60 * 1000,
    metadata
  };
  sessionsCache.push(session);
  persist();
  return {
    ok: true,
    status: session.status,
    proofMode: session.proofMode,
    operatorLabel: "Built-in host operator",
    target: session.target,
    expiresAtMs: session.expiresAtMs,
    metadata: session.metadata
  };
}

export async function getPaymentOperatorSessionStatus(input: PaymentOperatorSessionStatusRequest): Promise<PaymentOperatorSessionStatusResponse> {
  const session = findSession(asString(input.sessionId));
  if (!session) return { ok: false, error: "Operator payment session not found." };
  if (isExpired(session) && !session.settlement) {
    const updated = updateSession(session.id, (current) => ({
      ...current,
      status: "expired",
      error: "Payment session expired.",
      updatedAtMs: nowMs()
    }));
    return {
      ok: true,
      status: updated.status,
      proofMode: updated.proofMode,
      target: updated.target,
      expiresAtMs: updated.expiresAtMs,
      metadata: updated.metadata,
      error: updated.error
    };
  }
  if (session.railId === "xmr") return syncXmrSession(session);
  if (session.railId === "lightning") return syncLightningSession(session);
  if (session.railId === "evm") return syncEvmSession(session);
  if (session.railId === "solana") return syncSolanaSession(session);
  if (session.railId === "tron") return syncTronSession(session);
  if (session.railId === "utxo") return syncUtxoSession(session);
  if (session.railId === "xrpl") return syncXrplSession(session);
  if (session.railId === "cardano") return syncCardanoSession(session);
  return {
    ok: true,
    status: session.settlement ? "verified" : session.status,
    proofMode: session.proofMode,
    target: session.target,
    expiresAtMs: session.expiresAtMs,
    metadata: session.metadata,
    settlement: session.settlement,
    error: session.error
  };
}

export async function observePaymentOperatorSession(input: PaymentOperatorSessionObserveRequest): Promise<PaymentOperatorSessionObserveResponse> {
  const session = findSession(asString(input.sessionId));
  if (!session) return { ok: false, error: "Operator payment session not found." };
  if (session.railId === "xmr") return getPaymentOperatorSessionStatus(input);
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) return { ok: false, error: "Video package not found for operator session." };

  const verification = await verifyPurchaseSettlement({
    package: pkg,
    buyerPubkey: session.viewerPubkey,
    buyerProofEvent: null,
    paymentProof: sanitizeSettlementProof(input.paymentProof),
    settlementProof: sanitizeSettlementProof(input.settlementProof) ?? sanitizeSettlementProof(input.paymentProof),
    metadata: {
      paymentOperatorSessionId: session.id,
      paymentOperatorMode: session.metadata?.operatorMode ?? "built_in",
      ...sanitizeMetadata(input.metadata)
    }
  });

  if (!verification.supported) {
    const updated = updateSession(session.id, (current) => ({
      ...current,
      status: "failed",
      error: "Built-in operator cannot verify this rail yet.",
      updatedAtMs: nowMs()
    }));
    return {
      ok: false,
      error: updated.error || "Built-in operator cannot verify this rail yet.",
      status: updated.status,
      proofMode: updated.proofMode,
      metadata: updated.metadata
    };
  }

  if (!verification.verified || !verification.settlement) {
    const nextStatus = verification.status === 400 || verification.status === 403 ? "failed" : "pending_operator";
    const updated = updateSession(session.id, (current) => ({
      ...current,
      status: nextStatus,
      error: verification.error ?? "Verification failed.",
      updatedAtMs: nowMs(),
      metadata: {
        ...current.metadata,
        ...sanitizeMetadata(input.metadata)
      }
    }));
    return {
      ok: true,
      status: updated.status,
      proofMode: updated.proofMode,
      target: updated.target,
      expiresAtMs: updated.expiresAtMs,
      metadata: updated.metadata,
      error: updated.error
    };
  }

  const updated = updateSession(session.id, (current) => ({
    ...current,
    status: "verified",
    settlement: verification.settlement,
    error: undefined,
    updatedAtMs: nowMs(),
    metadata: {
      ...current.metadata,
      ...sanitizeMetadata(verification.metadata),
      ...sanitizeMetadata(input.metadata)
    }
  }));
  return {
    ok: true,
    status: updated.status,
    proofMode: updated.proofMode,
    target: updated.target,
    expiresAtMs: updated.expiresAtMs,
    metadata: updated.metadata,
    settlement: updated.settlement
  };
}
