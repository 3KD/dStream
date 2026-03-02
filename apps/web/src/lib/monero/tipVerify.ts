import type { MoneroIncomingTransfer } from "./walletRpc";
import { MoneroWalletRpcClient } from "./walletRpc";

export type XmrTipMatch = {
  amountAtomic: string;
  confirmations: number;
  confirmed: boolean;
  observedAtMs: number;
  txid?: string;
};

function pickLatest(transfers: MoneroIncomingTransfer[]): MoneroIncomingTransfer | null {
  if (!transfers.length) return null;
  return transfers.reduce((best, t) => {
    if (!best) return t;
    const a = t.timestampSec ?? 0;
    const b = best.timestampSec ?? 0;
    if (a !== b) return a > b ? t : best;
    // Tie-breaker: amount (string digits). Prefer larger.
    if (t.amountAtomic.length !== best.amountAtomic.length) return t.amountAtomic.length > best.amountAtomic.length ? t : best;
    return t.amountAtomic > best.amountAtomic ? t : best;
  }, null as MoneroIncomingTransfer | null);
}

export async function findLatestIncomingTip(opts: {
  client: MoneroWalletRpcClient;
  accountIndex: number;
  addressIndex: number;
  confirmationsRequired: number;
}): Promise<XmrTipMatch | null> {
  const accountIndex = Math.trunc(opts.accountIndex);
  const addressIndex = Math.trunc(opts.addressIndex);
  const confirmationsRequired = Math.max(0, Math.trunc(opts.confirmationsRequired));

  // Real wallet-rpc can lag transfer visibility without an explicit refresh.
  try {
    await opts.client.refresh();
  } catch {
    // Non-fatal: continue with currently visible transfers.
  }

  const incoming = await opts.client.getIncomingTransfers();
  const matches = incoming.filter((t) => t.subaddrIndex.major === accountIndex && t.subaddrIndex.minor === addressIndex);
  const latest = pickLatest(matches);
  if (!latest) return null;

  const confirmed = latest.confirmations >= confirmationsRequired;
  const observedAtMs = (latest.timestampSec ?? Math.floor(Date.now() / 1000)) * 1000;

  return {
    amountAtomic: latest.amountAtomic,
    confirmations: latest.confirmations,
    confirmed,
    observedAtMs,
    txid: latest.txid
  };
}
