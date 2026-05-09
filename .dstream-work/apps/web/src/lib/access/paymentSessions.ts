import { randomUUID } from "node:crypto";
import type {
  PaymentOperatorSessionCreateRequest,
  PaymentOperatorSessionCreateResponse,
  PaymentOperatorSessionObserveRequest,
  PaymentOperatorSessionObserveResponse,
  PaymentRailId,
  PaymentSessionOperatorDescriptor,
  PaymentSessionProofMode,
  PaymentSessionRecord,
  PaymentSessionStatus,
  PaymentOperatorSessionStatusRequest,
  PaymentOperatorSessionStatusResponse,
  PaymentSessionTarget,
  PaymentSettlementProof,
  PaymentSettlementTarget,
  StreamPaymentAsset,
  VerifiedPaymentSettlement
} from "@dstream/protocol";
import { PAYMENT_RAIL_IDS, PAYMENT_SESSION_PROOF_MODES, PAYMENT_SESSION_STATUSES, STREAM_PAYMENT_ASSETS } from "@dstream/protocol";
import { buildPaymentUri } from "../payments/catalog";
import { buildCanonicalSettlementRef } from "../payments/settlement";
import { paymentSettlementTargetToMethod } from "../payments/targets";
import { formatUnits, parseAmountToUnits, PAYMENT_ASSET_DECIMALS } from "../payments/units";
import { readTextFileWithBackup, writeJsonFileAtomic } from "../storage/jsonFileStore";
import { getXmrConfirmationsRequired, getXmrWalletRpcAccountIndex, getXmrWalletRpcClient } from "../monero/server";
import { findLatestIncomingTip } from "../monero/tipVerify";
import {
  assertPaymentOperatorEndpointAllowed,
  canUseLegacyVideoPackagePaymentFallback,
  defaultPaymentSessionProofMode,
  requiresNodeOperatorForVideoPackagePaymentSession,
  readVideoPackagePaymentSessionConfig,
  resolveVideoPackageRailId
} from "./paymentSessionConfig";
import { getVideoAccessPackageById, grantVideoPackagePurchaseAccess, type VideoAccessPackage } from "./packages";
import { verifyPurchaseSettlement } from "./purchaseVerifier";

const STORE_PATH =
  (process.env.DSTREAM_VIDEO_PACKAGE_SESSION_STORE_PATH ?? "/var/lib/dstream/video-package-sessions.json").trim() ||
  "/var/lib/dstream/video-package-sessions.json";
const MAX_SESSIONS = 100000;

export interface CreateVideoPackagePaymentSessionInput {
  packageId: string;
  sessionId?: string;
  viewerPubkey: string;
  metadata?: Record<string, unknown>;
}

export interface ObserveVideoPackagePaymentSessionInput {
  sessionId: string;
  txRef?: string;
  settlementProof?: PaymentSettlementProof | Record<string, unknown> | null;
  paymentProof?: PaymentSettlementProof | Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

interface SessionStoreShape {
  version: 1;
  updatedAtMs: number;
  sessions: PaymentSessionRecord[];
}

interface SessionAdapterCreateResult {
  operator: PaymentSessionOperatorDescriptor;
  proofMode?: PaymentSessionProofMode;
  status?: PaymentSessionStatus;
  target: PaymentSessionTarget;
  expiresAtMs?: number;
  metadata?: Record<string, unknown>;
  settlement?: VerifiedPaymentSettlement;
  error?: string;
}

interface SessionAdapterUpdateResult {
  proofMode?: PaymentSessionProofMode;
  status?: PaymentSessionStatus;
  target?: PaymentSessionTarget;
  expiresAtMs?: number;
  metadata?: Record<string, unknown>;
  settlement?: VerifiedPaymentSettlement;
  error?: string;
}

let loaded = false;
let sessionsCache: PaymentSessionRecord[] = [];

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

function isValidSessionId(input: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(input);
}

function formatSettlementAmount(asset: VideoAccessPackage["paymentAsset"], amountAtomic: bigint): string {
  return formatUnits(amountAtomic, PAYMENT_ASSET_DECIMALS[asset] ?? 8);
}

function packageRequiredAmountAtomic(pkg: VideoAccessPackage): bigint | null {
  return parseAmountToUnits(pkg.paymentAmount, PAYMENT_ASSET_DECIMALS[pkg.paymentAsset] ?? 8);
}

function getXmrSessionAccountIndex(session: Pick<PaymentSessionRecord, "metadata">): number | undefined {
  return parsePositiveInt(session.metadata?.xmrAccountIndex);
}

function getXmrSessionAddressIndex(session: Pick<PaymentSessionRecord, "metadata">): number | undefined {
  return parsePositiveInt(session.metadata?.xmrAddressIndex);
}

function makeXmrPackageLabel(session: {
  hostPubkey: string;
  streamId: string;
  packageId: string;
  viewerPubkey: string;
  sessionId: string;
}): string {
  return [
    "dstream_pkg",
    session.hostPubkey.slice(0, 16),
    session.streamId,
    session.packageId.slice(0, 12),
    session.viewerPubkey.slice(0, 12),
    session.sessionId.slice(0, 12)
  ].join(":");
}

function buildXmrVerifiedSettlement(input: {
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
    amount: formatSettlementAmount(input.pkg.paymentAsset, input.amountAtomic),
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

function sanitizeStatus(input: unknown): PaymentSessionStatus {
  const value = asString(input).toLowerCase();
  return PAYMENT_SESSION_STATUSES.includes(value as PaymentSessionStatus) ? (value as PaymentSessionStatus) : "created";
}

function sanitizeProofMode(input: unknown): PaymentSessionProofMode {
  const value = asString(input).toLowerCase();
  return PAYMENT_SESSION_PROOF_MODES.includes(value as PaymentSessionProofMode)
    ? (value as PaymentSessionProofMode)
    : "none";
}

function optionalStatus(input: unknown): PaymentSessionStatus | undefined {
  const value = asString(input).toLowerCase();
  return PAYMENT_SESSION_STATUSES.includes(value as PaymentSessionStatus) ? (value as PaymentSessionStatus) : undefined;
}

function optionalProofMode(input: unknown): PaymentSessionProofMode | undefined {
  const value = asString(input).toLowerCase();
  return PAYMENT_SESSION_PROOF_MODES.includes(value as PaymentSessionProofMode)
    ? (value as PaymentSessionProofMode)
    : undefined;
}

function sanitizePaymentSessionTarget(input: unknown): PaymentSessionTarget | null {
  const row = asObject(input);
  if (!row) return null;
  const destination = asString(row.destination);
  if (!destination) return null;
  return {
    version: 1,
    railId: asString(row.railId) as PaymentSessionTarget["railId"],
    asset: asString(row.asset) as PaymentSessionTarget["asset"],
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

function sanitizePaymentSettlementProof(input: unknown): PaymentSettlementProof | undefined {
  const row = asObject(input);
  if (!row) return undefined;
  const railId = asString(row.railId).toLowerCase();
  const asset = asString(row.asset).toLowerCase();
  const proofType = asString(row.proofType);
  if (Number(row.version) !== 1) return undefined;
  if (!PAYMENT_RAIL_IDS.includes(railId as PaymentRailId)) return undefined;
  if (!STREAM_PAYMENT_ASSETS.includes(asset as StreamPaymentAsset)) return undefined;
  if (!proofType) return undefined;
  const payload = asObject(row.payload);
  const metadata = asObject(row.metadata);
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
    payload: payload ? sanitizeMetadata(payload) : undefined,
    metadata: metadata ? sanitizeMetadata(metadata) : undefined
  };
}

function sanitizeOperatorDescriptor(input: unknown): PaymentSessionOperatorDescriptor {
  const row = asObject(input) ?? {};
  return {
    authority: asString(row.authority) === "node_operator" ? "node_operator" : "embedded_reference",
    transport: asString(row.transport) === "http" ? "http" : "embedded",
    label: asString(row.label) || undefined,
    endpoint: asString(row.endpoint) || undefined
  };
}

function sanitizeSessionRecord(input: unknown): PaymentSessionRecord | null {
  const row = asObject(input);
  if (!row) return null;
  const id = asString(row.id);
  const packageId = asString(row.packageId);
  const hostPubkey = asString(row.hostPubkey);
  const streamId = asString(row.streamId);
  const viewerPubkey = asString(row.viewerPubkey);
  const railId = asString(row.railId) as PaymentSessionRecord["railId"];
  const asset = asString(row.asset) as PaymentSessionRecord["asset"];
  const target = sanitizePaymentSessionTarget(row.target);
  if (!id || !packageId || !hostPubkey || !streamId || !viewerPubkey || !railId || !asset || !target) return null;
  return {
    version: 1,
    id,
    packageId,
    hostPubkey,
    streamId,
    viewerPubkey,
    railId,
    asset,
    status: sanitizeStatus(row.status),
    proofMode: sanitizeProofMode(row.proofMode),
    operator: sanitizeOperatorDescriptor(row.operator),
    target,
    createdAtMs: Number(row.createdAtMs) || nowMs(),
    updatedAtMs: Number(row.updatedAtMs) || nowMs(),
    expiresAtMs: Number.isFinite(Number(row.expiresAtMs)) ? Number(row.expiresAtMs) : undefined,
    sourceRef: asString(row.sourceRef) || undefined,
    settlement: (row.settlement as VerifiedPaymentSettlement | undefined) ?? undefined,
    entitlementId: asString(row.entitlementId) || undefined,
    purchaseId: asString(row.purchaseId) || undefined,
    error: asString(row.error) || undefined,
    metadata: sanitizeMetadata(row.metadata)
  };
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = readTextFileWithBackup(STORE_PATH);
    if (!raw) throw new Error("no store");
    const parsed = JSON.parse(raw) as Partial<SessionStoreShape> | null;
    const sessionRows = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    sessionsCache = sessionRows.map(sanitizeSessionRecord).filter((row): row is PaymentSessionRecord => !!row);
  } catch {
    sessionsCache = [];
  }
}

function persist(): void {
  writeJsonFileAtomic(STORE_PATH, {
    version: 1,
    updatedAtMs: nowMs(),
    sessions: sessionsCache
  } satisfies SessionStoreShape);
}

function cloneSession(session: PaymentSessionRecord): PaymentSessionRecord {
  return JSON.parse(JSON.stringify(session)) as PaymentSessionRecord;
}

function isFinalStatus(status: PaymentSessionStatus): boolean {
  return status === "granted" || status === "expired" || status === "failed" || status === "cancelled";
}

function isExpired(session: PaymentSessionRecord): boolean {
  return typeof session.expiresAtMs === "number" && session.expiresAtMs <= nowMs();
}

function sessionSort(left: PaymentSessionRecord, right: PaymentSessionRecord): number {
  return right.updatedAtMs - left.updatedAtMs;
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

function buildTxRefProof(session: PaymentSessionRecord, pkg: VideoAccessPackage, txRef: string): PaymentSettlementProof {
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

function findSessionIndex(sessionId: string): number {
  return sessionsCache.findIndex((row) => row.id === sessionId);
}

function findReusableSession(packageId: string, viewerPubkey: string): PaymentSessionRecord | null {
  const existing = sessionsCache
    .filter((row) => row.packageId === packageId && row.viewerPubkey === viewerPubkey)
    .sort(sessionSort)
    .find((row) => !isFinalStatus(row.status) && !isExpired(row));
  return existing ? cloneSession(existing) : null;
}

function updateSession(sessionId: string, updater: (current: PaymentSessionRecord) => PaymentSessionRecord): PaymentSessionRecord {
  ensureLoaded();
  const index = findSessionIndex(sessionId);
  if (index < 0) throw new Error("Payment session not found.");
  const next = updater(cloneSession(sessionsCache[index]!));
  sessionsCache[index] = next;
  sessionsCache = sessionsCache.sort(sessionSort).slice(0, MAX_SESSIONS);
  persist();
  return cloneSession(next);
}

function insertSession(session: PaymentSessionRecord): PaymentSessionRecord {
  ensureLoaded();
  sessionsCache.push(session);
  sessionsCache = sessionsCache.sort(sessionSort).slice(0, MAX_SESSIONS);
  persist();
  return cloneSession(session);
}

function mergeSessionUpdate(current: PaymentSessionRecord, update: SessionAdapterUpdateResult): PaymentSessionRecord {
  const next = cloneSession(current);
  if (update.status) next.status = update.status;
  if (update.proofMode) next.proofMode = update.proofMode;
  if (update.target) next.target = update.target;
  if (typeof update.expiresAtMs === "number") next.expiresAtMs = update.expiresAtMs;
  if (update.settlement) next.settlement = update.settlement;
  if (typeof update.error === "string") next.error = update.error;
  next.metadata = { ...next.metadata, ...sanitizeMetadata(update.metadata) };
  next.updatedAtMs = nowMs();
  if (!next.status) next.status = "awaiting_payment";
  return next;
}

function operatorHeaders(): Record<string, string> {
  const token = (process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN ?? "").trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function operatorBaseUrl(endpoint: string): string {
  assertPaymentOperatorEndpointAllowed(endpoint);
  return endpoint.replace(/\/+$/, "");
}

async function createRemoteSession(
  endpoint: string,
  pkg: VideoAccessPackage,
  viewerPubkey: string,
  sessionId: string,
  metadata: Record<string, unknown>
): Promise<SessionAdapterCreateResult> {
  const requestBody: PaymentOperatorSessionCreateRequest = {
    version: 1,
    sessionId,
    package: {
      id: pkg.id,
      hostPubkey: pkg.hostPubkey,
      streamId: pkg.streamId,
      paymentAsset: pkg.paymentAsset,
      paymentAmount: pkg.paymentAmount,
      paymentRailId: resolveVideoPackageRailId(pkg),
      paymentTarget: pkg.paymentTarget
    },
    viewer: { pubkey: viewerPubkey },
    metadata
  };
  const response = await fetch(`${operatorBaseUrl(endpoint)}/sessions/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...operatorHeaders()
    },
    body: JSON.stringify(requestBody)
  });
  const body = (await response.json().catch(() => null)) as PaymentOperatorSessionCreateResponse | null;
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `node operator create failed (${response.status})`);
  }
  const target = sanitizePaymentSessionTarget(body?.target);
  if (!target) throw new Error("node operator did not return a usable payment session target");
  return {
    operator: {
      authority: "node_operator",
      transport: "http",
      endpoint,
      label: asString(body?.operatorLabel) || undefined
    },
    proofMode: optionalProofMode(body?.proofMode),
    status: optionalStatus(body?.status),
    target,
    expiresAtMs: Number.isFinite(Number(body?.expiresAtMs)) ? Number(body?.expiresAtMs) : undefined,
    metadata: sanitizeMetadata(body?.metadata),
    settlement: (body?.settlement as VerifiedPaymentSettlement | undefined) ?? undefined
  };
}

async function syncRemoteSession(session: PaymentSessionRecord): Promise<SessionAdapterUpdateResult> {
  const endpoint = session.operator.endpoint;
  if (!endpoint) return { status: session.status };
  const requestBody: PaymentOperatorSessionStatusRequest = {
    version: 1,
    sessionId: session.id,
    packageId: session.packageId,
    viewerPubkey: session.viewerPubkey
  };
  const response = await fetch(`${operatorBaseUrl(endpoint)}/sessions/status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...operatorHeaders()
    },
    body: JSON.stringify(requestBody)
  });
  const body = (await response.json().catch(() => null)) as PaymentOperatorSessionStatusResponse | null;
  if (!response.ok || body?.ok === false) {
    return {
      status: "failed",
      error: body?.error || `node operator status failed (${response.status})`
    };
  }
  return {
    proofMode: optionalProofMode(body?.proofMode),
    status: optionalStatus(body?.status),
    target: sanitizePaymentSessionTarget(body?.target) ?? undefined,
    expiresAtMs: Number.isFinite(Number(body?.expiresAtMs)) ? Number(body?.expiresAtMs) : undefined,
    metadata: sanitizeMetadata(body?.metadata),
    settlement: (body?.settlement as VerifiedPaymentSettlement | undefined) ?? undefined,
    error: asString(body?.error) || undefined
  };
}

async function observeRemoteSession(
  session: PaymentSessionRecord,
  input: ObserveVideoPackagePaymentSessionInput
): Promise<SessionAdapterUpdateResult> {
  const endpoint = session.operator.endpoint;
  if (!endpoint) return { status: session.status };
  const requestBody: PaymentOperatorSessionObserveRequest = {
    version: 1,
    sessionId: session.id,
    packageId: session.packageId,
    viewerPubkey: session.viewerPubkey,
    txRef: input.txRef,
    settlementProof: sanitizePaymentSettlementProof(input.settlementProof) ?? sanitizePaymentSettlementProof(input.paymentProof),
    paymentProof: sanitizePaymentSettlementProof(input.paymentProof),
    metadata: sanitizeMetadata(input.metadata)
  };
  const response = await fetch(`${operatorBaseUrl(endpoint)}/sessions/observe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...operatorHeaders()
    },
    body: JSON.stringify(requestBody)
  });
  const body = (await response.json().catch(() => null)) as PaymentOperatorSessionObserveResponse | null;
  if (!response.ok || body?.ok === false) {
    return {
      status: "failed",
      error: body?.error || `node operator observe failed (${response.status})`
    };
  }
  return {
    proofMode: optionalProofMode(body?.proofMode),
    status: optionalStatus(body?.status),
    target: sanitizePaymentSessionTarget(body?.target) ?? undefined,
    expiresAtMs: Number.isFinite(Number(body?.expiresAtMs)) ? Number(body?.expiresAtMs) : undefined,
    metadata: sanitizeMetadata(body?.metadata),
    settlement: (body?.settlement as VerifiedPaymentSettlement | undefined) ?? undefined,
    error: asString(body?.error) || undefined
  };
}

async function createEmbeddedXmrSession(
  pkg: VideoAccessPackage,
  sessionId: string,
  viewerPubkey: string
): Promise<SessionAdapterCreateResult> {
  const client = getXmrWalletRpcClient();
  if (!client) throw new Error("xmr wallet rpc not configured");
  const accountIndex = getXmrWalletRpcAccountIndex();
  const label = makeXmrPackageLabel({
    hostPubkey: pkg.hostPubkey,
    streamId: pkg.streamId,
    packageId: pkg.id,
    viewerPubkey,
    sessionId
  });
  const created = await client.createAddress({ accountIndex, label });
  const target = buildDefaultTarget(
    {
      version: 1,
      railId: "xmr",
      asset: "xmr",
      destination: created.address,
      amount: pkg.paymentAmount,
      amountAtomic: pkg.paymentTarget?.amountAtomic,
      label: pkg.paymentTarget?.label || "Monero package subaddress",
      reference: `subaddr:${accountIndex}:${created.addressIndex}`,
      metadata: {
        paymentSession: {
          sessionId,
          authority: "embedded_xmr_wallet_rpc"
        }
      }
    },
    sessionId
  );

  return {
    operator: {
      authority: "embedded_reference",
      transport: "embedded",
      label: "Embedded XMR wallet operator"
    },
    proofMode: "operator_observed",
    status: "pending_operator",
    target,
    expiresAtMs: nowMs() + 20 * 60 * 1000,
    metadata: {
      operatorMode: "embedded_xmr_wallet_rpc",
      xmrAccountIndex: accountIndex,
      xmrAddressIndex: created.addressIndex,
      xmrLabel: label
    }
  };
}

async function syncEmbeddedXmrSession(session: PaymentSessionRecord): Promise<SessionAdapterUpdateResult> {
  if (isExpired(session)) return { status: "expired", error: "Payment session expired." };
  const accountIndex = getXmrSessionAccountIndex(session);
  const addressIndex = getXmrSessionAddressIndex(session);
  if (accountIndex === undefined || addressIndex === undefined) {
    return {
      status: "failed",
      error: "XMR payment session metadata is incomplete."
    };
  }
  const client = getXmrWalletRpcClient();
  if (!client) {
    return {
      status: "failed",
      error: "xmr wallet rpc not configured"
    };
  }
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) {
    return {
      status: "failed",
      error: "Video package not found for this payment session."
    };
  }

  const match = await findLatestIncomingTip({
    client,
    accountIndex,
    addressIndex,
    confirmationsRequired: getXmrConfirmationsRequired()
  });

  if (!match) {
    return {
      status: "pending_operator",
      metadata: {
        xmrAccountIndex: accountIndex,
        xmrAddressIndex: addressIndex
      }
    };
  }

  if (!match.confirmed) {
    return {
      status: "pending_operator",
      error: "Waiting for Monero confirmations.",
      metadata: {
        xmrAccountIndex: accountIndex,
        xmrAddressIndex: addressIndex,
        txRef: match.txid ?? null,
        observedAmountAtomic: match.amountAtomic,
        observedConfirmations: match.confirmations
      }
    };
  }

  const requiredAmountAtomic = packageRequiredAmountAtomic(pkg);
  const observedAmountAtomic = parseDigitsBigInt(match.amountAtomic);
  if (requiredAmountAtomic === null || observedAmountAtomic === null) {
    return {
      status: "failed",
      error: "XMR package amount is invalid."
    };
  }
  if (observedAmountAtomic < requiredAmountAtomic) {
    return {
      status: "pending_operator",
      error: "Observed Monero payment is below package price.",
      metadata: {
        xmrAccountIndex: accountIndex,
        xmrAddressIndex: addressIndex,
        txRef: match.txid ?? null,
        observedAmountAtomic: observedAmountAtomic.toString(),
        requiredAmountAtomic: requiredAmountAtomic.toString(),
        observedConfirmations: match.confirmations
      }
    };
  }

  return {
    status: "verified",
    settlement: buildXmrVerifiedSettlement({
      pkg,
      txRef: match.txid,
      amountAtomic: observedAmountAtomic,
      observedAtMs: match.observedAtMs,
      confirmations: match.confirmations,
      accountIndex,
      addressIndex,
      label: asString(session.metadata?.xmrLabel) || undefined
    }),
    metadata: {
      xmrAccountIndex: accountIndex,
      xmrAddressIndex: addressIndex,
      txRef: match.txid ?? null,
      observedAmountAtomic: observedAmountAtomic.toString(),
      requiredAmountAtomic: requiredAmountAtomic.toString(),
      observedConfirmations: match.confirmations
    }
  };
}

function createEmbeddedSession(pkg: VideoAccessPackage, sessionId: string): SessionAdapterCreateResult {
  if (!pkg.paymentTarget) throw new Error("This package does not have a verified settlement target.");
  const config = readVideoPackagePaymentSessionConfig(pkg);
  const proofMode = config.proofMode ?? defaultPaymentSessionProofMode(resolveVideoPackageRailId(pkg));
  const target = buildDefaultTarget(pkg.paymentTarget, sessionId);
  return {
    operator: {
      authority: "embedded_reference",
      transport: "embedded",
      label: "Embedded reference operator"
    },
    proofMode,
    status: proofMode === "operator_observed" ? "pending_operator" : "awaiting_payment",
    target,
    expiresAtMs: nowMs() + (config.expiresInSec ?? 20 * 60) * 1000,
    metadata: {
      operatorMode: "embedded_reference"
    }
  };
}

async function syncEmbeddedSession(session: PaymentSessionRecord): Promise<SessionAdapterUpdateResult> {
  if (isExpired(session)) return { status: "expired", error: "Payment session expired." };
  if (session.railId === "xmr") return syncEmbeddedXmrSession(session);
  return { status: session.status };
}

async function observeEmbeddedSession(
  session: PaymentSessionRecord,
  input: ObserveVideoPackagePaymentSessionInput
): Promise<SessionAdapterUpdateResult> {
  if (isExpired(session)) return { status: "expired", error: "Payment session expired." };
  if (session.railId === "xmr") return syncEmbeddedXmrSession(session);
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) return { status: "failed", error: "Video package not found for this payment session." };

  const txRef = asString(input.txRef);
  const settlementProof =
    input.settlementProof ??
    input.paymentProof ??
    (txRef ? buildTxRefProof(session, pkg, txRef) : null);

  if (!settlementProof) {
    return {
      status: session.status,
      error:
        session.proofMode === "client_settlement_proof"
          ? "This payment session still needs a settlement proof."
          : "This payment session still needs a transaction reference."
    };
  }

  const verification = await verifyPurchaseSettlement({
    package: pkg,
    buyerPubkey: session.viewerPubkey,
    buyerProofEvent: undefined,
    settlementProof,
    paymentProof: input.paymentProof ?? undefined,
    metadata: {
      paymentSessionId: session.id,
      paymentSessionOperator: session.operator.authority,
      ...sanitizeMetadata(input.metadata)
    }
  });

  if (!verification.supported) {
    return {
      status: "failed",
      error: "The embedded reference operator cannot verify this session yet."
    };
  }

  if (!verification.verified || !verification.settlement) {
    return {
      status: "awaiting_payment",
      error: verification.error ?? "Verification failed."
    };
  }

  return {
    status: "verified",
    settlement: verification.settlement,
    metadata: verification.metadata
  };
}

function getAdapterTransport(pkg: VideoAccessPackage): "embedded" | "http" {
  const config = readVideoPackagePaymentSessionConfig(pkg);
  return config.transport;
}

async function adapterCreateSession(
  pkg: VideoAccessPackage,
  viewerPubkey: string,
  sessionId: string,
  metadata: Record<string, unknown>
): Promise<SessionAdapterCreateResult> {
  const config = readVideoPackagePaymentSessionConfig(pkg);
  if (config.transport === "http" && config.operatorEndpoint) {
    return createRemoteSession(config.operatorEndpoint, pkg, viewerPubkey, sessionId, metadata);
  }
  if (resolveVideoPackageRailId(pkg) === "xmr") {
    return createEmbeddedXmrSession(pkg, sessionId, viewerPubkey);
  }
  return createEmbeddedSession(pkg, sessionId);
}

async function adapterSyncSession(session: PaymentSessionRecord): Promise<SessionAdapterUpdateResult> {
  if (session.operator.transport === "http") return syncRemoteSession(session);
  return syncEmbeddedSession(session);
}

async function adapterObserveSession(
  session: PaymentSessionRecord,
  input: ObserveVideoPackagePaymentSessionInput
): Promise<SessionAdapterUpdateResult> {
  if (session.operator.transport === "http") return observeRemoteSession(session, input);
  return observeEmbeddedSession(session, input);
}

async function finalizeVerifiedSession(
  session: PaymentSessionRecord,
  settlement: VerifiedPaymentSettlement,
  metadata?: Record<string, unknown>
): Promise<PaymentSessionRecord> {
  const pkg = getVideoAccessPackageById(session.packageId);
  if (!pkg) throw new Error("Video package not found for this payment session.");
  const grant = grantVideoPackagePurchaseAccess({
    packageId: session.packageId,
    viewerPubkey: session.viewerPubkey,
    source: "purchase_verified",
    settlementRef: settlement.settlementRef,
    verifiedSettlement: settlement,
    metadata: {
      ...(session.metadata ?? {}),
      paymentSessionId: session.id,
      paymentSessionStatus: "granted",
      paymentSessionAuthority: session.operator.authority,
      ...sanitizeMetadata(metadata)
    }
  });

  return updateSession(session.id, (current) => ({
    ...current,
    status: "granted",
    settlement,
    sourceRef: grant.purchase.sourceRef,
    entitlementId: grant.entitlement.id,
    purchaseId: grant.purchase.id,
    error: undefined,
    metadata: {
      ...current.metadata,
      ...(metadata ?? {}),
      grantedPurchaseStatus: grant.purchase.status
    },
    updatedAtMs: nowMs()
  }));
}

export function getVideoPackagePaymentSession(sessionId: string): PaymentSessionRecord | null {
  ensureLoaded();
  const found = sessionsCache.find((row) => row.id === sessionId);
  return found ? cloneSession(found) : null;
}

export async function createVideoPackagePaymentSession(input: CreateVideoPackagePaymentSessionInput): Promise<PaymentSessionRecord> {
  ensureLoaded();
  const packageId = asString(input.packageId);
  const requestedSessionId = asString(input.sessionId);
  const viewerPubkey = asString(input.viewerPubkey).toLowerCase();
  if (!packageId) throw new Error("packageId is required.");
  if (requestedSessionId && !isValidSessionId(requestedSessionId)) {
    throw new Error("payment session id must be URL-safe and at most 128 characters.");
  }
  if (!/^[a-f0-9]{64}$/.test(viewerPubkey)) throw new Error("viewerPubkey must be a 64-char hex pubkey.");

  if (requestedSessionId) {
    const existingById = findSessionIndex(requestedSessionId);
    if (existingById >= 0) return cloneSession(sessionsCache[existingById]!);
  }

  const reusable = findReusableSession(packageId, viewerPubkey);
  if (reusable) return reusable;

  const pkg = getVideoAccessPackageById(packageId);
  if (!pkg) throw new Error("Video package not found.");
  const railId = resolveVideoPackageRailId(pkg);
  const config = readVideoPackagePaymentSessionConfig(pkg);
  if (!config.enabled) throw new Error("This package does not have payment sessions enabled.");
  if (requiresNodeOperatorForVideoPackagePaymentSession(pkg) && config.transport !== "http" && !canUseLegacyVideoPackagePaymentFallback(pkg)) {
    throw new Error("This non-XMR package must use a node-operator payment session. Configure paymentSession.operatorEndpoint or explicitly enable legacy fallback in dev.");
  }
  if (config.transport === "http" && !config.operatorEndpoint) {
    throw new Error("This package requires a node-operator endpoint before sessions can be created.");
  }
  const requiresEmbeddedTarget = railId !== "xmr" && config.transport !== "http";
  if (requiresEmbeddedTarget && !pkg.paymentTarget) {
    throw new Error("This package does not have a verified settlement target.");
  }

  const sessionId = requestedSessionId || randomUUID();
  const created = await adapterCreateSession(pkg, viewerPubkey, sessionId, sanitizeMetadata(input.metadata));
  const baseRecord: PaymentSessionRecord = {
    version: 1,
    id: sessionId,
    packageId: pkg.id,
    hostPubkey: pkg.hostPubkey,
    streamId: pkg.streamId,
    viewerPubkey,
    railId,
    asset: pkg.paymentAsset,
    status: created.status ?? "created",
    proofMode: created.proofMode ?? config.proofMode ?? defaultPaymentSessionProofMode(railId),
    operator: created.operator,
    target: created.target,
    createdAtMs: nowMs(),
    updatedAtMs: nowMs(),
    expiresAtMs: created.expiresAtMs ?? nowMs() + (config.expiresInSec ?? 20 * 60) * 1000,
    metadata: {
      packageTitle: pkg.title,
      operatorTransport: getAdapterTransport(pkg),
      ...sanitizeMetadata(input.metadata),
      ...sanitizeMetadata(created.metadata)
    }
  };
  const stored = insertSession(baseRecord);
  if (created.settlement) {
    return finalizeVerifiedSession(stored, created.settlement, created.metadata);
  }
  return stored;
}

export async function syncVideoPackagePaymentSession(sessionId: string): Promise<PaymentSessionRecord> {
  const current = getVideoPackagePaymentSession(sessionId);
  if (!current) throw new Error("Payment session not found.");
  if (isFinalStatus(current.status)) return current;
  if (isExpired(current)) {
    return updateSession(current.id, (row) => ({
      ...row,
      status: "expired",
      error: "Payment session expired.",
      updatedAtMs: nowMs()
    }));
  }
  const update = await adapterSyncSession(current);
  const merged = updateSession(current.id, (row) => mergeSessionUpdate(row, update));
  if (update.settlement) {
    return finalizeVerifiedSession(merged, update.settlement, update.metadata);
  }
  return merged;
}

export async function observeVideoPackagePaymentSession(input: ObserveVideoPackagePaymentSessionInput): Promise<PaymentSessionRecord> {
  const sessionId = asString(input.sessionId);
  if (!sessionId) throw new Error("sessionId is required.");
  const current = getVideoPackagePaymentSession(sessionId);
  if (!current) throw new Error("Payment session not found.");
  if (isFinalStatus(current.status)) return current;

  const update = await adapterObserveSession(current, input);
  const merged = updateSession(current.id, (row) => mergeSessionUpdate(row, update));
  if (update.settlement) {
    return finalizeVerifiedSession(merged, update.settlement, update.metadata);
  }
  return syncVideoPackagePaymentSession(merged.id);
}
