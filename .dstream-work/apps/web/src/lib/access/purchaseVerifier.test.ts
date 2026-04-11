import assert from "node:assert/strict";
import test from "node:test";
import { hasExternalPurchaseVerifier, verifyExternalPurchase } from "./purchaseVerifier";

const samplePackage = {
  id: "pkg-test",
  hostPubkey: "a".repeat(64),
  streamId: "stream-test",
  resourceId: `stream:${"a".repeat(64)}:stream-test:video:*`,
  title: "Sample package",
  paymentAsset: "btc",
  paymentAmount: "0.01",
  durationHours: 24,
  status: "active",
  visibility: "public",
  metadata: {},
  createdAtSec: 1,
  updatedAtSec: 1
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

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
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
      sourceRef: "watch:source"
    });
    assert.equal(hasExternalPurchaseVerifier(), true);
    assert.equal(result.supported, true);
    assert.equal(result.verified, true);
    assert.equal(result.sourceRef, "external:tx123");
    assert.equal(result.settlementRef, "tx123");
    assert.deepEqual(result.metadata, { rail: "btc" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

