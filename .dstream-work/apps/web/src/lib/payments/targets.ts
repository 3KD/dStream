import type {
  PaymentRailId,
  PaymentSessionTarget,
  PaymentSettlementTarget,
  StreamPaymentAsset,
  StreamPaymentMethod
} from "@dstream/protocol";
import { PAYMENT_RAIL_IDS } from "@dstream/protocol";
import { PAYMENT_ASSET_META } from "./catalog";
import { getPaymentRailForAsset, getPaymentRailForMethod } from "./rails";
import { normalizePaymentAddress, validatePaymentAddress } from "./methods";
import { PAYMENT_ASSET_DECIMALS, parseAmountToUnits } from "./units";

const NETWORK_RE = /^[a-z0-9._-]{2,40}$/i;
const LIGHTNING_INVOICE_RE = /^(lnbc|lntb|lnbcrt|lnsb|lntbs)[0-9a-z]+$/i;

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function sanitizeText(input: unknown, maxLen: number): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value) return undefined;
  return value.slice(0, maxLen);
}

function sanitizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  try {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resolveRailId(input: unknown, asset: StreamPaymentAsset): PaymentRailId {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (PAYMENT_RAIL_IDS.includes(value as PaymentRailId)) {
    return value as PaymentRailId;
  }
  return getPaymentRailForAsset(asset).id;
}

function normalizeNetwork(input: unknown, asset: StreamPaymentAsset): string | undefined {
  const value = typeof input === "string" ? input.trim() : "";
  if (value) {
    if (!NETWORK_RE.test(value)) return undefined;
    return value.toLowerCase();
  }
  return PAYMENT_ASSET_META[asset]?.defaultNetwork;
}

function normalizeAtomic(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return raw.replace(/^0+(?=\d)/, "");
}

function normalizeDestination(
  asset: StreamPaymentAsset,
  railId: PaymentRailId,
  destinationRaw: unknown,
  network: string | undefined
): string | null {
  const destinationInput = typeof destinationRaw === "string" ? destinationRaw.trim() : "";
  if (!destinationInput) return null;
  const destination = normalizePaymentAddress(asset, destinationInput, railId === "lightning" ? "lightning" : network);
  const validationNetwork = railId === "lightning" ? "lightning" : network;
  const validationError = validatePaymentAddress(asset, destination, validationNetwork);
  if (validationError) return null;
  if (railId === "lightning" && LIGHTNING_INVOICE_RE.test(destination)) return null;
  return destination;
}

export function normalizePaymentSettlementTarget(
  input: unknown,
  defaults?: {
    railId?: PaymentRailId;
    asset?: StreamPaymentAsset;
    amount?: string;
    network?: string;
    recipientPubkey?: string;
  }
): PaymentSettlementTarget | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Partial<PaymentSettlementTarget>;
  const asset = row.asset ?? defaults?.asset;
  if (!asset) return null;
  const railId = defaults?.railId ?? resolveRailId(row.railId, asset);
  const network = normalizeNetwork(row.network ?? defaults?.network, asset);
  const destination = normalizeDestination(asset, railId, row.destination, network);
  if (!destination) return null;

  const amount =
    sanitizeText(row.amount, 80) ??
    sanitizeText(defaults?.amount, 80);
  const amountAtomic =
    normalizeAtomic(row.amountAtomic) ??
    (amount ? String(parseAmountToUnits(amount, PAYMENT_ASSET_DECIMALS[asset]) ?? "") || undefined : undefined);
  const metadata = sanitizeMetadata(row.metadata);

  if (railId === "lightning" && defaults?.recipientPubkey && typeof metadata.recipientPubkey !== "string") {
    metadata.recipientPubkey = defaults.recipientPubkey;
  }

  return {
    version: 1,
    railId,
    asset,
    destination,
    network,
    label: sanitizeText(row.label, 80),
    reference: sanitizeText(row.reference, 160),
    contractAddress: sanitizeText(row.contractAddress, 120),
    amount,
    amountAtomic,
    metadata
  };
}

export function paymentSettlementTargetToMethod(
  target: PaymentSettlementTarget | null | undefined,
  fallbackAmount?: string | null
): StreamPaymentMethod | null {
  if (!target) return null;
  const amount = asString(target.amount) || asString(fallbackAmount) || undefined;
  const network = asString(target.network) || undefined;
  const validationError = validatePaymentAddress(target.asset, target.destination, target.railId === "lightning" ? "lightning" : network);
  if (validationError) return null;
  return {
    asset: target.asset,
    address: target.destination,
    network,
    label: asString(target.label) || undefined,
    amount
  };
}

export function paymentSessionTargetToMethod(target: PaymentSessionTarget | null | undefined): StreamPaymentMethod | null {
  if (!target) return null;
  return paymentSettlementTargetToMethod(
    {
      version: 1,
      railId: target.railId,
      asset: target.asset,
      destination: target.destination,
      network: target.network,
      label: target.label,
      reference: target.reference,
      contractAddress: target.contractAddress,
      amount: target.amount,
      amountAtomic: target.amountAtomic,
      metadata: target.metadata
    },
    target.amount
  );
}

export function paymentMethodToSettlementTarget(
  method: StreamPaymentMethod,
  options?: {
    railId?: PaymentRailId;
    reference?: string;
    contractAddress?: string;
    recipientPubkey?: string;
  }
): PaymentSettlementTarget {
  const railId = options?.railId ?? getPaymentRailForMethod(method).id;
  const metadata =
    railId === "lightning" && options?.recipientPubkey
      ? {
          recipientPubkey: options.recipientPubkey
        }
      : {};
  return {
    version: 1,
    railId,
    asset: method.asset,
    destination: normalizePaymentAddress(method.asset, method.address, method.network),
    network: asString(method.network) || undefined,
    label: asString(method.label) || undefined,
    reference: asString(options?.reference) || undefined,
    contractAddress: asString(options?.contractAddress) || undefined,
    amount: asString(method.amount) || undefined,
    amountAtomic:
      method.amount && parseAmountToUnits(method.amount, PAYMENT_ASSET_DECIMALS[method.asset]) !== null
        ? String(parseAmountToUnits(method.amount, PAYMENT_ASSET_DECIMALS[method.asset]))
        : undefined,
    metadata
  };
}
