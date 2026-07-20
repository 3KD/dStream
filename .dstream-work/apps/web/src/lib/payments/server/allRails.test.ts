import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";
import { base58, bech32 } from "@scure/base";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { encodeLnurl } from "../lightning";
import { getPaymentRailCapabilities, verifyPayment } from "./index";

const tempDir = mkdtempSync(join(tmpdir(), "dstream-all-payment-rails-"));
process.env.DSTREAM_PAYMENT_INTENT_STORE_PATH = join(tempDir, "intents.json");
const originalFetch = globalThis.fetch;

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function integerWords(value: number, count: number): number[] {
  const words = new Array<number>(count).fill(0);
  let remaining = value;
  for (let index = count - 1; index >= 0; index -= 1) {
    words[index] = remaining & 31;
    remaining = Math.floor(remaining / 32);
  }
  return words;
}

function taggedBytes(code: number, bytes: Uint8Array): number[] {
  const words = bech32.toWords(bytes);
  return [code, Math.floor(words.length / 32), words.length % 32, ...words];
}

function taggedInteger(code: number, value: number): number[] {
  const words: number[] = [];
  let remaining = value;
  do {
    words.unshift(remaining & 31);
    remaining = Math.floor(remaining / 32);
  } while (remaining > 0);
  return [code, Math.floor(words.length / 32), words.length % 32, ...words];
}

function makeBolt11(input: { timestamp: number; paymentHash: Uint8Array; descriptionHash: Uint8Array }): string {
  return bech32.encode(
    "lnbc20u",
    [
      ...integerWords(input.timestamp, 7),
      ...taggedBytes(1, input.paymentHash),
      ...taggedBytes(23, input.descriptionHash),
      ...taggedInteger(6, 3600),
      ...bech32.toWords(new Uint8Array(65))
    ],
    false
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of [
    "DSTREAM_BTC_RPC_ORIGIN",
    "DSTREAM_BTC_ESPLORA_ORIGINS",
    "DSTREAM_BTC_ESPLORA_QUORUM",
    "DSTREAM_DOGE_RPC_ORIGIN",
    "DSTREAM_DOGE_CONFIRMATIONS_REQUIRED",
    "DSTREAM_ETH_RPC_ORIGIN",
    "DSTREAM_TRON_RPC_ORIGIN",
    "DSTREAM_SOLANA_RPC_ORIGIN",
    "DSTREAM_XRPL_RPC_ORIGIN",
    "DSTREAM_CARDANO_API_ORIGIN"
  ]) {
    delete process.env[name];
  }
});

test("capability catalog covers every advertised asset and rail", () => {
  const capabilities = getPaymentRailCapabilities();
  const assets = new Set(capabilities.map((entry) => entry.asset));
  for (const asset of ["xmr", "btc", "eth", "usdt", "xrp", "usdc", "sol", "trx", "doge", "bch", "ada", "pepe"] as const) {
    assert.equal(assets.has(asset), true, `${asset} capability is missing`);
  }
  assert.equal(capabilities.some((entry) => entry.railId === "lightning" && entry.asset === "btc"), true);
});

test("Dogecoin uses the UTXO verifier with output-index replay identity", async () => {
  process.env.DSTREAM_DOGE_RPC_ORIGIN = "https://doge-rpc.example";
  process.env.DSTREAM_DOGE_CONFIRMATIONS_REQUIRED = "12";
  const txId = "1".repeat(64);
  const address = "D5jYjWcsf8P7T7TvM8S46HoPazTAp3GEXL";
  globalThis.fetch = async (_url, init) => {
    const method = JSON.parse(String(init?.body)).method;
    if (method === "getblockchaininfo") return response({ result: { chain: "main", blocks: 5_000_000 } });
    return response({ result: { txid: txId, confirmations: 20, vout: [{ n: 3, value: "25.5", scriptPubKey: { address } }] } });
  };
  const payment = await verifyPayment({ asset: "doge", paymentRailId: "utxo", address, amount: "25", txId });
  assert.equal(payment.amountAtomic, "2550000000");
  assert.equal(payment.settlementKey, `doge:main:${txId}:3`);
});

test("ERC-20 verifier requires an allowlisted contract and matching Transfer log", async () => {
  process.env.DSTREAM_ETH_RPC_ORIGIN = "https://eth-rpc.example";
  const txId = `0x${"2".repeat(64)}`;
  const recipient = `0x${"3".repeat(40)}`;
  const payer = `0x${"4".repeat(40)}`;
  const contract = "0xdac17f958d2ee523a2206206994597c13d831ec7";
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  globalThis.fetch = async (_url, init) => {
    const method = JSON.parse(String(init?.body)).method;
    if (method === "eth_chainId") return response({ result: "0x1" });
    if (method === "eth_getTransactionByHash") {
      return response({ result: { hash: txId, from: payer, to: contract, value: "0x0", blockNumber: "0x64" } });
    }
    if (method === "eth_getTransactionReceipt") {
      return response({
        result: {
          transactionHash: txId,
          status: "0x1",
          blockNumber: "0x64",
          logs: [
            {
              address: contract,
              topics: [transferTopic, `0x${payer.slice(2).padStart(64, "0")}`, `0x${recipient.slice(2).padStart(64, "0")}`],
              data: `0x${1_500_000n.toString(16).padStart(64, "0")}`,
              logIndex: "0x2",
              removed: false
            }
          ]
        }
      });
    }
    return response({ result: "0x70" });
  };
  const payment = await verifyPayment({ asset: "usdt", paymentRailId: "evm", network: "ethereum", address: recipient, amount: "1", txId });
  assert.equal(payment.amountAtomic, "1500000");
  assert.equal(payment.tokenContract, contract);
  assert.equal(payment.settlementKey, `usdt:eip155:1:${txId}:log:2`);
});

test("TRC-20 verifier decodes transfer calldata and checks the token contract", async () => {
  process.env.DSTREAM_TRON_RPC_ORIGIN = "https://tron-rpc.example";
  const txId = "5".repeat(64);
  const recipient = "TH5oqaJWYnVZCCPktHvcsm8aaPUeAXzrTY";
  const contract = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  const recipientHex = Buffer.from(base58.decode(recipient).slice(1, 21)).toString("hex");
  const data = `a9059cbb${recipientHex.padStart(64, "0")}${1_500_000n.toString(16).padStart(64, "0")}`;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("walletsolidity/gettransactionbyid")) {
      return response({
        txID: txId,
        ret: [{ contractRet: "SUCCESS" }],
        raw_data: { contract: [{ type: "TriggerSmartContract", parameter: { value: { contract_address: contract, data } } }] }
      });
    }
    if (path.endsWith("wallet/gettransactioninfobyid")) return response({ id: txId, blockNumber: 100, receipt: { result: "SUCCESS" } });
    return response({ block_header: { raw_data: { number: 130 } } });
  };
  const payment = await verifyPayment({ asset: "usdt", paymentRailId: "tron", network: "tron", address: recipient, amount: "1", txId });
  assert.equal(payment.amountAtomic, "1500000");
  assert.equal(payment.tokenContract, contract);
});

test("Solana SPL verifier uses finalized owner balance deltas", async () => {
  process.env.DSTREAM_SOLANA_RPC_ORIGIN = "https://solana-rpc.example";
  const txId = base58.encode(new Uint8Array(64).fill(6));
  const recipient = base58.encode(new Uint8Array(32).fill(7));
  const payer = base58.encode(new Uint8Array(32).fill(8));
  const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  globalThis.fetch = async (_url, init) => {
    const method = JSON.parse(String(init?.body)).method;
    if (method === "getSlot") return response({ result: 150 });
    return response({
      result: {
        slot: 149,
        meta: {
          err: null,
          preTokenBalances: [{ accountIndex: 2, mint, owner: recipient, uiTokenAmount: { amount: "100000", decimals: 6 } }],
          postTokenBalances: [{ accountIndex: 2, mint, owner: recipient, uiTokenAmount: { amount: "1600000", decimals: 6 } }]
        },
        transaction: { signatures: [txId], message: { accountKeys: [{ pubkey: payer, signer: true }], instructions: [] } }
      }
    });
  };
  const payment = await verifyPayment({ asset: "usdc", paymentRailId: "solana", network: "solana", address: recipient, amount: "1", txId });
  assert.equal(payment.finality, "finalized");
  assert.equal(payment.amountAtomic, "1500000");
  assert.equal(payment.payer, payer);
});

test("Solana SPL verifier rejects balance churn between recipient-owned accounts", async () => {
  process.env.DSTREAM_SOLANA_RPC_ORIGIN = "https://solana-rpc.example";
  const txId = base58.encode(new Uint8Array(64).fill(9));
  const recipient = base58.encode(new Uint8Array(32).fill(10));
  const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  globalThis.fetch = async (_url, init) => {
    const method = JSON.parse(String(init?.body)).method;
    if (method === "getSlot") return response({ result: 150 });
    return response({
      result: {
        slot: 149,
        meta: {
          err: null,
          preTokenBalances: [
            { accountIndex: 2, mint, owner: recipient, uiTokenAmount: { amount: "1500000", decimals: 6 } },
            { accountIndex: 3, mint, owner: recipient, uiTokenAmount: { amount: "0", decimals: 6 } }
          ],
          postTokenBalances: [
            { accountIndex: 2, mint, owner: recipient, uiTokenAmount: { amount: "0", decimals: 6 } },
            { accountIndex: 3, mint, owner: recipient, uiTokenAmount: { amount: "1500000", decimals: 6 } }
          ]
        },
        transaction: { signatures: [txId], message: { accountKeys: [recipient], instructions: [] } }
      }
    });
  };
  await assert.rejects(
    verifyPayment({ asset: "usdc", paymentRailId: "solana", network: "solana", address: recipient, amount: "1", txId }),
    /does not credit/
  );
});

test("XRPL verifier requires validated tesSUCCESS and delivered XRP", async () => {
  process.env.DSTREAM_XRPL_RPC_ORIGIN = "https://xrpl.example";
  const txId = "A".repeat(64);
  const recipient = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
  globalThis.fetch = async () =>
    response({
      result: {
        hash: txId,
        validated: true,
        ledger_index: 99_000_000,
        TransactionType: "Payment",
        Account: "rLs1MzkFWCxTbuAHgjeTZK4fcCDDnf2KRv",
        Destination: recipient,
        DestinationTag: 7,
        Amount: "2000000",
        meta: { TransactionResult: "tesSUCCESS", delivered_amount: "2000000" }
      }
    });
  const payment = await verifyPayment({
    asset: "xrp",
    paymentRailId: "xrpl",
    network: "xrpl",
    address: recipient,
    amount: "1.5",
    txId,
    proof: { destinationTag: 7 }
  });
  assert.equal(payment.amountAtomic, "2000000");
  assert.equal(payment.finality, "finalized");
});

test("Cardano verifier sums lovelace outputs and chain confirmations", async () => {
  process.env.DSTREAM_CARDANO_API_ORIGIN = "https://cardano.example/api/v0";
  const txId = "9".repeat(64);
  const recipient = `addr1${"q".repeat(54)}`;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith(`/txs/${txId}/utxos`)) {
      return response({ hash: txId, outputs: [{ address: recipient, amount: [{ unit: "lovelace", quantity: "2500000" }] }] });
    }
    if (path.endsWith(`/txs/${txId}`)) return response({ hash: txId, block_height: 1000, valid_contract: true });
    return response({ height: 1020 });
  };
  const payment = await verifyPayment({ asset: "ada", paymentRailId: "cardano", network: "cardano", address: recipient, amount: "2", txId });
  assert.equal(payment.amountAtomic, "2500000");
  assert.equal(payment.confirmations, 21);
});

test("NIP-57 verifier validates provider signature, zap binding, amount, and invoice hash", async () => {
  const senderSecret = generateSecretKey();
  const providerSecret = generateSecretKey();
  const senderPubkey = getPublicKey(senderSecret);
  const providerPubkey = getPublicKey(providerSecret);
  const recipientPubkey = "a".repeat(64);
  const intentId = "intent-lightning";
  const lnurlPayUrl = "https://1.1.1.1/lnurl-pay";
  const lnurl = encodeLnurl(lnurlPayUrl);
  const timestamp = Math.floor(Date.now() / 1000);
  const zapRequest = finalizeEvent(
    {
      kind: 9734,
      created_at: timestamp,
      content: `dstream-intent:${intentId}`,
      tags: [["relays", "wss://relay.example"], ["amount", "2000000"], ["lnurl", lnurl], ["p", recipientPubkey]]
    },
    senderSecret
  );
  const description = JSON.stringify(zapRequest);
  const paymentHash = randomBytes(32);
  const invoice = makeBolt11({
    timestamp,
    paymentHash,
    descriptionHash: createHash("sha256").update(description).digest()
  });
  const receipt = finalizeEvent(
    {
      kind: 9735,
      created_at: timestamp + 1,
      content: "",
      tags: [["p", recipientPubkey], ["description", description], ["bolt11", invoice]]
    },
    providerSecret
  );
  globalThis.fetch = async () =>
    response({
      callback: "https://1.1.1.1/callback",
      minSendable: 1000,
      maxSendable: 100_000_000,
      allowsNostr: true,
      nostrPubkey: providerPubkey,
      tag: "payRequest"
    });
  const payment = await verifyPayment({
    asset: "btc",
    paymentRailId: "lightning",
    network: "lightning",
    address: lnurl,
    amount: "2000",
    intentId,
    recipientPubkey,
    proof: { zapReceipt: receipt }
  });
  assert.equal(payment.txId, Buffer.from(paymentHash).toString("hex"));
  assert.equal(payment.payer, senderPubkey);
  assert.equal(payment.finality, "provider_attested");
});

test("payment intents authorize by secret and reject cross-intent settlement replay", async () => {
  const { authorizePaymentIntent, createPaymentIntent, settlePaymentIntent } = await import("./intentStore");
  const base = {
    scope: { type: "tip", id: "creator:stream", streamPubkey: "a".repeat(64), streamId: "stream" } as const,
    buyerPubkey: "b".repeat(64),
    recipientPubkey: "a".repeat(64),
    asset: "btc" as const,
    railId: "utxo" as const,
    network: "main",
    address: "bc1qrecipient",
    amount: "0.001"
  };
  const first = createPaymentIntent(base);
  const second = createPaymentIntent(base);
  assert.equal(authorizePaymentIntent(first.intent.id, first.secret).intent.status, "pending");
  assert.throws(() => authorizePaymentIntent(first.intent.id, "wrong"), /credentials are invalid/);
  const payment = {
    asset: "btc" as const,
    railId: "utxo" as const,
    network: "main",
    txId: "c".repeat(64),
    settlementKey: `btc:main:${"c".repeat(64)}:0`,
    recipient: base.address,
    amountAtomic: "100000",
    confirmations: 3,
    blockHeight: 900000,
    finality: "confirmed" as const
  };
  assert.equal(settlePaymentIntent(first.intent.id, first.secret, payment).status, "settled");
  assert.throws(() => settlePaymentIntent(second.intent.id, second.secret, payment), /already used/);
});

after(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});
