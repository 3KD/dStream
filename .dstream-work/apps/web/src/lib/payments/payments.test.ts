import assert from "node:assert/strict";
import { test } from "node:test";
import { PAYMENT_ASSET_ORDER, buildPaymentUri, comparePaymentAssetOrder } from "./catalog";
import { coercePaymentMethods, createPaymentMethodDraft, type PaymentMethodDraft, validatePaymentMethodDrafts } from "./methods";
import { PAYMENT_RAILS, getPaymentRailForAsset, groupPaymentMethodsByRail } from "./rails";

test("validatePaymentMethodDrafts accepts supported addresses", () => {
  const drafts: PaymentMethodDraft[] = [
    {
      ...createPaymentMethodDraft("eth"),
      asset: "eth",
      address: "0x1111111111111111111111111111111111111111",
      network: "ethereum",
      label: "EVM"
    },
    {
      ...createPaymentMethodDraft("btc"),
      asset: "btc",
      address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
    }
  ];
  const result = validatePaymentMethodDrafts(drafts);
  assert.equal(result.errors.length, 0);
  assert.equal(result.methods.length, 2);
});

test("validatePaymentMethodDrafts rejects invalid address", () => {
  const drafts: PaymentMethodDraft[] = [
    {
      ...createPaymentMethodDraft("xrp"),
      asset: "xrp",
      address: "invalid_xrp_address"
    }
  ];
  const result = validatePaymentMethodDrafts(drafts);
  assert.equal(result.methods.length, 0);
  assert.equal(result.errors.length, 1);
});

test("coercePaymentMethods keeps valid methods only", () => {
  const methods = coercePaymentMethods([
    { asset: "xmr", address: "44AFFq5kSiGBoZ...invalid" },
    { asset: "eth", address: "0x1111111111111111111111111111111111111111", network: "ethereum" }
  ]);
  assert.deepEqual(methods, [{ asset: "eth", address: "0x1111111111111111111111111111111111111111", network: "ethereum", label: undefined }]);
});

test("buildPaymentUri emits scheme URIs for supported assets", () => {
  assert.equal(buildPaymentUri({ asset: "btc", address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" }), "bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  assert.equal(
    buildPaymentUri({ asset: "eth", address: "0x1111111111111111111111111111111111111111", network: "ethereum" }),
    "ethereum:0x1111111111111111111111111111111111111111?chain=ethereum"
  );
});

test("payment asset default order prioritizes XMR then BTC", () => {
  assert.equal(PAYMENT_ASSET_ORDER[0], "xmr");
  assert.equal(PAYMENT_ASSET_ORDER[1], "btc");
  assert.ok(comparePaymentAssetOrder("xmr", "eth") < 0);
  assert.ok(comparePaymentAssetOrder("btc", "eth") < 0);
});

test("payment rails map expected assets", () => {
  assert.equal(getPaymentRailForAsset("xmr").id, "xmr");
  assert.equal(getPaymentRailForAsset("btc").id, "utxo");
  assert.equal(getPaymentRailForAsset("eth").id, "evm");
  assert.equal(getPaymentRailForAsset("trx").id, "tron");
  assert.equal(getPaymentRailForAsset("sol").id, "solana");
  assert.equal(getPaymentRailForAsset("xrp").id, "xrpl");
  assert.equal(getPaymentRailForAsset("ada").id, "cardano");
  assert.ok(PAYMENT_RAILS.length >= 6);
});

test("groupPaymentMethodsByRail groups by rail order", () => {
  const groups = groupPaymentMethodsByRail([
    { asset: "eth", address: "0x1111111111111111111111111111111111111111" },
    { asset: "btc", address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" },
    { asset: "doge", address: "D5jYjWcsf8P7T7TvM8S46HoPazTAp3GEXL" }
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.rail.id, "utxo");
  assert.equal(groups[0]?.methods.length, 2);
  assert.equal(groups[1]?.rail.id, "evm");
  assert.equal(groups[1]?.methods.length, 1);
});
