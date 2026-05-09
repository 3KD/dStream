import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPaymentOperatorEndpointAllowed,
  defaultPaymentSessionProofMode,
  readVideoPackagePaymentSessionConfig,
  resolveVideoPackageRailId
} from "./paymentSessionConfig";

const samplePackage = {
  id: "pkg-1",
  hostPubkey: "a".repeat(64),
  streamId: "stream-1",
  resourceId: `stream:${"a".repeat(64)}:stream-1:video:*`,
  title: "Package",
  paymentAsset: "btc" as const,
  paymentAmount: "0.0001",
  paymentRailId: "lightning",
  paymentTarget: {
    version: 1 as const,
    railId: "lightning" as const,
    asset: "btc" as const,
    destination: "creator@dstream.test",
    network: "lightning"
  },
  durationHours: 24,
  status: "active" as const,
  visibility: "public" as const,
  metadata: {},
  createdAtSec: 1,
  updatedAtSec: 1
};

test("payment session config: defaults rails and proof modes coherently", () => {
  assert.equal(resolveVideoPackageRailId(samplePackage), "lightning");
  assert.equal(defaultPaymentSessionProofMode("evm"), "client_tx_ref");
  assert.equal(defaultPaymentSessionProofMode("utxo"), "operator_observed");
});

test("payment session config: metadata overrides operator endpoint and proof mode", () => {
  const config = readVideoPackagePaymentSessionConfig({
    ...samplePackage,
    metadata: {
      paymentSession: {
        operatorEndpoint: "https://node-operator.example",
        operatorLabel: "Host node",
        proofMode: "operator_observed"
      }
    }
  });

  assert.equal(config.enabled, true);
  assert.equal(config.transport, "http");
  assert.equal(config.authority, "node_operator");
  assert.equal(config.operatorEndpoint, "https://node-operator.example");
  assert.equal(config.operatorLabel, "Host node");
  assert.equal(config.proofMode, "operator_observed");
});

test("payment session config: rejects unsafe operator endpoints", () => {
  assert.doesNotThrow(() => assertPaymentOperatorEndpointAllowed("https://node-operator.example/api/payment-operator"));
  assert.throws(() => assertPaymentOperatorEndpointAllowed("ftp://node-operator.example"), /http or https/);
  assert.throws(() => assertPaymentOperatorEndpointAllowed("https://user:pass@node-operator.example"), /must not embed credentials/);
  assert.throws(() => assertPaymentOperatorEndpointAllowed("https://node-operator.example/operator?token=secret"), /query string/);

  const previousHardenMode = process.env.HARDEN_MODE;
  process.env.HARDEN_MODE = "deploy";
  try {
    assert.throws(() => assertPaymentOperatorEndpointAllowed("http://node-operator.example"), /must use https/);
    assert.doesNotThrow(() => assertPaymentOperatorEndpointAllowed("http://localhost:3000/api/payment-operator"));
  } finally {
    if (previousHardenMode === undefined) delete process.env.HARDEN_MODE;
    else process.env.HARDEN_MODE = previousHardenMode;
  }
});

test("payment session config: xmr and remote-operator packages enable sessions without a static target", () => {
  const xmrConfig = readVideoPackagePaymentSessionConfig({
    ...samplePackage,
    paymentAsset: "xmr",
    paymentRailId: "xmr",
    paymentTarget: undefined,
    metadata: {}
  });
  assert.equal(xmrConfig.enabled, true);
  assert.equal(xmrConfig.transport, "embedded");
  assert.equal(xmrConfig.proofMode, "operator_observed");

  const remoteConfig = readVideoPackagePaymentSessionConfig({
    ...samplePackage,
    paymentTarget: undefined,
    metadata: {
      paymentSession: {
        operatorEndpoint: "https://node-operator.example"
      }
    }
  });
  assert.equal(remoteConfig.enabled, true);
  assert.equal(remoteConfig.transport, "http");
  assert.equal(remoteConfig.proofMode, "operator_observed");

  const remoteEvmConfig = readVideoPackagePaymentSessionConfig({
    ...samplePackage,
    paymentAsset: "eth",
    paymentRailId: "evm",
    paymentTarget: undefined,
    metadata: {
      paymentSession: {
        operatorEndpoint: "https://node-operator.example"
      }
    }
  });
  assert.equal(remoteEvmConfig.enabled, true);
  assert.equal(remoteEvmConfig.transport, "http");
  assert.equal(remoteEvmConfig.proofMode, "operator_observed");
});
