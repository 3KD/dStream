export type RefundContributionReceipt = {
  id: string | null;
  pubkey: string;
  fromPubkey: string;
  servedBytes: number;
  observedAtMs: number;
  createdAtSec: number;
  sessionId: string | null;
};

export type RefundPolicyConfig = {
  minServedBytes: number;
  fullServedBytes: number;
  maxReceipts: number;
  maxReceiptAgeSec: number;
  maxServedBytesPerReceipt: number;
  minSessionAgeSec: number;
  maxFutureSkewSec?: number;
};

export type RefundPolicyResult = {
  ok: boolean;
  reason: string | null;
  servedBytes: number;
  acceptedReceipts: number;
  rejectedReceipts: number;
  creditPercentBps: number;
};

function clampBps(input: number): number {
  if (!Number.isFinite(input)) return 0;
  return Math.max(0, Math.min(10_000, Math.trunc(input)));
}

function makeReceiptDedupKey(receipt: RefundContributionReceipt): string {
  if (receipt.id && receipt.id.trim()) return `id:${receipt.id.trim()}`;
  return `raw:${receipt.pubkey}:${receipt.fromPubkey}:${receipt.sessionId ?? ""}:${receipt.createdAtSec}:${receipt.observedAtMs}:${receipt.servedBytes}`;
}

export function evaluateRefundPolicy(opts: {
  receipts: RefundContributionReceipt[];
  viewerPubkey: string;
  sessionToken: string;
  sessionCreatedAtMs: number;
  nowMs: number;
  cfg: RefundPolicyConfig;
}): RefundPolicyResult {
  const cfg = opts.cfg;
  const nowMs = Math.max(0, Math.trunc(opts.nowMs));
  const nowSec = Math.floor(nowMs / 1000);
  const maxFutureSkewSec = Math.max(0, Math.trunc(cfg.maxFutureSkewSec ?? 45));
  const minServedBytes = Math.max(0, Math.trunc(cfg.minServedBytes));
  const fullServedBytes = Math.max(minServedBytes, Math.trunc(cfg.fullServedBytes));
  const maxReceipts = Math.max(1, Math.trunc(cfg.maxReceipts));
  const maxReceiptAgeSec = Math.max(0, Math.trunc(cfg.maxReceiptAgeSec));
  const maxServedBytesPerReceipt = Math.max(1, Math.trunc(cfg.maxServedBytesPerReceipt));
  const minSessionAgeSec = Math.max(0, Math.trunc(cfg.minSessionAgeSec));
  const viewerPubkey = opts.viewerPubkey.trim().toLowerCase();
  const sessionToken = opts.sessionToken.trim();

  if (!viewerPubkey || !sessionToken) {
    return {
      ok: false,
      reason: "invalid_session_inputs",
      servedBytes: 0,
      acceptedReceipts: 0,
      rejectedReceipts: 0,
      creditPercentBps: 0
    };
  }

  const sessionAgeSec = Math.max(0, Math.floor((nowMs - Math.trunc(opts.sessionCreatedAtMs)) / 1000));
  if (sessionAgeSec < minSessionAgeSec) {
    return {
      ok: false,
      reason: "session_too_new",
      servedBytes: 0,
      acceptedReceipts: 0,
      rejectedReceipts: opts.receipts.length,
      creditPercentBps: 0
    };
  }

  if (opts.receipts.length > maxReceipts) {
    return {
      ok: false,
      reason: "too_many_receipts",
      servedBytes: 0,
      acceptedReceipts: 0,
      rejectedReceipts: opts.receipts.length,
      creditPercentBps: 0
    };
  }

  const dedup = new Set<string>();
  let servedBytes = 0;
  let acceptedReceipts = 0;
  let rejectedReceipts = 0;

  for (const receipt of opts.receipts) {
    const dedupKey = makeReceiptDedupKey(receipt);
    if (dedup.has(dedupKey)) {
      rejectedReceipts += 1;
      continue;
    }
    dedup.add(dedupKey);

    const pubkey = receipt.pubkey.trim().toLowerCase();
    const fromPubkey = receipt.fromPubkey.trim().toLowerCase();
    if (pubkey !== viewerPubkey || fromPubkey !== viewerPubkey) {
      rejectedReceipts += 1;
      continue;
    }

    const receiptSessionId = (receipt.sessionId ?? "").trim();
    if (!receiptSessionId || receiptSessionId !== sessionToken) {
      rejectedReceipts += 1;
      continue;
    }

    const createdAtSec = Math.trunc(receipt.createdAtSec);
    if (!Number.isFinite(createdAtSec)) {
      rejectedReceipts += 1;
      continue;
    }
    if (Math.abs(nowSec - createdAtSec) > maxReceiptAgeSec + maxFutureSkewSec) {
      rejectedReceipts += 1;
      continue;
    }

    const observedAtMs = Math.trunc(receipt.observedAtMs);
    if (!Number.isFinite(observedAtMs) || observedAtMs <= 0) {
      rejectedReceipts += 1;
      continue;
    }
    if (observedAtMs + maxReceiptAgeSec * 1000 < nowMs) {
      rejectedReceipts += 1;
      continue;
    }
    if (observedAtMs < Math.trunc(opts.sessionCreatedAtMs) - maxFutureSkewSec * 1000) {
      rejectedReceipts += 1;
      continue;
    }
    if (observedAtMs > nowMs + maxFutureSkewSec * 1000) {
      rejectedReceipts += 1;
      continue;
    }

    const served = Math.trunc(receipt.servedBytes);
    if (!Number.isFinite(served) || served < 0 || served > maxServedBytesPerReceipt) {
      rejectedReceipts += 1;
      continue;
    }

    servedBytes += served;
    acceptedReceipts += 1;
  }

  const creditPercentBps =
    fullServedBytes <= 0 ? 10_000 : clampBps(Math.floor((servedBytes * 10_000) / Math.max(1, fullServedBytes)));
  const ok = servedBytes >= minServedBytes;

  return {
    ok,
    reason: ok ? null : "served_bytes_below_minimum",
    servedBytes,
    acceptedReceipts,
    rejectedReceipts,
    creditPercentBps
  };
}
