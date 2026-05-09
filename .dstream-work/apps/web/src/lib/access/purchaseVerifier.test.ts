import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { buildZapRequestUnsigned } from "../zaps";
import { hasExternalPurchaseVerifier, verifyExternalPurchase, verifyPurchaseSettlement } from "./purchaseVerifier";

const samplePackage = {
  id: "pkg-test",
  hostPubkey: "a".repeat(64),
  streamId: "stream-test",
  resourceId: `stream:${"a".repeat(64)}:stream-test:video:*`,
  title: "Sample package",
  paymentAsset: "btc",
  paymentRailId: "lightning",
  paymentAmount: "0.01",
  durationHours: 24,
  status: "active",
  visibility: "public",
  metadata: {},
  createdAtSec: 1,
  updatedAtSec: 1
} as const;

const lightningPackage = {
  ...samplePackage,
  paymentAmount: "0.000015"
} as const;

test("purchase verifier: reports unsupported when verifier URL is missing", async () => {
  delete process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_URL;
  const result = await verifyExternalPurchase({
    package: samplePackage,
    buyerPubkey: "b".repeat(64),
    buyerProofEvent: {}
  });
  assert.equal(hasExternalPurchaseVerifier(), false);
  assert.equal(result.supported, false);
  assert.equal(result.verified, false);
});

test("purchase verifier: parses verified webhook response", async () => {
  process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_URL = "https://verify.example.com";
  process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_SECRET = "top-secret";
  process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_TIMEOUT_MS = "3000";

  let requestBody: Record<string, unknown> | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        ok: true,
        verified: true,
        sourceRef: "external:tx123",
        settlementRef: "tx123",
        metadata: { rail: "btc" }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await verifyExternalPurchase({
      package: samplePackage,
      buyerPubkey: "b".repeat(64),
      buyerProofEvent: {},
      sourceRef: "watch:source",
      paymentProof: { version: 1, railId: "lightning", asset: "btc", proofType: "bolt11", settlementRef: "ln-123" },
      settlementProof: { version: 1, railId: "lightning", asset: "btc", proofType: "settlement", txRef: "tx-123" }
    });
    assert.equal(hasExternalPurchaseVerifier(), true);
    assert.equal(result.supported, true);
    assert.equal(result.verified, true);
    assert.equal(result.sourceRef, "external:tx123");
    assert.equal(result.settlementRef, "tx123");
    assert.equal(result.settlement?.railId, "lightning");
    assert.equal(result.settlement?.settlementKind, "purchase");
    assert.deepEqual(result.metadata, { rail: "btc" });
    const requestPaymentProof = requestBody ? (requestBody["paymentProof"] as { proofType?: string } | undefined) : undefined;
    const requestSettlementProof = requestBody ? (requestBody["settlementProof"] as { proofType?: string } | undefined) : undefined;
    assert.equal(requestPaymentProof?.proofType, "bolt11");
    assert.equal(requestSettlementProof?.proofType, "settlement");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("purchase verifier: verifies Lightning zap receipt proof in-tree", async () => {
  delete process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_URL;

  const buyerSecret = generateSecretKey();
  const zapperSecret = generateSecretKey();
  const buyerPubkey = getPublicKey(buyerSecret);
  const zapRequest = finalizeEvent(
    buildZapRequestUnsigned({
      senderPubkey: buyerPubkey,
      recipientPubkey: lightningPackage.hostPubkey,
      streamId: lightningPackage.streamId,
      amountSats: 1500,
      relays: ["wss://relay.example.com"],
      packageId: lightningPackage.id
    }) as any,
    buyerSecret
  );
  const receipt = finalizeEvent(
    {
      kind: 9735,
      pubkey: getPublicKey(zapperSecret),
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["p", lightningPackage.hostPubkey],
        ["bolt11", "lnbc15u1p0testzap"],
        ["description", JSON.stringify(zapRequest)]
      ],
      content: ""
    } as any,
    zapperSecret
  );

  const result = await verifyPurchaseSettlement({
    package: lightningPackage,
    buyerPubkey,
    buyerProofEvent: {},
    settlementProof: {
      version: 1,
      railId: "lightning",
      asset: "btc",
      proofType: "nip57_zap_receipt",
      payload: { receiptEvent: receipt }
    }
  });

  assert.equal(result.supported, true);
  assert.equal(result.verified, true);
  assert.equal(result.settlement?.railId, "lightning");
  assert.equal(result.settlement?.settlementKind, "nip57_zap_receipt");
  assert.equal(result.metadata?.packageId, lightningPackage.id);
});

test("purchase verifier: rejects Lightning zap receipts without matching package tag", async () => {
  delete process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_URL;

  const buyerSecret = generateSecretKey();
  const zapperSecret = generateSecretKey();
  const buyerPubkey = getPublicKey(buyerSecret);
  const zapRequest = finalizeEvent(
    buildZapRequestUnsigned({
      senderPubkey: buyerPubkey,
      recipientPubkey: lightningPackage.hostPubkey,
      streamId: lightningPackage.streamId,
      amountSats: 1500,
      relays: ["wss://relay.example.com"]
    }) as any,
    buyerSecret
  );
  const receipt = finalizeEvent(
    {
      kind: 9735,
      pubkey: getPublicKey(zapperSecret),
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["p", lightningPackage.hostPubkey],
        ["bolt11", "lnbc15u1p0badtag"],
        ["description", JSON.stringify(zapRequest)]
      ],
      content: ""
    } as any,
    zapperSecret
  );

  const result = await verifyPurchaseSettlement({
    package: lightningPackage,
    buyerPubkey,
    buyerProofEvent: {},
    settlementProof: {
      version: 1,
      railId: "lightning",
      asset: "btc",
      proofType: "nip57_zap_receipt",
      payload: { receiptEvent: receipt }
    }
  });

  assert.equal(result.supported, true);
  assert.equal(result.verified, false);
  assert.match(result.error ?? "", /package tag/i);
});
