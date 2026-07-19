import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";
import { decimalToAtomic } from "./amount";
import { verifyNativePayment } from "./index";

const tempDir = mkdtempSync(join(tmpdir(), "dstream-native-payments-test-"));
const settlementStorePath = join(tempDir, "settlements.json");
process.env.DSTREAM_PAYMENT_SETTLEMENT_STORE_PATH = settlementStorePath;
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.DSTREAM_BTC_RPC_ORIGIN;
  delete process.env.DSTREAM_BTC_RPC_USER;
  delete process.env.DSTREAM_BTC_RPC_PASS;
  delete process.env.DSTREAM_BTC_CONFIRMATIONS_REQUIRED;
  delete process.env.DSTREAM_ETH_RPC_ORIGIN;
  delete process.env.DSTREAM_ETH_CONFIRMATIONS_REQUIRED;
  delete process.env.DSTREAM_TRON_RPC_ORIGIN;
  delete process.env.DSTREAM_TRON_CONFIRMATIONS_REQUIRED;
});

test("decimalToAtomic rejects precision loss", () => {
  assert.equal(decimalToAtomic("1.25", 8), 125_000_000n);
  assert.throws(() => decimalToAtomic("0.000000001", 8), /at most 8 decimal places/);
});

test("Bitcoin verifier binds network, recipient, amount, confirmations, and output index", async () => {
  process.env.DSTREAM_BTC_RPC_ORIGIN = "https://bitcoin-rpc.example";
  process.env.DSTREAM_BTC_CONFIRMATIONS_REQUIRED = "3";
  const txId = "a".repeat(64);
  const address = "bc1qdstreamtestaddress";
  const requests: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    requests.push(body.method);
    if (body.method === "getblockchaininfo") {
      return jsonResponse({ result: { chain: "main", blocks: 900000 }, error: null });
    }
    return jsonResponse({
      result: {
        txid: txId,
        confirmations: 4,
        vout: [
          { n: 0, value: 0.0001, scriptPubKey: { address: "bc1qchange" } },
          { n: 1, value: 0.0015, scriptPubKey: { address } }
        ]
      },
      error: null
    });
  };

  const result = await verifyNativePayment({ asset: "btc", address, amount: "0.001", txId, paymentRailId: "utxo" });
  assert.deepEqual(requests, ["getblockchaininfo", "getrawtransaction"]);
  assert.equal(result.amountAtomic, "150000");
  assert.equal(result.confirmations, 4);
  assert.equal(result.blockHeight, 899997);
  assert.equal(result.settlementKey, `btc:main:${txId}:1`);
});

test("Ethereum verifier rejects reverted or under-confirmed transactions and accepts a confirmed native transfer", async () => {
  process.env.DSTREAM_ETH_RPC_ORIGIN = "https://ethereum-rpc.example";
  process.env.DSTREAM_ETH_CONFIRMATIONS_REQUIRED = "12";
  const txId = `0x${"b".repeat(64)}`;
  const address = `0x${"c".repeat(40)}`;
  let headBlock = "0x70";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    if (body.method === "eth_chainId") return jsonResponse({ result: "0x1" });
    if (body.method === "eth_getTransactionByHash") {
      return jsonResponse({ result: { hash: txId, to: address, value: "0xde0b6b3a7640000", blockNumber: "0x64" } });
    }
    if (body.method === "eth_getTransactionReceipt") {
      return jsonResponse({ result: { transactionHash: txId, status: "0x1", blockNumber: "0x64" } });
    }
    return jsonResponse({ result: headBlock });
  };

  const result = await verifyNativePayment({ asset: "eth", address, amount: "1", txId, paymentRailId: "evm" });
  assert.equal(result.amountAtomic, "1000000000000000000");
  assert.equal(result.confirmations, 13);
  assert.equal(result.blockHeight, 100);
  assert.equal(result.settlementKey, `eth:0x1:${txId}`);

  headBlock = "0x6a";
  await assert.rejects(
    () => verifyNativePayment({ asset: "eth", address, amount: "1", txId, paymentRailId: "evm" }),
    /7\/12 confirmations/
  );
});

test("TRON verifier accepts only a successful native TransferContract", async () => {
  process.env.DSTREAM_TRON_RPC_ORIGIN = "https://tron-rpc.example";
  process.env.DSTREAM_TRON_CONFIRMATIONS_REQUIRED = "20";
  const txId = "d".repeat(64);
  const address = `T${"A".repeat(33)}`;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/walletsolidity/gettransactionbyid")) {
      return jsonResponse({
        txID: txId,
        ret: [{ contractRet: "SUCCESS" }],
        raw_data: {
          contract: [{ type: "TransferContract", parameter: { value: { to_address: address, amount: 2_500_000 } } }]
        }
      });
    }
    if (path.endsWith("/wallet/gettransactioninfobyid")) {
      return jsonResponse({ id: txId, blockNumber: 100, receipt: { result: "SUCCESS" } });
    }
    return jsonResponse({ block_header: { raw_data: { number: 119 } } });
  };

  const result = await verifyNativePayment({ asset: "trx", address, amount: "2", txId, paymentRailId: "tron" });
  assert.equal(result.amountAtomic, "2500000");
  assert.equal(result.confirmations, 20);
  assert.equal(result.settlementKey, `trx:mainnet:${txId}`);
});

test("settlement store is idempotent for one purchase and rejects cross-purchase replay", async () => {
  const { recordNativePaymentSettlement } = await import("./settlementStore");
  const payment = {
    asset: "btc" as const,
    railId: "utxo" as const,
    network: "main",
    txId: "e".repeat(64),
    settlementKey: `btc:main:${"e".repeat(64)}:0`,
    recipient: "bc1qrecipient",
    amountAtomic: "10000",
    confirmations: 3,
    blockHeight: 900000
  };
  const first = recordNativePaymentSettlement({ payment, packageId: "package-a", buyerPubkey: "1".repeat(64) });
  const second = recordNativePaymentSettlement({ payment, packageId: "package-a", buyerPubkey: "1".repeat(64) });
  assert.equal(first.existing, false);
  assert.equal(second.existing, true);
  assert.equal(second.record.id, first.record.id);
  assert.throws(
    () => recordNativePaymentSettlement({ payment, packageId: "package-b", buyerPubkey: "2".repeat(64) }),
    /already been used/
  );
});

test("settlement store fails closed instead of resetting an invalid schema", async () => {
  const { recordNativePaymentSettlement } = await import("./settlementStore");
  writeFileSync(settlementStorePath, "{}\n", "utf8");
  assert.throws(
    () =>
      recordNativePaymentSettlement({
        payment: {
          asset: "trx",
          railId: "tron",
          network: "tron:mainnet",
          txId: "f".repeat(64),
          settlementKey: `trx:mainnet:${"f".repeat(64)}`,
          recipient: `T${"A".repeat(33)}`,
          amountAtomic: "1000000",
          confirmations: 20,
          blockHeight: 100
        },
        packageId: "package-c",
        buyerPubkey: "3".repeat(64)
      }),
    /invalid schema/
  );
});

after(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});
