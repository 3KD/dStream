"use client";

import type { StreamPaymentAsset, StreamPaymentMethod } from "@dstream/protocol";
import { buildPaymentUri } from "./catalog";

export type NativeWalletProvider = "metamask" | "webln" | "phantom" | "tronlink" | "wallet_uri";
export type NativeWalletCapabilityMode = "provider_send" | "wallet_uri" | "unsupported";

export interface NativeWalletSendResult {
  ok: boolean;
  provider?: NativeWalletProvider;
  txId?: string;
  error?: string;
}

export interface NativeWalletCapability {
  supported: boolean;
  mode: NativeWalletCapabilityMode;
  providerLabel: string;
  requiresAmount: boolean;
  canAttemptProvider: boolean;
  hasWalletUri: boolean;
  reason?: string;
}

const EVM_CHAIN_BY_NETWORK: Record<string, `0x${string}`> = {
  "1": "0x1",
  ethereum: "0x1",
  mainnet: "0x1",
  "137": "0x89",
  polygon: "0x89",
  matic: "0x89",
  "56": "0x38",
  bsc: "0x38",
  "10": "0xa",
  optimism: "0xa",
  "42161": "0xa4b1",
  arbitrum: "0xa4b1",
  "8453": "0x2105",
  base: "0x2105"
};

const EVM_TOKEN_META: Record<
  string,
  Partial<Record<Exclude<StreamPaymentAsset, "xmr" | "btc" | "trx" | "sol" | "doge" | "bch" | "xrp" | "ada">, { contract: string; decimals: number }>>
> = {
  "0x1": {
    usdt: { contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    usdc: { contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    pepe: { contract: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18 }
  }
};

const TRON_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const BTC_LIGHTNING_INVOICE_RE = /^(lnbc|lntb|lnbcrt|lnsb|lntbs)[0-9a-z]+$/i;
const BTC_LIGHTNING_LNURL_RE = /^lnurl[0-9a-z]+$/i;
const BTC_LIGHTNING_ADDRESS_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function normalizeNetworkKey(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function hasAmount(method: StreamPaymentMethod): boolean {
  return !!(method.amount ?? "").trim();
}

function stripScheme(input: string, scheme: string): string {
  const prefix = `${scheme}:`;
  if (input.slice(0, prefix.length).toLowerCase() !== prefix) return input;
  return input.slice(prefix.length);
}

function isBtcLightningNetwork(input: string | null | undefined): boolean {
  const value = normalizeNetworkKey(input);
  return value === "lightning" || value === "ln" || value === "lnurl" || value === "bolt11";
}

function isBtcLightningPayload(input: string): boolean {
  if (!input) return false;
  return BTC_LIGHTNING_INVOICE_RE.test(input) || BTC_LIGHTNING_LNURL_RE.test(input) || BTC_LIGHTNING_ADDRESS_RE.test(input);
}

function isBtcLightningMethod(method: StreamPaymentMethod): boolean {
  const payload = stripScheme(method.address.trim(), "lightning").trim();
  return isBtcLightningNetwork(method.network) || isBtcLightningPayload(payload);
}

function isTronNetwork(networkRaw: string | null | undefined): boolean {
  return normalizeNetworkKey(networkRaw).includes("tron");
}

function parseAmountToUnits(amountRaw: string | undefined, decimals: number): bigint | null {
  const raw = (amountRaw ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fracInput = match[2] ?? "";
  if (fracInput.length > decimals) return null;
  const frac = fracInput.padEnd(decimals, "0");
  try {
    const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || "0");
    if (value <= 0n) return null;
    return value;
  } catch {
    return null;
  }
}

function normalizeHexAddress(address: string): string | null {
  const trimmed = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function toHexQuantity(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

function encodeErc20Transfer(recipient: string, value: bigint): `0x${string}` {
  const methodId = "a9059cbb";
  const toNoPrefix = recipient.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const amountHex = value.toString(16).padStart(64, "0");
  return `0x${methodId}${toNoPrefix}${amountHex}`;
}

function getEthereumProvider(): any | null {
  if (typeof window === "undefined") return null;
  const ethereum = (window as any).ethereum;
  if (ethereum && typeof ethereum.request === "function") return ethereum;
  const providers = Array.isArray((window as any).ethereum?.providers) ? (window as any).ethereum.providers : null;
  if (providers) {
    const metamask = providers.find((provider: any) => provider?.isMetaMask && typeof provider.request === "function");
    if (metamask) return metamask;
  }
  return null;
}

function hasTronProvider(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).tronWeb;
}

function hasPhantomProvider(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).solana?.isPhantom;
}

function hasWebLnProvider(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).webln;
}

function supportsNativeProvider(method: StreamPaymentMethod): boolean {
  if (typeof window === "undefined") return false;
  if (method.asset === "btc") return isBtcLightningMethod(method) && hasWebLnProvider();
  if (method.asset === "trx") return hasTronProvider();
  if (method.asset === "usdt" && isTronNetwork(method.network)) return hasTronProvider();
  if (method.asset === "sol") return hasPhantomProvider();
  if (isEvmAsset(method.asset)) return !!getEthereumProvider();
  return false;
}

function providerLabelForNativeMethod(method: StreamPaymentMethod): string {
  if (method.asset === "btc") return "WebLN";
  if (method.asset === "sol") return "Phantom";
  if (method.asset === "trx") return "TronLink";
  if (method.asset === "usdt") {
    if (isTronNetwork(method.network)) return "TronLink";
    return "MetaMask";
  }
  if (isEvmAsset(method.asset)) return "MetaMask";
  return "Native Wallet";
}

function openWalletUriPayment(method: StreamPaymentMethod): NativeWalletSendResult {
  if (typeof window === "undefined") return { ok: false, error: "Web environment required." };
  const walletUri = buildPaymentUri(method);
  if (!walletUri) return { ok: false, error: "No wallet URI available for this payment method." };
  try {
    const opened = window.open(walletUri, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = walletUri;
    }
    return { ok: true, provider: "wallet_uri" };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? "Unable to open wallet URI." };
  }
}

function isEvmAsset(asset: StreamPaymentAsset): asset is "eth" | "usdt" | "usdc" | "pepe" {
  return asset === "eth" || asset === "usdt" || asset === "usdc" || asset === "pepe";
}

async function switchEvmChain(provider: any, networkRaw: string | undefined): Promise<void> {
  const key = normalizeNetworkKey(networkRaw);
  if (!key) return;
  const targetChain = EVM_CHAIN_BY_NETWORK[key];
  if (!targetChain) return;
  try {
    const current = (await provider.request({ method: "eth_chainId" })) as string;
    if (typeof current === "string" && current.toLowerCase() === targetChain.toLowerCase()) return;
  } catch {
    // ignore, attempt switch anyway
  }
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChain }] });
  } catch {
    // ignore chain switch failures; wallet may still allow manual chain switch
  }
}

async function sendEvmPayment(method: StreamPaymentMethod): Promise<NativeWalletSendResult> {
  const provider = getEthereumProvider();
  if (!provider) return { ok: false, error: "MetaMask-compatible provider not found." };
  if (!isEvmAsset(method.asset)) return { ok: false, error: "Unsupported EVM asset." };

  const recipient = normalizeHexAddress(method.address);
  if (!recipient) return { ok: false, error: "Invalid EVM recipient address." };

  const amountRaw = (method.amount ?? "").trim();
  if (!amountRaw) return { ok: false, error: "Amount is required for in-app wallet send." };

  await provider.request({ method: "eth_requestAccounts" });
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const from = accounts?.[0];
  if (!from) return { ok: false, error: "No wallet account selected." };

  await switchEvmChain(provider, method.network);

  try {
    if (method.asset === "eth") {
      const valueWei = parseAmountToUnits(amountRaw, 18);
      if (!valueWei) return { ok: false, error: "Invalid ETH amount." };
      const txHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from, to: recipient, value: toHexQuantity(valueWei) }]
      })) as string;
      return { ok: true, provider: "metamask", txId: txHash };
    }

    const networkKey = normalizeNetworkKey(method.network) || "ethereum";
    const chainId = EVM_CHAIN_BY_NETWORK[networkKey] ?? "0x1";
    const tokenMeta = EVM_TOKEN_META[chainId]?.[method.asset];
    if (!tokenMeta) {
      return { ok: false, error: `No token contract mapping for ${method.asset.toUpperCase()} on ${networkKey || "current chain"}.` };
    }

    const tokenValue = parseAmountToUnits(amountRaw, tokenMeta.decimals);
    if (!tokenValue) return { ok: false, error: `Invalid ${method.asset.toUpperCase()} amount.` };
    const data = encodeErc20Transfer(recipient, tokenValue);
    const txHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to: tokenMeta.contract, value: "0x0", data }]
    })) as string;
    return { ok: true, provider: "metamask", txId: txHash };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? "MetaMask transaction failed." };
  }
}

async function sendLightningPayment(method: StreamPaymentMethod): Promise<NativeWalletSendResult> {
  if (typeof window === "undefined") return { ok: false, error: "Web environment required." };
  const webln = (window as any).webln;
  if (!webln || typeof webln.enable !== "function") {
    return { ok: false, error: "WebLN provider not found (install Alby/ZEUS browser integration)." };
  }

  const raw = method.address.trim();
  const invoice = raw.replace(/^lightning:/i, "").trim();
  if (!/^lnbc|^lntb|^lnbcrt|^lnsb|^lntbs/i.test(invoice)) {
    return { ok: false, error: "In-app Lightning send requires a BOLT11 invoice address." };
  }
  try {
    await webln.enable();
    const result = await webln.sendPayment(invoice);
    return { ok: true, provider: "webln", txId: result?.preimage ?? undefined };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? "Lightning payment failed." };
  }
}

async function sendPhantomSolPayment(method: StreamPaymentMethod): Promise<NativeWalletSendResult> {
  if (typeof window === "undefined") return { ok: false, error: "Web environment required." };
  if (method.asset !== "sol") return { ok: false, error: "Only SOL is supported for Phantom in-app send right now." };
  const amountRaw = (method.amount ?? "").trim();
  if (!amountRaw) return { ok: false, error: "Amount is required for in-app wallet send." };

  const provider = (window as any).solana;
  if (!provider?.isPhantom || typeof provider.connect !== "function") {
    return { ok: false, error: "Phantom provider not found." };
  }

  try {
    const web3 = await import("@solana/web3.js");
    const { publicKey } = await provider.connect();
    if (!publicKey) return { ok: false, error: "No Phantom account connected." };
    const sender = new web3.PublicKey(publicKey.toString());
    const recipient = new web3.PublicKey(method.address.trim());
    const lamportsBig = parseAmountToUnits(amountRaw, 9);
    if (!lamportsBig) return { ok: false, error: "Invalid SOL amount." };
    if (lamportsBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { ok: false, error: "Amount is too large for wallet send." };
    }

    const network = normalizeNetworkKey(method.network);
    const cluster = network === "devnet" || network === "testnet" ? network : "mainnet-beta";
    const connection = new web3.Connection(web3.clusterApiUrl(cluster), "confirmed");
    const tx = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: recipient,
        lamports: Number(lamportsBig)
      })
    );
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = sender;

    const sent = await provider.signAndSendTransaction(tx);
    const signature = typeof sent?.signature === "string" ? sent.signature : "";
    if (!signature) return { ok: false, error: "Phantom did not return a signature." };
    await connection.confirmTransaction(signature, "confirmed");
    return { ok: true, provider: "phantom", txId: signature };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? "Phantom transaction failed." };
  }
}

async function sendTronPayment(method: StreamPaymentMethod): Promise<NativeWalletSendResult> {
  if (typeof window === "undefined") return { ok: false, error: "Web environment required." };
  const tronWeb = (window as any).tronWeb;
  if (!tronWeb) return { ok: false, error: "TronLink provider not found." };
  const amountRaw = (method.amount ?? "").trim();
  if (!amountRaw) return { ok: false, error: "Amount is required for in-app wallet send." };

  try {
    const tronLink = (window as any).tronLink;
    if (tronLink?.request) {
      await tronLink.request({ method: "tron_requestAccounts" });
    }
  } catch {
    // continue and rely on tronWeb readiness
  }

  try {
    const sender = tronWeb?.defaultAddress?.base58;
    if (!sender) return { ok: false, error: "No Tron wallet account connected." };
    if (method.asset === "trx") {
      const amountSun = parseAmountToUnits(amountRaw, 6);
      if (!amountSun) return { ok: false, error: "Invalid TRX amount." };
      if (amountSun > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: "Amount is too large." };
      const tx = await tronWeb.transactionBuilder.sendTrx(method.address.trim(), Number(amountSun), sender);
      const signed = await tronWeb.trx.sign(tx);
      const sent = await tronWeb.trx.sendRawTransaction(signed);
      if (!sent?.result) return { ok: false, error: "TRON transaction rejected." };
      return { ok: true, provider: "tronlink", txId: sent.txid ?? undefined };
    }

    if (method.asset === "usdt") {
      const amountUnits = parseAmountToUnits(amountRaw, 6);
      if (!amountUnits) return { ok: false, error: "Invalid USDT amount." };
      const contract = await tronWeb.contract().at(TRON_USDT_CONTRACT);
      const txId = await contract.transfer(method.address.trim(), amountUnits.toString()).send();
      return { ok: true, provider: "tronlink", txId: typeof txId === "string" ? txId : undefined };
    }

    return { ok: false, error: "Unsupported TRON asset for in-app send." };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? "TronLink transaction failed." };
  }
}

export function supportsNativeWalletPayment(method: StreamPaymentMethod): boolean {
  return getNativeWalletCapability(method).supported;
}

export function getNativeWalletCapability(method: StreamPaymentMethod): NativeWalletCapability {
  if (typeof window === "undefined") {
    return {
      supported: false,
      mode: "unsupported",
      providerLabel: "Native Wallet",
      requiresAmount: false,
      canAttemptProvider: false,
      hasWalletUri: false,
      reason: "Web environment required."
    };
  }

  const providerSupported = supportsNativeProvider(method);
  const walletUri = buildPaymentUri(method);
  const hasWalletUri = !!walletUri;

  if (providerSupported) {
    return {
      supported: true,
      mode: "provider_send",
      providerLabel: providerLabelForNativeMethod(method),
      requiresAmount: method.asset !== "btc",
      canAttemptProvider: true,
      hasWalletUri
    };
  }

  if (hasWalletUri) {
    return {
      supported: true,
      mode: "wallet_uri",
      providerLabel: "Wallet App",
      requiresAmount: false,
      canAttemptProvider: false,
      hasWalletUri: true,
      reason: "No compatible in-browser provider detected; opening wallet URI fallback."
    };
  }

  return {
    supported: false,
    mode: "unsupported",
    providerLabel: "Native Wallet",
    requiresAmount: false,
    canAttemptProvider: false,
    hasWalletUri: false,
    reason: `${method.asset.toUpperCase()} does not have a native browser or URI wallet flow configured.`
  };
}

export function nativeWalletSendNeedsAmount(method: StreamPaymentMethod): boolean {
  return getNativeWalletCapability(method).requiresAmount;
}

export function nativeWalletProviderLabel(method: StreamPaymentMethod): string {
  return getNativeWalletCapability(method).providerLabel;
}

export async function sendNativeWalletPayment(method: StreamPaymentMethod): Promise<NativeWalletSendResult> {
  const capability = getNativeWalletCapability(method);
  if (!capability.supported) {
    return { ok: false, error: capability.reason ?? "No supported wallet flow available for this payment method." };
  }
  if (capability.requiresAmount && !hasAmount(method)) {
    return { ok: false, error: "Amount is required for in-app wallet send." };
  }

  if (capability.mode === "wallet_uri") {
    return openWalletUriPayment(method);
  }

  if (method.asset === "btc" && capability.canAttemptProvider) {
    if (isBtcLightningMethod(method)) {
      const lightningResult = await sendLightningPayment(method);
      if (lightningResult.ok) return lightningResult;
    }
    return openWalletUriPayment(method);
  }
  if (method.asset === "trx" || (method.asset === "usdt" && isTronNetwork(method.network))) {
    return sendTronPayment(method);
  }
  if (method.asset === "sol") {
    return sendPhantomSolPayment(method);
  }
  if (isEvmAsset(method.asset)) {
    return sendEvmPayment(method);
  }
  return { ok: false, error: `${method.asset.toUpperCase()} does not have an in-browser send flow.` };
}
