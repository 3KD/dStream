import { STREAM_PAYMENT_ASSETS, type StreamPaymentAsset, type StreamPaymentMethod } from "@dstream/protocol";

export interface PaymentAssetMeta {
  asset: StreamPaymentAsset;
  name: string;
  symbol: string;
  placeholder: string;
  defaultNetwork?: string;
  walletUriScheme?: string;
}

export type WalletIntegrationMode = "native_app" | "browser_extension" | "external_cli";

export type WalletIntegrationId =
  | "cake"
  | "feather"
  | "monero_cli"
  | "phoenix"
  | "zeus"
  | "alby"
  | "blink"
  | "metamask"
  | "walletconnect"
  | "phantom"
  | "xaman"
  | "tronlink"
  | "electrum"
  | "bitcoin_core"
  | "yoroi";

export interface WalletIntegration {
  id: WalletIntegrationId;
  name: string;
  mode: WalletIntegrationMode;
  assets: StreamPaymentAsset[];
  website: string;
}

const PAYMENT_ASSET_PREFERRED_HEAD: StreamPaymentAsset[] = ["xmr", "btc"];
const PAYMENT_ASSET_PREFERRED_HEAD_SET = new Set<StreamPaymentAsset>(PAYMENT_ASSET_PREFERRED_HEAD);

export const PAYMENT_ASSET_ORDER: StreamPaymentAsset[] = [
  ...PAYMENT_ASSET_PREFERRED_HEAD,
  ...STREAM_PAYMENT_ASSETS.filter((asset) => !PAYMENT_ASSET_PREFERRED_HEAD_SET.has(asset))
];

const PAYMENT_ASSET_ORDER_INDEX = new Map<StreamPaymentAsset, number>(
  PAYMENT_ASSET_ORDER.map((asset, index) => [asset, index])
);

const BTC_LIGHTNING_INVOICE_RE = /^(lnbc|lntb|lnbcrt|lnsb|lntbs)[0-9a-z]+$/i;
const BTC_LIGHTNING_LNURL_RE = /^lnurl[0-9a-z]+$/i;
const BTC_LIGHTNING_ADDRESS_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function paymentAssetOrderIndex(asset: StreamPaymentAsset): number {
  return PAYMENT_ASSET_ORDER_INDEX.get(asset) ?? Number.MAX_SAFE_INTEGER;
}

export function comparePaymentAssetOrder(a: StreamPaymentAsset, b: StreamPaymentAsset): number {
  return paymentAssetOrderIndex(a) - paymentAssetOrderIndex(b);
}

export const PAYMENT_ASSET_META: Record<StreamPaymentAsset, PaymentAssetMeta> = {
  xmr: {
    asset: "xmr",
    name: "Monero",
    symbol: "XMR",
    placeholder: "4... / 8...",
    defaultNetwork: "mainnet",
    walletUriScheme: "monero"
  },
  eth: {
    asset: "eth",
    name: "Ethereum",
    symbol: "ETH",
    placeholder: "0x...",
    defaultNetwork: "ethereum",
    walletUriScheme: "ethereum"
  },
  btc: {
    asset: "btc",
    name: "Bitcoin",
    symbol: "BTC",
    placeholder: "bc1... / 1... / 3... / lnurl... / user@domain",
    defaultNetwork: "bitcoin",
    walletUriScheme: "bitcoin"
  },
  usdt: {
    asset: "usdt",
    name: "Tether",
    symbol: "USDT",
    placeholder: "0x... / T... / TRON address",
    defaultNetwork: "ethereum",
    walletUriScheme: "ethereum"
  },
  xrp: {
    asset: "xrp",
    name: "XRP",
    symbol: "XRP",
    placeholder: "r...",
    defaultNetwork: "xrpl",
    walletUriScheme: "xrpl"
  },
  usdc: {
    asset: "usdc",
    name: "USD Coin",
    symbol: "USDC",
    placeholder: "0x... / Solana address",
    defaultNetwork: "ethereum",
    walletUriScheme: "ethereum"
  },
  sol: {
    asset: "sol",
    name: "Solana",
    symbol: "SOL",
    placeholder: "Base58 address",
    defaultNetwork: "solana",
    walletUriScheme: "solana"
  },
  trx: {
    asset: "trx",
    name: "TRON",
    symbol: "TRX",
    placeholder: "T...",
    defaultNetwork: "tron",
    walletUriScheme: "tron"
  },
  doge: {
    asset: "doge",
    name: "Dogecoin",
    symbol: "DOGE",
    placeholder: "D... / A...",
    defaultNetwork: "dogecoin",
    walletUriScheme: "dogecoin"
  },
  bch: {
    asset: "bch",
    name: "Bitcoin Cash",
    symbol: "BCH",
    placeholder: "bitcoincash:... / q...",
    defaultNetwork: "bitcoincash",
    walletUriScheme: "bitcoincash"
  },
  ada: {
    asset: "ada",
    name: "Cardano",
    symbol: "ADA",
    placeholder: "addr1...",
    defaultNetwork: "cardano",
    walletUriScheme: "cardano"
  },
  pepe: {
    asset: "pepe",
    name: "PEPE",
    symbol: "PEPE",
    placeholder: "0x...",
    defaultNetwork: "ethereum",
    walletUriScheme: "ethereum"
  }
};

export const WALLET_INTEGRATIONS: WalletIntegration[] = [
  {
    id: "cake",
    name: "Cake Wallet",
    mode: "native_app",
    assets: ["xmr", "btc", "eth", "usdc", "trx"],
    website: "https://cakewallet.com"
  },
  {
    id: "feather",
    name: "Feather Wallet",
    mode: "native_app",
    assets: ["xmr"],
    website: "https://featherwallet.org"
  },
  {
    id: "monero_cli",
    name: "Monero CLI",
    mode: "external_cli",
    assets: ["xmr"],
    website: "https://www.getmonero.org/downloads"
  },
  {
    id: "phoenix",
    name: "Phoenix",
    mode: "native_app",
    assets: ["btc"],
    website: "https://phoenix.acinq.co"
  },
  {
    id: "zeus",
    name: "ZEUS",
    mode: "native_app",
    assets: ["btc"],
    website: "https://zeusln.app"
  },
  {
    id: "alby",
    name: "Alby",
    mode: "browser_extension",
    assets: ["btc"],
    website: "https://getalby.com"
  },
  {
    id: "blink",
    name: "Blink",
    mode: "native_app",
    assets: ["btc"],
    website: "https://www.blink.sv"
  },
  {
    id: "metamask",
    name: "MetaMask",
    mode: "browser_extension",
    assets: ["eth", "usdt", "usdc", "pepe"],
    website: "https://metamask.io"
  },
  {
    id: "walletconnect",
    name: "WalletConnect",
    mode: "browser_extension",
    assets: ["eth", "usdt", "usdc", "pepe", "sol"],
    website: "https://walletconnect.com"
  },
  {
    id: "phantom",
    name: "Phantom",
    mode: "browser_extension",
    assets: ["sol", "usdc", "eth"],
    website: "https://phantom.app"
  },
  {
    id: "xaman",
    name: "Xaman",
    mode: "native_app",
    assets: ["xrp"],
    website: "https://xaman.app"
  },
  {
    id: "tronlink",
    name: "TronLink",
    mode: "browser_extension",
    assets: ["trx", "usdt"],
    website: "https://www.tronlink.org"
  },
  {
    id: "electrum",
    name: "Electrum",
    mode: "native_app",
    assets: ["btc"],
    website: "https://electrum.org"
  },
  {
    id: "bitcoin_core",
    name: "Bitcoin Core",
    mode: "external_cli",
    assets: ["btc"],
    website: "https://bitcoincore.org"
  },
  {
    id: "yoroi",
    name: "Yoroi",
    mode: "browser_extension",
    assets: ["ada"],
    website: "https://yoroi-wallet.com"
  }
];

export function getWalletIntegrationById(id: string | null | undefined): WalletIntegration | null {
  if (!id) return null;
  const normalized = id.trim().toLowerCase();
  return WALLET_INTEGRATIONS.find((wallet) => wallet.id === normalized) ?? null;
}

export function isWalletIntegrationId(id: string | null | undefined): id is WalletIntegrationId {
  return !!getWalletIntegrationById(id);
}

export function getWalletIntegrationsForAsset(asset: StreamPaymentAsset): WalletIntegration[] {
  return WALLET_INTEGRATIONS.filter((wallet) => wallet.assets.includes(asset));
}

function encodeUriValue(input: string): string {
  return encodeURIComponent(input);
}

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
  if (!input) return false;
  return BTC_LIGHTNING_INVOICE_RE.test(input) || BTC_LIGHTNING_LNURL_RE.test(input) || BTC_LIGHTNING_ADDRESS_RE.test(input);
}

function withQuery(base: string, params: Record<string, string | null | undefined>): string {
  const query = Object.entries(params)
    .filter(([, value]) => !!value)
    .map(([key, value]) => `${encodeUriValue(key)}=${encodeUriValue(value ?? "")}`)
    .join("&");
  return query ? `${base}?${query}` : base;
}

export function buildPaymentUri(method: StreamPaymentMethod): string | null {
  const asset = method.asset;
  const address = method.address.trim();
  if (!address) return null;

  switch (asset) {
    case "xmr":
      return withQuery(`monero:${address}`, {
        recipient_name: method.label,
        tx_description: method.network,
        tx_amount: method.amount
      });
    case "btc": {
      const lightningPayload = stripScheme(address, "lightning").trim();
      const isLightning = (isBtcLightningNetwork(method.network) || isBtcLightningPayload(lightningPayload)) && isBtcLightningPayload(lightningPayload);
      if (isLightning) {
        const isBolt11 = BTC_LIGHTNING_INVOICE_RE.test(lightningPayload);
        return withQuery(`lightning:${lightningPayload}`, {
          amount: !isBolt11 ? method.amount : undefined
        });
      }
      return withQuery(`bitcoin:${address}`, { label: method.label, amount: method.amount });
    }
    case "doge":
      return withQuery(`dogecoin:${address}`, { label: method.label, amount: method.amount });
    case "bch":
      return withQuery(address.startsWith("bitcoincash:") ? address : `bitcoincash:${address}`, { label: method.label, amount: method.amount });
    case "ada":
      return `cardano:${address}`;
    case "xrp":
      return `xrpl:${address}`;
    case "sol":
      return `solana:${address}`;
    case "trx":
      return `tron:${address}`;
    case "eth":
    case "usdt":
    case "usdc":
    case "pepe":
      return withQuery(`ethereum:${address}`, { chain: method.network, label: method.label });
    default:
      return null;
  }
}

export function assetLabel(asset: StreamPaymentAsset): string {
  return PAYMENT_ASSET_META[asset]?.symbol ?? asset.toUpperCase();
}
