import { STREAM_PAYMENT_ASSETS, type StreamPaymentAsset, type StreamPaymentMethod } from "@dstream/protocol";

const NETWORK_RE = /^[a-z0-9._-]{2,40}$/i;
const BTC_ONCHAIN_RE = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,87}$/;
const BTC_LIGHTNING_INVOICE_RE = /^(lnbc|lntb|lnbcrt|lnsb|lntbs)[0-9a-z]+$/i;
const BTC_LIGHTNING_LNURL_RE = /^lnurl[0-9a-z]+$/i;
const BTC_LIGHTNING_ADDRESS_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const PAYMENT_AMOUNT_MAX_DECIMALS: Record<StreamPaymentAsset, number> = {
  xmr: 12,
  eth: 18,
  btc: 8,
  usdt: 8,
  xrp: 6,
  usdc: 8,
  sol: 9,
  trx: 6,
  doge: 8,
  bch: 8,
  ada: 6,
  pepe: 18
};

function stripScheme(input: string, scheme: string): string {
  const prefix = `${scheme}:`;
  if (input.slice(0, prefix.length).toLowerCase() !== prefix) return input;
  return input.slice(prefix.length);
}

function isBtcLightningNetwork(input: string | null | undefined): boolean {
  const value = (input ?? "").trim().toLowerCase();
  return value === "lightning" || value === "ln" || value === "lnurl" || value === "bolt11";
}

function isBtcLightningPayload(input: string): boolean {
  const value = stripScheme(input.trim(), "lightning");
  if (!value) return false;
  return BTC_LIGHTNING_INVOICE_RE.test(value) || BTC_LIGHTNING_LNURL_RE.test(value) || BTC_LIGHTNING_ADDRESS_RE.test(value);
}

export interface PaymentMethodDraft {
  asset: StreamPaymentAsset;
  address: string;
  network: string;
  label: string;
  amount: string;
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
    label: "",
    amount: ""
  };
}

export function paymentMethodToDraft(input: StreamPaymentMethod): PaymentMethodDraft {
  return {
    asset: input.asset,
    address: input.address ?? "",
    network: input.network ?? "",
    label: input.label ?? "",
    amount: input.amount ?? ""
  };
}

export function normalizePaymentAddress(asset: StreamPaymentAsset, addressRaw: string): string {
  const address = addressRaw.trim();
  if (!address) return "";
  if (asset === "btc") return stripScheme(address, "lightning").trim();
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

function normalizeIntegerAmount(inputRaw: string): string | null {
  const input = inputRaw.trim();
  if (!/^\d+$/.test(input)) return null;
  const normalized = input.replace(/^0+(?=\d)/, "");
  if (normalized === "0") return null;
  return normalized;
}

function normalizeDecimalAmount(inputRaw: string, maxDecimals: number): string | null {
  const input = inputRaw.trim();
  const match = input.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const wholeRaw = match[1] ?? "0";
  const fracRaw = match[2] ?? "";
  if (fracRaw.length > maxDecimals) return null;
  if (/^0+$/.test(wholeRaw) && (!fracRaw || /^0+$/.test(fracRaw))) return null;
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  const frac = fracRaw.replace(/0+$/, "");
  if (!frac) return whole;
  return `${whole}.${frac}`;
}

function normalizePaymentAmount(asset: StreamPaymentAsset, amountRaw: string, networkRaw: string, addressRaw: string): string | null {
  const value = amountRaw.trim();
  if (!value) return null;

  if (asset === "btc" && (isBtcLightningNetwork(networkRaw) || isBtcLightningPayload(addressRaw))) {
    return normalizeIntegerAmount(value);
  }

  const maxDecimals = PAYMENT_AMOUNT_MAX_DECIMALS[asset] ?? 8;
  return normalizeDecimalAmount(value, maxDecimals);
}

export function validatePaymentAmount(
  asset: StreamPaymentAsset,
  amountRaw: string,
  networkRaw: string,
  addressRaw: string
): string | null {
  const value = amountRaw.trim();
  if (!value) return null;
  const normalized = normalizePaymentAmount(asset, value, networkRaw, addressRaw);
  if (normalized) return null;

  if (asset === "btc" && (isBtcLightningNetwork(networkRaw) || isBtcLightningPayload(addressRaw))) {
    return "Lightning amount must be a positive integer in sats.";
  }

  const maxDecimals = PAYMENT_AMOUNT_MAX_DECIMALS[asset] ?? 8;
  return `Amount must be a positive number with up to ${maxDecimals} decimals.`;
}

export function validatePaymentAddress(asset: StreamPaymentAsset, addressRaw: string, networkRaw?: string): string | null {
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
      if (isBtcLightningNetwork(networkRaw) || isBtcLightningPayload(address)) {
        if (isBtcLightningPayload(address)) return null;
        return "Bitcoin Lightning format is invalid (use bolt11, lnurl, or lightning address).";
      }
      if (BTC_ONCHAIN_RE.test(address)) return null;
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
  return `${method.asset}|${method.address}|${method.network ?? ""}|${method.label ?? ""}|${method.amount ?? ""}`;
}

export function toPaymentMethod(input: PaymentMethodDraft): { method: StreamPaymentMethod | null; error: string | null } {
  const asset = normalizePaymentAsset(input.asset);
  if (!asset) return { method: null, error: "Asset is required." };

  const address = normalizePaymentAddress(asset, input.address);
  const addressError = validatePaymentAddress(asset, address, input.network);
  if (addressError) return { method: null, error: addressError };
  const amount = input.amount.trim() ? normalizePaymentAmount(asset, input.amount, input.network, address) : null;
  if (input.amount.trim() && !amount) {
    return { method: null, error: validatePaymentAmount(asset, input.amount, input.network, address) ?? "Amount is invalid." };
  }

  if (input.network.trim() && !normalizeNetwork(input.network)) {
    return { method: null, error: "Network must use 2-40 characters: letters, numbers, dot, dash, underscore." };
  }

  return {
    method: {
      asset,
      address,
      network: normalizeNetwork(input.network),
      label: normalizeLabel(input.label),
      ...(amount ? { amount } : {})
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
        label: typeof obj.label === "string" ? obj.label : "",
        amount: typeof obj.amount === "string" ? obj.amount : ""
      } satisfies PaymentMethodDraft;
    })
    .filter((row): row is PaymentMethodDraft => !!row);

  return validatePaymentMethodDrafts(drafts).methods;
}
