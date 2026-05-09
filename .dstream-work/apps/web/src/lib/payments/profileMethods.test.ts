import assert from "node:assert/strict";
import { test } from "node:test";
import { paymentMethodsFromProfile } from "./profileMethods";

test("paymentMethodsFromProfile maps supported profile fields to canonical methods", () => {
  const methods = paymentMethodsFromProfile({
    lud16: "creator@getalby.com",
    btc: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    eth: "0x1111111111111111111111111111111111111111",
    xmr: "47zQ5sHk1Q2J7u4w7D6zw9uWq5FMvx6bMpiKFFnzvolGZrxhgbf28pQ5e8siJmq9hw3rrodpAtxEvsCzorBpvyEukgqS8bL",
    xrp: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    ton: "ton-not-supported",
    dot: "dot-not-supported",
    ltc: "ltc-not-supported"
  });

  assert.deepEqual(methods, [
    {
      asset: "xmr",
      address: "47zQ5sHk1Q2J7u4w7D6zw9uWq5FMvx6bMpiKFFnzvolGZrxhgbf28pQ5e8siJmq9hw3rrodpAtxEvsCzorBpvyEukgqS8bL",
      network: undefined,
      label: undefined
    },
    {
      asset: "btc",
      address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      network: undefined,
      label: undefined
    },
    {
      asset: "btc",
      address: "creator@getalby.com",
      network: "lightning",
      label: "Lightning (NIP-57)"
    },
    {
      asset: "eth",
      address: "0x1111111111111111111111111111111111111111",
      network: undefined,
      label: undefined
    },
    {
      asset: "xrp",
      address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
      network: undefined,
      label: undefined
    }
  ]);
});

test("paymentMethodsFromProfile prefers LUD-16 over LUD-06 when both exist", () => {
  const methods = paymentMethodsFromProfile({
    lud16: "creator@getalby.com",
    lud06: "lnurl1dp68gurn8ghj7mrww4exctnrdakj7mr0v9uxzmtsd3skw0f5xqcrqvpsxqrrss"
  });

  assert.equal(methods.length, 1);
  assert.deepEqual(methods[0], {
    asset: "btc",
    address: "creator@getalby.com",
    network: "lightning",
    label: "Lightning (NIP-57)"
  });
});
