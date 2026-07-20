import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { evaluatePaymentCapabilities, paymentCapabilityKey, readRequiredPaymentCapabilities } from "./readiness";
import type { PaymentRailCapability } from "./types";

const originalRequired = process.env.DSTREAM_REQUIRED_PAYMENT_CAPABILITIES;

afterEach(() => {
  if (originalRequired === undefined) delete process.env.DSTREAM_REQUIRED_PAYMENT_CAPABILITIES;
  else process.env.DSTREAM_REQUIRED_PAYMENT_CAPABILITIES = originalRequired;
});

const capabilities: PaymentRailCapability[] = [
  {
    asset: "btc",
    railId: "lightning",
    network: "lightning:mainnet",
    configured: true,
    confirmationsRequired: 1,
    verifier: "lnurl_nip57"
  },
  {
    asset: "eth",
    railId: "evm",
    network: "ethereum:mainnet",
    configured: false,
    confirmationsRequired: 12,
    verifier: "json_rpc",
    reason: "RPC missing"
  }
];

test("payment readiness marks required capabilities and reports missing rails", () => {
  process.env.DSTREAM_REQUIRED_PAYMENT_CAPABILITIES = "btc:lightning, eth:evm";
  assert.deepEqual(readRequiredPaymentCapabilities(), ["btc:lightning", "eth:evm"]);
  const readiness = evaluatePaymentCapabilities(capabilities);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, ["eth:evm"]);
  assert.equal(readiness.capabilities.every((capability) => capability.required), true);
});

test("payment readiness succeeds when every required verifier is configured", () => {
  process.env.DSTREAM_REQUIRED_PAYMENT_CAPABILITIES = "btc:lightning";
  const readiness = evaluatePaymentCapabilities(capabilities);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missing, []);
  assert.equal(paymentCapabilityKey(capabilities[0]!), "btc:lightning");
});
