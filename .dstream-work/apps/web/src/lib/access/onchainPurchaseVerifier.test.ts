import assert from "node:assert/strict";
import test from "node:test";
import type { PaymentRailId, PaymentSettlementTarget, StreamPaymentAsset } from "@dstream/protocol";
import { verifyOnchainPurchase } from "./onchainPurchaseVerifier";

const hostPubkey = "a".repeat(64);
const streamId = "stream-1";

function buildPackage(input: {
  id: string;
  paymentAsset: StreamPaymentAsset;
  paymentAmount: string;
  paymentRailId: PaymentRailId;
  paymentTarget: PaymentSettlementTarget;
}) {
  return {
    id: input.id,
    hostPubkey,
    streamId,
    resourceId: `stream:${hostPubkey}:${streamId}:video:*`,
    title: input.id,
    paymentAsset: input.paymentAsset,
    paymentAmount: input.paymentAmount,
    paymentRailId: input.paymentRailId,
    paymentTarget: input.paymentTarget,
    durationHours: 24,
    status: "active",
    visibility: "public",
    metadata: {},
    createdAtSec: 1,
    updatedAtSec: 1
  } as const;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("on-chain purchase verifier: verifies EVM native transfers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    if (request.method === "eth_getTransactionByHash") {
      return jsonResponse({
        result: {
          to: "0x1111111111111111111111111111111111111111",
          from: "0x9999999999999999999999999999999999999999",
          value: "0x6f05b59d3b20000"
        }
      });
    }
    if (request.method === "eth_getTransactionReceipt") {
      return jsonResponse({
        result: {
          status: "0x1",
          blockNumber: "0x10"
        }
      });
    }
    return jsonResponse({ error: { message: "unexpected method" } }, 500);
  }) as typeof fetch;

  try {
    const result = await verifyOnchainPurchase({
      package: buildPackage({
        id: "pkg-evm-native",
        paymentAsset: "eth",
        paymentAmount: "0.5",
        paymentRailId: "evm",
        paymentTarget: {
          version: 1,
          railId: "evm",
          asset: "eth",
          destination: "0x1111111111111111111111111111111111111111",
          network: "ethereum"
        }
      }),
      settlementProof: {
        version: 1,
        railId: "evm",
        asset: "eth",
        proofType: "transaction_reference",
        txRef: "0xabc",
        network: "ethereum"
      }
    });

    assert.equal(result.supported, true);
    assert.equal(result.verified, true);
    assert.equal(result.settlement?.settlementKind, "evm_native_transfer");
    assert.equal(result.settlement?.amountAtomic, "500000000000000000");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("on-chain purchase verifier: verifies EVM ERC-20 transfers", async () => {
  const originalFetch = globalThis.fetch;
  const recipient = "0x2222222222222222222222222222222222222222";
  const amountAtomic = 1_250_000n;
  const inputData = `0xa9059cbb${recipient.replace(/^0x/, "").padStart(64, "0")}${amountAtomic.toString(16).padStart(64, "0")}`;
  globalThis.fetch = (async (_input, init) => {
    const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    if (request.method === "eth_getTransactionByHash") {
      return jsonResponse({
        result: {
          to: "0xdac17f958d2ee523a2206206994597c13d831ec7",
          from: "0x9999999999999999999999999999999999999999",
          input: inputData
        }
      });
    }
    if (request.method === "eth_getTransactionReceipt") {
      return jsonResponse({
        result: {
          status: "0x1",
          blockNumber: "0x10"
        }
      });
    }
    return jsonResponse({ error: { message: "unexpected method" } }, 500);
  }) as typeof fetch;

  try {
    const result = await verifyOnchainPurchase({
      package: buildPackage({
        id: "pkg-evm-usdt",
        paymentAsset: "usdt",
        paymentAmount: "1.25",
        paymentRailId: "evm",
        paymentTarget: {
          version: 1,
          railId: "evm",
          asset: "usdt",
          destination: recipient,
          network: "ethereum"
        }
      }),
      settlementProof: {
        version: 1,
        railId: "evm",
        asset: "usdt",
        proofType: "transaction_reference",
        txRef: "0xdef",
        network: "ethereum"
      }
    });

    assert.equal(result.supported, true);
    assert.equal(result.verified, true);
    assert.equal(result.settlement?.settlementKind, "evm_erc20_transfer");
    assert.equal(result.settlement?.amountAtomic, "1250000");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("on-chain purchase verifier: verifies Solana native transfers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    jsonResponse({
      result: {
        meta: { err: null },
        transaction: {
          message: {
            instructions: [
              {
                program: "system",
                parsed: {
                  type: "transfer",
                  info: {
                    destination: "So11111111111111111111111111111111111111112",
                    lamports: 10000000
                  }
                }
              }
            ]
          }
        }
      }
    })) as typeof fetch;

  try {
    const result = await verifyOnchainPurchase({
      package: buildPackage({
        id: "pkg-sol",
        paymentAsset: "sol",
        paymentAmount: "0.01",
        paymentRailId: "solana",
        paymentTarget: {
          version: 1,
          railId: "solana",
          asset: "sol",
          destination: "So11111111111111111111111111111111111111112",
          network: "mainnet-beta"
        }
      }),
      settlementProof: {
        version: 1,
        railId: "solana",
        asset: "sol",
        proofType: "transaction_reference",
        txRef: "5SxExampleSignature",
        network: "mainnet-beta"
      }
    });

    assert.equal(result.supported, true);
    assert.equal(result.verified, true);
    assert.equal(result.settlement?.settlementKind, "solana_native_transfer");
    assert.equal(result.settlement?.amountAtomic, "10000000");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("on-chain purchase verifier: verifies TRON native transfers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/wallet/gettransactionbyid")) {
      return jsonResponse({
        raw_data: {
          contract: [
            {
              parameter: {
                value: {
                  to_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                  amount: 2500000
                }
              }
            }
          ]
        },
        ret: [{ contractRet: "SUCCESS" }]
      });
    }
    if (url.includes("/walletsolidity/gettransactioninfobyid")) {
      return jsonResponse({
        blockNumber: 100,
        receipt: { result: "SUCCESS" }
      });
    }
    return jsonResponse({ error: "unexpected url" }, 500);
  }) as typeof fetch;

  try {
    const result = await verifyOnchainPurchase({
      package: buildPackage({
        id: "pkg-trx",
        paymentAsset: "trx",
        paymentAmount: "2.5",
        paymentRailId: "tron",
        paymentTarget: {
          version: 1,
          railId: "tron",
          asset: "trx",
          destination: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          network: "tron"
        }
      }),
      settlementProof: {
        version: 1,
        railId: "tron",
        asset: "trx",
        proofType: "transaction_reference",
        txRef: "tron-tx-1"
      }
    });

    assert.equal(result.supported, true);
    assert.equal(result.verified, true);
    assert.equal(result.settlement?.settlementKind, "tron_native_transfer");
    assert.equal(result.settlement?.amountAtomic, "2500000");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("on-chain purchase verifier: verifies XRPL payments", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    jsonResponse({
      result: {
        validated: true,
        Destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
        DestinationTag: 123,
        Amount: "2000000",
        meta: {
          TransactionResult: "tesSUCCESS",
          delivered_amount: "2000000"
        }
      }
    })) as typeof fetch;

  try {
    const result = await verifyOnchainPurchase({
      package: buildPackage({
        id: "pkg-xrp",
        paymentAsset: "xrp",
        paymentAmount: "2",
        paymentRailId: "xrpl",
        paymentTarget: {
          version: 1,
          railId: "xrpl",
          asset: "xrp",
          destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
          network: "xrpl",
          reference: "123"
        }
      }),
      settlementProof: {
        version: 1,
        railId: "xrpl",
        asset: "xrp",
        proofType: "transaction_reference",
        txRef: "xrpl-tx-1"
      }
    });

    assert.equal(result.supported, true);
    assert.equal(result.verified, true);
    assert.equal(result.settlement?.settlementKind, "xrpl_payment");
    assert.equal(result.settlement?.amountAtomic, "2000000");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("on-chain purchase verifier: verifies Cardano outputs", async () => {
  const originalFetch = globalThis.fetch;
  process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL = "https://cardano.example.com";
  process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID = "blockfrost-key";
  globalThis.fetch = (async () =>
    jsonResponse({
      outputs: [
        {
          address: "addr1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
          amount: [{ unit: "lovelace", quantity: "1500000" }]
        }
      ]
    })) as typeof fetch;

  try {
    const result = await verifyOnchainPurchase({
      package: buildPackage({
        id: "pkg-ada",
        paymentAsset: "ada",
        paymentAmount: "1.5",
        paymentRailId: "cardano",
        paymentTarget: {
          version: 1,
          railId: "cardano",
          asset: "ada",
          destination: "addr1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
          network: "cardano"
        }
      }),
      settlementProof: {
        version: 1,
        railId: "cardano",
        asset: "ada",
        proofType: "transaction_reference",
        txRef: "cardano-tx-1"
      }
    });

    assert.equal(result.supported, true);
    assert.equal(result.verified, true);
    assert.equal(result.settlement?.settlementKind, "cardano_utxo_output");
    assert.equal(result.settlement?.amountAtomic, "1500000");
  } finally {
    delete process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL;
    delete process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID;
    globalThis.fetch = originalFetch;
  }
});

test("on-chain purchase verifier: verifies BTC outputs via public fallback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    jsonResponse({
      status: { confirmed: true },
      vout: [
        {
          scriptpubkey_address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
          value: 21000
        }
      ]
    })) as typeof fetch;

  try {
    const result = await verifyOnchainPurchase({
      package: buildPackage({
        id: "pkg-btc",
        paymentAsset: "btc",
        paymentAmount: "0.00021",
        paymentRailId: "utxo",
        paymentTarget: {
          version: 1,
          railId: "utxo",
          asset: "btc",
          destination: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
          network: "btc"
        }
      }),
      settlementProof: {
        version: 1,
        railId: "utxo",
        asset: "btc",
        proofType: "transaction_reference",
        txRef: "btc-tx-1"
      }
    });

    assert.equal(result.supported, true);
    assert.equal(result.verified, true);
    assert.equal(result.settlement?.settlementKind, "utxo_output");
    assert.equal(result.settlement?.amountAtomic, "21000");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
