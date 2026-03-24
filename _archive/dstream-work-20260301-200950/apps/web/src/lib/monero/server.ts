import { MoneroWalletRpcClient } from "./walletRpc";

function normalizeOrigin(input: string | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

function parseNonNegativeInt(input: string | undefined, fallback: number): number {
  const raw = (input ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return i >= 0 ? i : fallback;
}

export function getXmrWalletRpcOrigin(): string | null {
  return normalizeOrigin(process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN);
}

export function getXmrWalletRpcAccountIndex(): number {
  return parseNonNegativeInt(process.env.DSTREAM_XMR_ACCOUNT_INDEX, 0);
}

export function getXmrConfirmationsRequired(): number {
  return parseNonNegativeInt(process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED, 10);
}

export function getXmrStakeSlashMinAgeSec(): number {
  return parseNonNegativeInt(process.env.DSTREAM_XMR_STAKE_SLASH_MIN_AGE_SEC, 3600);
}

export function getXmrRefundMinServedBytes(): number {
  return parseNonNegativeInt(process.env.DSTREAM_XMR_REFUND_MIN_SERVED_BYTES, 0);
}

export function getXmrWalletRpcClient(): MoneroWalletRpcClient | null {
  const origin = getXmrWalletRpcOrigin();
  if (!origin) return null;
  const username = (process.env.DSTREAM_XMR_WALLET_RPC_USER ?? "").trim() || undefined;
  const password = (process.env.DSTREAM_XMR_WALLET_RPC_PASS ?? "").trim() || undefined;
  return new MoneroWalletRpcClient({ origin, username, password, timeoutMs: 5000 });
}
