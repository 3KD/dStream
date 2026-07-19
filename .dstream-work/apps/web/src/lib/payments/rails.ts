import type { StreamPaymentAsset, StreamPaymentMethod } from "@dstream/protocol";

export type PaymentRailExecution = "verified_backend" | "wallet_uri";

export type PaymentRailId = "xmr" | "lightning" | "utxo" | "evm" | "tron" | "solana" | "xrpl" | "cardano";

export interface PaymentRailMeta {
  id: PaymentRailId;
  name: string;
  description: string;
  execution: PaymentRailExecution;
  assets: StreamPaymentAsset[];
  verifiedAssets?: StreamPaymentAsset[];
}

const BTC_LIGHTNING_INVOICE_RE = /^(lnbc|lntb|lnbcrt|lnsb|lntbs)[0-9a-z]+$/i;
const BTC_LIGHTNING_LNURL_RE = /^lnurl[0-9a-z]+$/i;
const BTC_LIGHTNING_ADDRESS_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function isBtcLightningNetwork(input: string | null | undefined): boolean {
  const value = (input ?? "").trim().toLowerCase();
  return value === "lightning" || value === "ln" || value === "lnurl" || value === "bolt11";
}

function stripScheme(input: string, scheme: string): string {
  const prefix = `${scheme}:`;
  if (input.slice(0, prefix.length).toLowerCase() !== prefix) return input;
  return input.slice(prefix.length);
}

function isBtcLightningPayload(input: string): boolean {
  if (!input) return false;
  return BTC_LIGHTNING_INVOICE_RE.test(input) || BTC_LIGHTNING_LNURL_RE.test(input) || BTC_LIGHTNING_ADDRESS_RE.test(input);
}

export const PAYMENT_RAILS: PaymentRailMeta[] = [
  {
    id: "xmr",
    name: "Monero",
    description: "Shielded on-chain rail. Supports verified tip/stake sessions.",
    execution: "verified_backend",
    assets: ["xmr"]
  },
  {
    id: "lightning",
    name: "Lightning",
    description: "Bitcoin Lightning payments with NIP-57 receipts and backend settlement verification.",
    execution: "verified_backend",
    assets: ["btc"],
    verifiedAssets: ["btc"]
  },
  {
    id: "utxo",
    name: "UTXO",
    description: "Verified Bitcoin, Dogecoin, and Bitcoin Cash on-chain settlement.",
    execution: "verified_backend",
    assets: ["btc", "doge", "bch"],
    verifiedAssets: ["btc", "doge", "bch"]
  },
  {
    id: "evm",
    name: "EVM",
    description: "Verified ETH and allowlisted ERC-20 settlement on configured EVM networks.",
    execution: "verified_backend",
    assets: ["eth", "usdt", "usdc", "pepe"],
    verifiedAssets: ["eth", "usdt", "usdc", "pepe"]
  },
  {
    id: "tron",
    name: "TRON",
    description: "Verified TRX and TRC-20 USDT settlement.",
    execution: "verified_backend",
    assets: ["trx", "usdt"],
    verifiedAssets: ["trx", "usdt"]
  },
  {
    id: "solana",
    name: "Solana",
    description: "Verified SOL, SPL USDC, and SPL USDT settlement.",
    execution: "verified_backend",
    assets: ["sol", "usdc", "usdt"],
    verifiedAssets: ["sol", "usdc", "usdt"]
  },
  {
    id: "xrpl",
    name: "XRPL",
    description: "Verified finalized XRP Ledger payments.",
    execution: "verified_backend",
    assets: ["xrp"],
    verifiedAssets: ["xrp"]
  },
  {
    id: "cardano",
    name: "Cardano",
    description: "Verified Cardano address payments.",
    execution: "verified_backend",
    assets: ["ada"],
    verifiedAssets: ["ada"]
  }
];

const PAYMENT_RAIL_BY_ID = new Map<PaymentRailId, PaymentRailMeta>(PAYMENT_RAILS.map((rail) => [rail.id, rail]));
const DEFAULT_RAIL_BY_ASSET: Record<StreamPaymentAsset, PaymentRailId> = {
  xmr: "xmr",
  btc: "utxo",
  eth: "evm",
  usdt: "evm",
  xrp: "xrpl",
  usdc: "evm",
  sol: "solana",
  trx: "tron",
  doge: "utxo",
  bch: "utxo",
  ada: "cardano",
  pepe: "evm"
};

export function getPaymentRailById(id: PaymentRailId): PaymentRailMeta {
  return PAYMENT_RAIL_BY_ID.get(id) ?? PAYMENT_RAILS[0]!;
}

export function getPaymentRailForAsset(asset: StreamPaymentAsset): PaymentRailMeta {
  return getPaymentRailById(DEFAULT_RAIL_BY_ASSET[asset] ?? "xmr");
}

export function getPaymentRailForMethod(method: StreamPaymentMethod): PaymentRailMeta {
  if (method.asset === "btc") {
    const payload = stripScheme(method.address.trim(), "lightning");
    if (isBtcLightningNetwork(method.network) || isBtcLightningPayload(payload)) {
      return getPaymentRailById("lightning");
    }
    return getPaymentRailById("utxo");
  }
  const network = (method.network ?? "").trim().toLowerCase();
  if (method.asset === "usdt" && (network.includes("tron") || network.includes("trc20"))) {
    return getPaymentRailById("tron");
  }
  if ((method.asset === "usdt" || method.asset === "usdc") && (network.includes("solana") || network.includes("spl"))) {
    return getPaymentRailById("solana");
  }
  return getPaymentRailForAsset(method.asset);
}

export function groupPaymentMethodsByRail(methods: StreamPaymentMethod[]) {
  const groups = new Map<PaymentRailId, { rail: PaymentRailMeta; methods: StreamPaymentMethod[] }>();
  for (const method of methods) {
    const rail = getPaymentRailForMethod(method);
    const current = groups.get(rail.id) ?? { rail, methods: [] };
    current.methods.push(method);
    groups.set(rail.id, current);
  }
  return PAYMENT_RAILS.map((rail) => groups.get(rail.id)).filter(
    (entry): entry is { rail: PaymentRailMeta; methods: StreamPaymentMethod[] } => !!entry
  );
}
