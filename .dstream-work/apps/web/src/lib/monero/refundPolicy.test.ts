import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRefundPolicy, type RefundContributionReceipt } from "./refundPolicy";

const VIEWER = "a".repeat(64);
const SESSION_TOKEN = "session-token";
const BASE_NOW_MS = 1_700_000_000_000;

function makeReceipt(input?: Partial<RefundContributionReceipt>): RefundContributionReceipt {
  return {
    id: "receipt-1",
    pubkey: VIEWER,
    fromPubkey: VIEWER,
    servedBytes: 2048,
    observedAtMs: BASE_NOW_MS - 5_000,
    createdAtSec: Math.floor(BASE_NOW_MS / 1000) - 5,
    sessionId: SESSION_TOKEN,
    ...input
  };
}

function runPolicy(receipts: RefundContributionReceipt[]) {
  return evaluateRefundPolicy({
    receipts,
    viewerPubkey: VIEWER,
    sessionToken: SESSION_TOKEN,
    sessionCreatedAtMs: BASE_NOW_MS - 120_000,
    nowMs: BASE_NOW_MS,
    cfg: {
      minServedBytes: 1024,
      fullServedBytes: 4096,
      maxReceipts: 8,
      maxReceiptAgeSec: 300,
      maxServedBytesPerReceipt: 1_000_000,
      minSessionAgeSec: 30
    }
  });
}

test("refund policy accepts valid receipts and computes credit bps", () => {
  const result = runPolicy([makeReceipt({ servedBytes: 2048 }), makeReceipt({ id: "receipt-2", servedBytes: 1024 })]);
  assert.equal(result.ok, true);
  assert.equal(result.servedBytes, 3072);
  assert.equal(result.acceptedReceipts, 2);
  assert.equal(result.rejectedReceipts, 0);
  assert.equal(result.creditPercentBps, 7500);
});

test("refund policy rejects mismatched session id", () => {
  const result = runPolicy([makeReceipt({ sessionId: "wrong-session" })]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "served_bytes_below_minimum");
  assert.equal(result.acceptedReceipts, 0);
  assert.equal(result.rejectedReceipts, 1);
});

test("refund policy rejects duplicate receipts", () => {
  const first = makeReceipt({ id: "dup-receipt", servedBytes: 600 });
  const second = makeReceipt({ id: "dup-receipt", servedBytes: 600 });
  const result = runPolicy([first, second]);
  assert.equal(result.ok, false);
  assert.equal(result.servedBytes, 600);
  assert.equal(result.acceptedReceipts, 1);
  assert.equal(result.rejectedReceipts, 1);
});

test("refund policy rejects receipts outside age window", () => {
  const old = makeReceipt({
    id: "old-receipt",
    observedAtMs: BASE_NOW_MS - 301_000,
    createdAtSec: Math.floor(BASE_NOW_MS / 1000) - 301
  });
  const result = runPolicy([old]);
  assert.equal(result.ok, false);
  assert.equal(result.acceptedReceipts, 0);
  assert.equal(result.rejectedReceipts, 1);
});

test("refund policy enforces minimum session age", () => {
  const result = evaluateRefundPolicy({
    receipts: [makeReceipt()],
    viewerPubkey: VIEWER,
    sessionToken: SESSION_TOKEN,
    sessionCreatedAtMs: BASE_NOW_MS - 5_000,
    nowMs: BASE_NOW_MS,
    cfg: {
      minServedBytes: 1,
      fullServedBytes: 1,
      maxReceipts: 8,
      maxReceiptAgeSec: 300,
      maxServedBytesPerReceipt: 1_000_000,
      minSessionAgeSec: 30
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "session_too_new");
});
