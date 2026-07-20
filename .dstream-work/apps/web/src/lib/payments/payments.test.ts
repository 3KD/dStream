import assert from "node:assert/strict";
import { test } from "node:test";
import { PAYMENT_ASSET_ORDER, buildPaymentUri, comparePaymentAssetOrder } from "./catalog";
import { coercePaymentMethods, createPaymentMethodDraft, type PaymentMethodDraft, validatePaymentMethodDrafts } from "./methods";
import { getPublicPaymentAssets } from "./publicAssets";
import { PAYMENT_RAILS, getPaymentRailForAsset, getPaymentRailForMethod, groupPaymentMethodsByRail } from "./rails";

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
  assert.equal(buildPaymentUri({ asset: "btc", address: "alice@getalby.com", network: "lightning" }), null);
  assert.equal(
    buildPaymentUri({ asset: "btc", address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", amount: "0.00025" }),
    "bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.00025"
  );
  assert.equal(
    buildPaymentUri({ asset: "eth", address: "0x1111111111111111111111111111111111111111", network: "ethereum" }),
    "ethereum:0x1111111111111111111111111111111111111111@1"
  );
  assert.equal(
    buildPaymentUri({ asset: "eth", address: "0x1111111111111111111111111111111111111111", network: "ethereum", amount: "0.25" }),
    "ethereum:0x1111111111111111111111111111111111111111@1?value=250000000000000000"
  );
  assert.equal(buildPaymentUri({ asset: "trx", address: "TXVTmM7in6PZLJ7uH1WfLYv9XKLhFLxnkF" }), "tron:TXVTmM7in6PZLJ7uH1WfLYv9XKLhFLxnkF");
  assert.equal(
    buildPaymentUri({ asset: "trx", address: "TXVTmM7in6PZLJ7uH1WfLYv9XKLhFLxnkF", amount: "12.5" }),
    "tron:TXVTmM7in6PZLJ7uH1WfLYv9XKLhFLxnkF?amount=12.5"
  );
});

test("validatePaymentMethodDrafts accepts BTC lightning payloads", () => {
  const drafts: PaymentMethodDraft[] = [
    {
      ...createPaymentMethodDraft("btc"),
      asset: "btc",
      address: "lnurl1dp68gurn8ghj7mrww4exctnrdakj7mr0v9uxzmtsd3skw0f5xqcrqvpsxqrrss",
      amount: "2500"
    },
    {
      ...createPaymentMethodDraft("btc"),
      asset: "btc",
      address: "alice@getalby.com",
      network: "lightning",
      amount: "1000"
    }
  ];
  const result = validatePaymentMethodDrafts(drafts);
  assert.equal(result.errors.length, 0);
  assert.equal(result.methods.length, 2);
  assert.equal(result.methods[0]?.amount, "2500");
  assert.equal(result.methods[1]?.amount, "1000");
});

test("validatePaymentMethodDrafts rejects invalid payment amounts", () => {
  const drafts: PaymentMethodDraft[] = [
    {
      ...createPaymentMethodDraft("btc"),
      asset: "btc",
      address: "alice@getalby.com",
      network: "lightning",
      amount: "10.5"
    },
    {
      ...createPaymentMethodDraft("eth"),
      asset: "eth",
      address: "0x1111111111111111111111111111111111111111",
      amount: "0"
    }
  ];
  const result = validatePaymentMethodDrafts(drafts);
  assert.equal(result.methods.length, 0);
  assert.equal(result.errors.length, 2);
});

test("token address validation follows the selected chain", () => {
  const solanaAddress = "So11111111111111111111111111111111111111112";
  const result = validatePaymentMethodDrafts([
    { asset: "usdt", address: "TH5oqaJWYnVZCCPktHvcsm8aaPUeAXzrTY", network: "tron", label: "", amount: "1" },
    { asset: "usdc", address: solanaAddress, network: "solana", label: "", amount: "2" }
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.methods[1]?.address, solanaAddress);
});

test("payment URIs preserve token identity and network", () => {
  const evmRecipient = "0x1111111111111111111111111111111111111111";
  assert.equal(
    buildPaymentUri({ asset: "usdt", address: evmRecipient, network: "ethereum", amount: "1.5" }),
    "ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7@1/transfer?address=0x1111111111111111111111111111111111111111&uint256=1500000"
  );
  assert.equal(
    buildPaymentUri({ asset: "usdt", address: "TH5oqaJWYnVZCCPktHvcsm8aaPUeAXzrTY", network: "tron", amount: "2" }),
    "tron:TH5oqaJWYnVZCCPktHvcsm8aaPUeAXzrTY?amount=2&token=USDT"
  );
  assert.equal(
    buildPaymentUri({ asset: "ada", address: `addr1${"q".repeat(54)}`, amount: "3" }),
    `web+cardano:addr1${"q".repeat(54)}?amount=3000000`
  );
  assert.equal(
    buildPaymentUri({ asset: "xrp", address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", amount: "4" }),
    "https://xaman.app/detect/request:rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh?amount=4&network=XRPL"
  );
});

test("token amount validation matches six-decimal settlement adapters", () => {
  const result = validatePaymentMethodDrafts([
    {
      asset: "usdt",
      address: "0x1111111111111111111111111111111111111111",
      network: "ethereum",
      label: "",
      amount: "1.0000001"
    }
  ]);
  assert.equal(result.methods.length, 0);
  assert.match(result.errors[0] ?? "", /up to 6 decimals/);
});

test("payment asset default order prioritizes XMR then BTC", () => {
  assert.equal(PAYMENT_ASSET_ORDER[0], "xmr");
  assert.equal(PAYMENT_ASSET_ORDER[1], "btc");
  assert.ok(comparePaymentAssetOrder("xmr", "eth") < 0);
  assert.ok(comparePaymentAssetOrder("btc", "eth") < 0);
});

test("public payment asset allowlist hides dormant adapters", () => {
  const original = process.env.DSTREAM_PUBLIC_PAYMENT_ASSETS;
  process.env.DSTREAM_PUBLIC_PAYMENT_ASSETS = "xmr,btc,unknown";
  try {
    assert.deepEqual(getPublicPaymentAssets(), ["xmr", "btc"]);
  } finally {
    if (original === undefined) delete process.env.DSTREAM_PUBLIC_PAYMENT_ASSETS;
    else process.env.DSTREAM_PUBLIC_PAYMENT_ASSETS = original;
  }
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
  assert.deepEqual(getPaymentRailForAsset("btc").verifiedAssets, ["btc", "doge", "bch"]);
  assert.deepEqual(getPaymentRailForAsset("eth").verifiedAssets, ["eth", "usdt", "usdc", "pepe"]);
  assert.deepEqual(getPaymentRailForAsset("trx").verifiedAssets, ["trx", "usdt"]);
});

test("payment rails classify BTC on-chain vs Lightning", () => {
  assert.equal(getPaymentRailForMethod({ asset: "btc", address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" }).id, "utxo");
  assert.equal(getPaymentRailForMethod({ asset: "btc", address: "alice@getalby.com", network: "lightning" }).id, "lightning");
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
