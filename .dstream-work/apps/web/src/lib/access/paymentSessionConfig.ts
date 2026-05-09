import type { PaymentRailId, PaymentSessionProofMode } from "@dstream/protocol";
import { PAYMENT_RAIL_IDS } from "@dstream/protocol";
import type { VideoAccessPackage } from "./client";

export interface VideoPackagePaymentSessionConfig {
  enabled: boolean;
  transport: "embedded" | "http";
  authority: "node_operator" | "embedded_reference";
  operatorEndpoint?: string;
  operatorLabel?: string;
  proofMode?: PaymentSessionProofMode;
  expiresInSec?: number;
  allowManualFallback: boolean;
}

function envFlagEnabled(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return false;
  return value !== "0" && value !== "false" && value !== "no" && value !== "off";
}

function productionLikeRuntime(): boolean {
  const mode = (process.env.HARDEN_MODE ?? "").trim().toLowerCase();
  return process.env.NODE_ENV === "production" || mode === "prod" || mode === "production" || mode === "deploy" || mode === "external";
}

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function asObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function parsePositiveInt(input: unknown): number | undefined {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return Math.trunc(value);
}

function isLoopbackOperatorHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

export function assertPaymentOperatorEndpointAllowed(endpoint: string): void {
  const value = endpoint.trim();
  if (!value) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("paymentSession.operatorEndpoint must be an absolute http(s) URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("paymentSession.operatorEndpoint must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("paymentSession.operatorEndpoint must not embed credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("paymentSession.operatorEndpoint must not include a query string or hash.");
  }
  if (productionLikeRuntime() && parsed.protocol !== "https:" && !isLoopbackOperatorHost(parsed.hostname)) {
    throw new Error("Production paymentSession.operatorEndpoint values must use https.");
  }
}

export function resolveVideoPackageRailId(pkg: Pick<VideoAccessPackage, "paymentAsset" | "paymentRailId" | "paymentTarget">): PaymentRailId {
  const candidate = asString(pkg.paymentTarget?.railId ?? pkg.paymentRailId).toLowerCase();
  if (PAYMENT_RAIL_IDS.includes(candidate as PaymentRailId)) return candidate as PaymentRailId;
  switch (pkg.paymentAsset) {
    case "eth":
    case "usdt":
    case "usdc":
    case "pepe":
      return "evm";
    case "trx":
      return "tron";
    case "sol":
      return "solana";
    case "xrp":
      return "xrpl";
    case "ada":
      return "cardano";
    case "doge":
    case "bch":
    case "btc":
      return pkg.paymentTarget?.network === "lightning" ? "lightning" : "utxo";
    default:
      return "xmr";
  }
}

export function defaultPaymentSessionProofMode(railId: PaymentRailId): PaymentSessionProofMode {
  if (railId === "xmr") return "operator_observed";
  if (railId === "lightning") return "operator_observed";
  if (railId === "evm" || railId === "solana" || railId === "tron") return "client_tx_ref";
  if (railId === "utxo" || railId === "xrpl" || railId === "cardano") return "operator_observed";
  return "none";
}

export function readVideoPackagePaymentSessionConfig(pkg: Pick<VideoAccessPackage, "paymentAsset" | "paymentRailId" | "paymentTarget" | "metadata">): VideoPackagePaymentSessionConfig {
  const railId = resolveVideoPackageRailId(pkg);
  const metadataConfig =
    asObject(asObject(pkg.metadata)?.paymentSession) ??
    asObject(asObject(pkg.paymentTarget?.metadata)?.paymentSession) ??
    {};
  const operatorEndpoint = asString(metadataConfig.operatorEndpoint) || undefined;

  const enabledRaw = metadataConfig.enabled;
  const enabled =
    typeof enabledRaw === "boolean"
      ? enabledRaw
      : railId === "xmr" || !!operatorEndpoint || !!pkg.paymentTarget;
  const transport = operatorEndpoint ? "http" : "embedded";
  const authority = transport === "http" ? "node_operator" : "embedded_reference";
  const proofModeRaw = asString(metadataConfig.proofMode).toLowerCase();
  const proofMode =
    proofModeRaw === "none" ||
    proofModeRaw === "operator_observed" ||
    proofModeRaw === "client_tx_ref" ||
    proofModeRaw === "client_settlement_proof"
      ? (proofModeRaw as PaymentSessionProofMode)
      : operatorEndpoint
        ? "operator_observed"
        : defaultPaymentSessionProofMode(railId);

  return {
    enabled,
    transport,
    authority,
    operatorEndpoint,
    operatorLabel: asString(metadataConfig.operatorLabel) || undefined,
    proofMode,
    expiresInSec: parsePositiveInt(metadataConfig.expiresInSec) ?? 20 * 60,
    allowManualFallback:
      metadataConfig.allowManualFallback === false
        ? false
        : proofMode === "client_tx_ref" || proofMode === "client_settlement_proof"
  };
}

export function requiresNodeOperatorForVideoPackagePaymentSession(
  pkg: Pick<VideoAccessPackage, "paymentAsset" | "paymentRailId" | "paymentTarget">
): boolean {
  return resolveVideoPackageRailId(pkg) !== "xmr";
}

export function legacyVideoPackagePaymentFallbacksEnabled(): boolean {
  return envFlagEnabled(process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS);
}

export function canUseLegacyVideoPackagePaymentFallback(
  pkg: Pick<VideoAccessPackage, "paymentAsset" | "paymentRailId" | "paymentTarget" | "metadata">
): boolean {
  if (!requiresNodeOperatorForVideoPackagePaymentSession(pkg)) return false;
  if (!legacyVideoPackagePaymentFallbacksEnabled()) return false;
  const config = readVideoPackagePaymentSessionConfig(pkg);
  return config.allowManualFallback;
}

export function writeVideoPackagePaymentSessionConfig(input: {
  purchasePolicy?: string;
  existingMetadata?: Record<string, unknown>;
  sessionConfig: Partial<VideoPackagePaymentSessionConfig>;
}): Record<string, unknown> {
  const metadata = input.existingMetadata && typeof input.existingMetadata === "object" ? { ...input.existingMetadata } : {};
  if (input.purchasePolicy) metadata.purchasePolicy = input.purchasePolicy;

  const next: Record<string, unknown> = {};
  if (typeof input.sessionConfig.enabled === "boolean") next.enabled = input.sessionConfig.enabled;
  if (input.sessionConfig.operatorEndpoint) next.operatorEndpoint = input.sessionConfig.operatorEndpoint;
  if (input.sessionConfig.operatorLabel) next.operatorLabel = input.sessionConfig.operatorLabel;
  if (input.sessionConfig.proofMode) next.proofMode = input.sessionConfig.proofMode;
  if (input.sessionConfig.expiresInSec && input.sessionConfig.expiresInSec > 0) next.expiresInSec = input.sessionConfig.expiresInSec;
  if (typeof input.sessionConfig.allowManualFallback === "boolean") next.allowManualFallback = input.sessionConfig.allowManualFallback;

  metadata.paymentSession = next;
  return metadata;
}
