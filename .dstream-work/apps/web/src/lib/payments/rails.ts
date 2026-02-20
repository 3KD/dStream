import type { StreamPaymentAsset, StreamPaymentMethod } from "@dstream/protocol";

export type PaymentRailExecution = "verified_backend" | "wallet_uri";

export type PaymentRailId = "xmr" | "utxo" | "evm" | "tron" | "solana" | "xrpl" | "cardano";

export interface PaymentRailMeta {
  id: PaymentRailId;
  name: string;
  description: string;
  execution: PaymentRailExecution;
  assets: StreamPaymentAsset[];
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
    id: "utxo",
    name: "UTXO",
    description: "UTXO chains routed through wallet URI/open-copy flows.",
    execution: "wallet_uri",
    assets: ["btc", "doge", "bch"]
  },
  {
    id: "evm",
    name: "EVM",
    description: "EVM assets routed through compatible wallet integrations.",
    execution: "wallet_uri",
    assets: ["eth", "usdt", "usdc", "pepe"]
  },
  {
    id: "tron",
    name: "TRON",
    description: "TRON rail routed via TRON-compatible wallets.",
    execution: "wallet_uri",
    assets: ["trx"]
  },
  {
    id: "solana",
    name: "Solana",
    description: "Solana SPL/native flows through Solana wallets.",
    execution: "wallet_uri",
    assets: ["sol"]
  },
  {
    id: "xrpl",
    name: "XRPL",
    description: "XRP Ledger payments routed with XRP wallet integrations.",
    execution: "wallet_uri",
    assets: ["xrp"]
  },
  {
    id: "cardano",
    name: "Cardano",
    description: "Cardano address payments through Cardano wallets.",
    execution: "wallet_uri",
    assets: ["ada"]
  }
];

const PAYMENT_RAIL_BY_ID = new Map<PaymentRailId, PaymentRailMeta>(PAYMENT_RAILS.map((rail) => [rail.id, rail]));
const PAYMENT_RAIL_BY_ASSET = new Map<StreamPaymentAsset, PaymentRailMeta>();

for (const rail of PAYMENT_RAILS) {
  for (const asset of rail.assets) {
    PAYMENT_RAIL_BY_ASSET.set(asset, rail);
  }
}

export function getPaymentRailById(id: PaymentRailId): PaymentRailMeta {
  return PAYMENT_RAIL_BY_ID.get(id) ?? PAYMENT_RAILS[0]!;
}

export function getPaymentRailForAsset(asset: StreamPaymentAsset): PaymentRailMeta {
  return PAYMENT_RAIL_BY_ASSET.get(asset) ?? getPaymentRailById("xmr");
}

export function getPaymentRailForMethod(method: StreamPaymentMethod): PaymentRailMeta {
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

