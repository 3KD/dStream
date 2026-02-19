import { STREAM_PAYMENT_ASSETS, type StreamPaymentAsset, type StreamPaymentMethod } from "@dstream/protocol";

const NETWORK_RE = /^[a-z0-9._-]{2,40}$/i;

export interface PaymentMethodDraft {
  asset: StreamPaymentAsset;
  address: string;
  network: string;
  label: string;
}

export interface PaymentMethodValidationResult {
  methods: StreamPaymentMethod[];
  errors: string[];
}

export function normalizePaymentAsset(input: unknown): StreamPaymentAsset | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return STREAM_PAYMENT_ASSETS.includes(value as StreamPaymentAsset) ? (value as StreamPaymentAsset) : null;
}

export function createPaymentMethodDraft(asset: StreamPaymentAsset = "eth"): PaymentMethodDraft {
  return {
    asset,
    address: "",
    network: "",
    label: ""
  };
}

export function paymentMethodToDraft(input: StreamPaymentMethod): PaymentMethodDraft {
  return {
    asset: input.asset,
    address: input.address ?? "",
    network: input.network ?? "",
    label: input.label ?? ""
  };
}

export function normalizePaymentAddress(asset: StreamPaymentAsset, addressRaw: string): string {
  const address = addressRaw.trim();
  if (!address) return "";
  if (asset === "eth" || asset === "usdt" || asset === "usdc" || asset === "pepe") return address.toLowerCase();
  return address;
}

function normalizeNetwork(input: string): string | undefined {
  const network = input.trim();
  if (!network) return undefined;
  if (!NETWORK_RE.test(network)) return undefined;
  return network.toLowerCase();
}

function normalizeLabel(input: string): string | undefined {
  const label = input.trim().replace(/\s+/g, " ");
  if (!label) return undefined;
  return label.slice(0, 48);
}

export function validatePaymentAddress(asset: StreamPaymentAsset, addressRaw: string): string | null {
  const address = addressRaw.trim();
  if (!address) return "Address is required.";

  switch (asset) {
    case "xmr":
      if (/^[48][1-9A-HJ-NP-Za-km-z]{94,105}$/.test(address)) return null;
      return "Monero address format is invalid.";
    case "eth":
    case "usdt":
    case "usdc":
    case "pepe":
      if (/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
      return "EVM address must be 0x + 40 hex chars.";
    case "btc":
      if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,87}$/.test(address)) return null;
      return "Bitcoin address format is invalid.";
    case "xrp":
      if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return null;
      return "XRP address format is invalid.";
    case "sol":
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
      return "Solana address format is invalid.";
    case "trx":
      if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return null;
      return "TRON address format is invalid.";
    case "doge":
      if (/^[DA9][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) return null;
      return "Dogecoin address format is invalid.";
    case "bch":
      if (/^(bitcoincash:)?(q|p)[a-z0-9]{41}$/.test(address.toLowerCase())) return null;
      return "BCH address format is invalid.";
    case "ada":
      if (/^(addr1|Ae2)[0-9a-zA-Z]{20,200}$/.test(address)) return null;
      return "Cardano address format is invalid.";
    default:
      return "Unsupported payment asset.";
  }
}

function paymentMethodKey(method: StreamPaymentMethod): string {
  return `${method.asset}|${method.address}|${method.network ?? ""}|${method.label ?? ""}`;
}

export function toPaymentMethod(input: PaymentMethodDraft): { method: StreamPaymentMethod | null; error: string | null } {
  const asset = normalizePaymentAsset(input.asset);
  if (!asset) return { method: null, error: "Asset is required." };

  const address = normalizePaymentAddress(asset, input.address);
  const addressError = validatePaymentAddress(asset, address);
  if (addressError) return { method: null, error: addressError };

  if (input.network.trim() && !normalizeNetwork(input.network)) {
    return { method: null, error: "Network must use 2-40 characters: letters, numbers, dot, dash, underscore." };
  }

  return {
    method: {
      asset,
      address,
      network: normalizeNetwork(input.network),
      label: normalizeLabel(input.label)
    },
    error: null
  };
}

export function validatePaymentMethodDrafts(input: PaymentMethodDraft[]): PaymentMethodValidationResult {
  const methods: StreamPaymentMethod[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < input.length; index++) {
    const row = input[index]!;
    const hasAnyValue = !!row.address.trim() || !!row.network.trim() || !!row.label.trim();
    if (!hasAnyValue) continue;

    const { method, error } = toPaymentMethod(row);
    if (error || !method) {
      errors.push(`Payment row ${index + 1}: ${error ?? "Invalid payment method."}`);
      continue;
    }

    const key = paymentMethodKey(method);
    if (seen.has(key)) continue;
    seen.add(key);
    methods.push(method);
  }

  return { methods, errors };
}

export function coercePaymentMethods(input: unknown): StreamPaymentMethod[] {
  if (!Array.isArray(input)) return [];
  const drafts: PaymentMethodDraft[] = input
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const obj = row as Record<string, unknown>;
      const asset = normalizePaymentAsset(obj.asset);
      if (!asset) return null;
      return {
        asset,
        address: typeof obj.address === "string" ? obj.address : "",
        network: typeof obj.network === "string" ? obj.network : "",
        label: typeof obj.label === "string" ? obj.label : ""
      } satisfies PaymentMethodDraft;
    })
    .filter((row): row is PaymentMethodDraft => !!row);

  return validatePaymentMethodDrafts(drafts).methods;
}
