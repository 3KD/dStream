import type { MoneroIncomingTransfer } from "./walletRpc";
import { MoneroWalletRpcClient } from "./walletRpc";

export type XmrStakeTotals = {
  totalAtomic: string;
  confirmedAtomic: string;
  transferCount: number;
  lastObservedAtMs: number | null;
  lastTxid: string | null;
};

function toBigInt(amountAtomic: string): bigint {
  if (!/^\d+$/.test(amountAtomic)) return 0n;
  try {
    return BigInt(amountAtomic);
  } catch {
    return 0n;
  }
}

function pickLatest(transfers: MoneroIncomingTransfer[]): MoneroIncomingTransfer | null {
  if (!transfers.length) return null;
  return transfers.reduce((best, t) => {
    if (!best) return t;
    const a = t.timestampSec ?? 0;
    const b = best.timestampSec ?? 0;
    if (a !== b) return a > b ? t : best;
    if (t.amountAtomic.length !== best.amountAtomic.length) return t.amountAtomic.length > best.amountAtomic.length ? t : best;
    return t.amountAtomic > best.amountAtomic ? t : best;
  }, null as MoneroIncomingTransfer | null);
}

export async function getStakeTotals(opts: {
  client: MoneroWalletRpcClient;
  accountIndex: number;
  addressIndex: number;
  confirmationsRequired: number;
}): Promise<XmrStakeTotals> {
  const accountIndex = Math.trunc(opts.accountIndex);
  const addressIndex = Math.trunc(opts.addressIndex);
  const confirmationsRequired = Math.max(0, Math.trunc(opts.confirmationsRequired));

  const incoming = await opts.client.getIncomingTransfers();
  const matches = incoming.filter(
    (t) => t.subaddrIndex.major === accountIndex && t.subaddrIndex.minor === addressIndex && t.spent !== true
  );

  let total = 0n;
  let confirmed = 0n;
  for (const t of matches) {
    total += toBigInt(t.amountAtomic);
    if (t.confirmations >= confirmationsRequired) confirmed += toBigInt(t.amountAtomic);
  }

  const latest = pickLatest(matches);
  const lastObservedAtMs = latest ? (latest.timestampSec ?? Math.floor(Date.now() / 1000)) * 1000 : null;
  const lastTxid = latest?.txid ?? null;

  return {
    totalAtomic: total.toString(),
    confirmedAtomic: confirmed.toString(),
    transferCount: matches.length,
    lastObservedAtMs,
    lastTxid
  };
}
