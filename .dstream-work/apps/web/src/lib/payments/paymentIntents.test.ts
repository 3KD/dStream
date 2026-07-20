import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { StreamPaymentMethod } from "@dstream/protocol";
import {
  PaymentIntentClientError,
  capabilityForMethod,
  createTipPaymentIntent,
  isPendingPaymentVerification,
  paymentMethodFromIntent,
  verifyPaymentIntent
} from "./paymentIntents";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const intent = {
  id: "intent-1",
  scope: { type: "tip" as const, id: "creator:stream", streamPubkey: "a".repeat(64), streamId: "stream" },
  buyerPubkey: "b".repeat(64),
  recipientPubkey: "a".repeat(64),
  asset: "eth" as const,
  railId: "evm" as const,
  network: "ethereum",
  address: "0x1111111111111111111111111111111111111111",
  amount: "0.25",
  status: "pending" as const,
  createdAtSec: 1,
  expiresAtSec: 1000
};

test("createTipPaymentIntent binds the creator, stream, rail, and exact amount", async () => {
  let payload: any = null;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true, intent, secret: "secret" }), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  };
  const method: StreamPaymentMethod = {
    asset: "eth",
    network: "ethereum",
    address: intent.address
  };
  const result = await createTipPaymentIntent({
    buyerProofEvent: { id: "proof" } as any,
    recipientPubkey: intent.recipientPubkey,
    streamId: "stream",
    method,
    amount: "0.25"
  });
  assert.equal(result.secret, "secret");
  assert.deepEqual(
    {
      scopeType: payload.scopeType,
      recipientPubkey: payload.recipientPubkey,
      streamId: payload.streamId,
      asset: payload.asset,
      address: payload.address,
      amount: payload.amount,
      paymentRailId: payload.paymentRailId
    },
    {
      scopeType: "tip",
      recipientPubkey: intent.recipientPubkey,
      streamId: "stream",
      asset: "eth",
      address: intent.address,
      amount: "0.25",
      paymentRailId: "evm"
    }
  );
});

test("verifyPaymentIntent submits only the intent secret and settlement proof", async () => {
  let payload: any = null;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true, intent: { ...intent, status: "settled" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const result = await verifyPaymentIntent({
    credentials: { intent, secret: "secret" },
    proof: { txId: "c".repeat(64) }
  });
  assert.equal(result.status, "settled");
  assert.deepEqual(payload, { secret: "secret", proof: { txId: "c".repeat(64) } });
});

test("402 verifier responses remain retryable", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: "Waiting for confirmations." }), {
      status: 402,
      headers: { "content-type": "application/json" }
    });
  await assert.rejects(
    () => verifyPaymentIntent({ credentials: { intent, secret: "secret" }, proof: { txId: "c".repeat(64) } }),
    (error) => {
      assert.equal(isPendingPaymentVerification(error), true);
      assert.equal((error as PaymentIntentClientError).status, 402);
      return true;
    }
  );
});

test("capability and canonical intent helpers preserve rail terms", () => {
  const method: StreamPaymentMethod = { asset: "eth", address: intent.address, network: "ethereum" };
  const capability = capabilityForMethod(method, [
    {
      asset: "eth",
      railId: "evm",
      network: "ethereum:mainnet",
      configured: true,
      confirmationsRequired: 12,
      verifier: "json_rpc"
    }
  ]);
  assert.equal(capability?.configured, true);
  assert.deepEqual(paymentMethodFromIntent(intent), {
    asset: "eth",
    address: intent.address,
    network: "ethereum",
    amount: "0.25"
  });
});
