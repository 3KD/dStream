import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import bs58 from "bs58";
import { finalizeEvent, generateSecretKey, getPublicKey, SimplePool } from "nostr-tools";
import { buildZapRequestUnsigned } from "../zaps";

const tempDir = mkdtempSync(join(tmpdir(), "dstream-payment-operator-test-"));
process.env.DSTREAM_ACCESS_STORE_PATH = join(tempDir, "access.json");
process.env.DSTREAM_Video_PACKAGE_STORE_PATH = join(tempDir, "video-packages.json");
process.env.DSTREAM_PAYMENT_OPERATOR_STORE_PATH = join(tempDir, "payment-operator-sessions.json");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function tronBase58ToHex(address: string): string {
  const decoded = Buffer.from(bs58.decode(address));
  return decoded.subarray(0, decoded.length - 4).toString("hex");
}

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("payment operator: built-in XMR sessions allocate a unique subaddress and verify from wallet-rpc observation", async () => {
  const originalOrigin = process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN;
  const originalConfirmations = process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED;
  let xmrTransfers: Array<Record<string, unknown>> = [];
  let xmrServer: ReturnType<typeof createServer> | null = null;

  try {
    xmrServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { id?: string | number; method?: string };
      const respond = (result: unknown) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? "0", result }));
      };

      switch (body.method) {
        case "create_address":
          respond({
            address: "89xmrBuiltInSessionAddress111111111111111111111111111111111111111111111111111111111",
            address_index: 19
          });
          return;
        case "refresh":
          respond({});
          return;
        case "get_transfers":
          respond({ in: xmrTransfers, pending: [], pool: [] });
          return;
        default:
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? "0", error: { code: -1, message: `unexpected method ${body.method ?? "unknown"}` } }));
      }
    });
    await new Promise<void>((resolve) => xmrServer!.listen(0, "127.0.0.1", resolve));
    const address = xmrServer.address();
    if (!address || typeof address === "string") throw new Error("failed to start XMR test wallet-rpc server");
    process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN = `http://127.0.0.1:${address.port}`;
    process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED = "10";

    const { upsertVideoAccessPackage } = await import("./packages");
    const { createPaymentOperatorSession, getPaymentOperatorSessionStatus } = await import("./paymentOperator");

    const hostPubkey = "a".repeat(64);
    const viewerPubkey = "b".repeat(64);
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-xmr-operator",
      title: "XMR operator package",
      paymentAsset: "xmr",
      paymentAmount: "1.5",
      durationHours: 24
    });

    const created = await createPaymentOperatorSession({
      version: 1,
      sessionId: "xmr-built-in-session",
      package: {
        id: pkg.id,
        hostPubkey: pkg.hostPubkey,
        streamId: pkg.streamId,
        paymentAsset: pkg.paymentAsset,
        paymentAmount: pkg.paymentAmount,
        paymentRailId: "xmr"
      },
      viewer: { pubkey: viewerPubkey }
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.status, "pending_operator");
    assert.equal(created.proofMode, "operator_observed");
    assert.equal(created.target.destination.startsWith("89xmrBuiltInSessionAddress"), true);

    const pending = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "xmr-built-in-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    assert.equal(pending.status, "pending_operator");

    xmrTransfers = [
      {
        amount: "1500000000000",
        confirmations: 12,
        subaddr_index: { major: 0, minor: 19 },
        txid: "xmr-built-in-tx",
        timestamp: Math.floor(Date.now() / 1000)
      }
    ];

    const verified = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "xmr-built-in-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.status, "verified");
    assert.equal(verified.settlement?.railId, "xmr");
    assert.equal(verified.settlement?.settlementKind, "xmr_subaddress_transfer");
    assert.equal(verified.settlement?.txRef, "xmr-built-in-tx");
  } finally {
    if (xmrServer) {
      await new Promise<void>((resolve, reject) => xmrServer!.close((error) => (error ? reject(error) : resolve())));
    }
    if (originalOrigin === undefined) delete process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN;
    else process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN = originalOrigin;
    if (originalConfirmations === undefined) delete process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED;
    else process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED = originalConfirmations;
  }
});

test("payment operator: built-in non-XMR sessions reuse package targets and verify settlement proofs", async () => {
  const originalFetch = globalThis.fetch;

  try {
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

    const { upsertVideoAccessPackage } = await import("./packages");
    const { createPaymentOperatorSession, observePaymentOperatorSession } = await import("./paymentOperator");

    const hostPubkey = "c".repeat(64);
    const viewerPubkey = "d".repeat(64);
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-evm-operator",
      title: "EVM operator package",
      paymentAsset: "eth",
      paymentAmount: "0.5",
      paymentRailId: "evm",
      paymentTarget: {
        version: 1,
        railId: "evm",
        asset: "eth",
        destination: "0x1111111111111111111111111111111111111111",
        network: "ethereum"
      },
      durationHours: 24,
      metadata: {
        paymentSession: {
          operatorEndpoint: "https://operator.example/evm"
        }
      }
    });

    const created = await createPaymentOperatorSession({
      version: 1,
      sessionId: "evm-built-in-session",
      package: {
        id: pkg.id,
        hostPubkey: pkg.hostPubkey,
        streamId: pkg.streamId,
        paymentAsset: pkg.paymentAsset,
        paymentAmount: pkg.paymentAmount,
        paymentRailId: "evm",
        paymentTarget: pkg.paymentTarget
      },
      viewer: { pubkey: viewerPubkey }
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.status, "pending_operator");
    assert.equal(created.target.destination, "0x1111111111111111111111111111111111111111");

    const observed = await observePaymentOperatorSession({
      version: 1,
      sessionId: "evm-built-in-session",
      packageId: pkg.id,
      viewerPubkey,
      settlementProof: {
        version: 1,
        railId: "evm",
        asset: "eth",
        proofType: "transaction_reference",
        txRef: "0xabc",
        network: "ethereum"
      }
    });
    assert.equal(observed.ok, true);
    if (!observed.ok) return;
    assert.equal(observed.status, "verified");
    assert.equal(observed.settlement?.railId, "evm");
    assert.equal(observed.settlement?.settlementKind, "evm_native_transfer");
    assert.equal(observed.settlement?.amountAtomic, "500000000000000000");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("payment operator: built-in Lightning sessions mint per-session invoices and verify relay receipts", async () => {
  const originalFetch = globalThis.fetch;
  const originalQuerySync = SimplePool.prototype.querySync;
  const originalRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS;
  const buyerSecret = generateSecretKey();
  const zapperSecret = generateSecretKey();
  let relayReceipts: unknown[] = [];

  try {
    process.env.NEXT_PUBLIC_NOSTR_RELAYS = "wss://relay.example.com";
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "https://example.com/.well-known/lnurlp/creator") {
        return jsonResponse({
          callback: "https://example.com/lnurl/callback",
          allowsNostr: true,
          nostrPubkey: getPublicKey(zapperSecret),
          minSendable: 1000,
          maxSendable: 5_000_000_000
        });
      }
      if (url.startsWith("https://example.com/lnurl/callback?")) {
        const callbackUrl = new URL(url);
        assert.equal(callbackUrl.searchParams.get("amount"), "1500000");
        const nostr = callbackUrl.searchParams.get("nostr");
        assert.ok(nostr);
        const request = JSON.parse(nostr || "{}") as { kind?: number; tags?: string[][] };
        assert.equal(request.kind, 9734);
        assert.equal(request.tags?.some((tag) => tag[0] === "pkg" && tag[1] === pkg.id), true);
        assert.equal(request.tags?.some((tag) => tag[0] === "ps" && tag[1] === "lightning-built-in-session"), true);
        return jsonResponse({ pr: "lnbc15u1p0sessioninvoice" });
      }
      return jsonResponse({ error: { message: `unexpected url ${url}` } }, 500);
    }) as typeof fetch;
    SimplePool.prototype.querySync = (async () => relayReceipts as any[]) as typeof SimplePool.prototype.querySync;

    const { upsertVideoAccessPackage } = await import("./packages");
    const { createPaymentOperatorSession, getPaymentOperatorSessionStatus } = await import("./paymentOperator");

    const hostPubkey = "e".repeat(64);
    const viewerPubkey = getPublicKey(buyerSecret);
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-lightning-operator",
      title: "Lightning operator package",
      paymentAsset: "btc",
      paymentAmount: "0.000015",
      paymentRailId: "lightning",
      paymentTarget: {
        version: 1,
        railId: "lightning",
        asset: "btc",
        destination: "creator@example.com",
        network: "lightning"
      },
      durationHours: 24,
      metadata: {
        paymentSession: {
          operatorEndpoint: "https://operator.example/lightning"
        }
      }
    });

    const zapRequest = finalizeEvent(
      buildZapRequestUnsigned({
        senderPubkey: viewerPubkey,
        recipientPubkey: hostPubkey,
        streamId: pkg.streamId,
        amountSats: 1500,
        relays: ["wss://relay.example.com"],
        packageId: pkg.id,
        sessionId: "lightning-built-in-session"
      }) as any,
      buyerSecret
    );

    const created = await createPaymentOperatorSession({
      version: 1,
      sessionId: "lightning-built-in-session",
      package: {
        id: pkg.id,
        hostPubkey: pkg.hostPubkey,
        streamId: pkg.streamId,
        paymentAsset: pkg.paymentAsset,
        paymentAmount: pkg.paymentAmount,
        paymentRailId: "lightning",
        paymentTarget: pkg.paymentTarget
      },
      viewer: { pubkey: viewerPubkey },
      metadata: {
        lightningZapRequestEvent: zapRequest
      }
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.status, "pending_operator");
    assert.equal(created.target.targetType, "invoice");
    assert.equal(created.target.destination, "lnbc15u1p0sessioninvoice");
    assert.equal(created.metadata?.operatorMode, "built_in_lightning_zap_operator");

    const pending = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "lightning-built-in-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    assert.equal(pending.status, "pending_operator");

    relayReceipts = [
      finalizeEvent(
        {
          kind: 9735,
          pubkey: getPublicKey(zapperSecret),
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["p", hostPubkey],
            ["bolt11", "lnbc15u1p0sessioninvoice"],
            ["description", JSON.stringify(zapRequest)]
          ],
          content: ""
        } as any,
        zapperSecret
      )
    ];

    const verified = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "lightning-built-in-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.status, "verified");
    assert.equal(verified.settlement?.railId, "lightning");
    assert.equal(verified.settlement?.settlementKind, "nip57_zap_receipt");
    assert.equal(verified.metadata?.lightningReceiptId, relayReceipts[0] && (relayReceipts[0] as { id?: string }).id);
  } finally {
    globalThis.fetch = originalFetch;
    SimplePool.prototype.querySync = originalQuerySync;
    if (originalRelays === undefined) delete process.env.NEXT_PUBLIC_NOSTR_RELAYS;
    else process.env.NEXT_PUBLIC_NOSTR_RELAYS = originalRelays;
  }
});

test("payment operator: built-in EVM sessions reserve unique exact amounts and auto-verify by block scan", async () => {
  const originalFetch = globalThis.fetch;

  try {
    let blockTxs: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: any[] };
      if (request.method === "eth_blockNumber") {
        return jsonResponse({ result: "0x10" });
      }
      if (request.method === "eth_getBlockByNumber") {
        return jsonResponse({
          result: {
            timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
            transactions: blockTxs
          }
        });
      }
      if (request.method === "eth_getTransactionByHash") {
        const txRef = String(request.params?.[0] ?? "");
        return jsonResponse({ result: blockTxs.find((row) => row.hash === txRef) ?? null });
      }
      if (request.method === "eth_getTransactionReceipt") {
        return jsonResponse({
          result: {
            status: "0x1",
            blockNumber: "0x10"
          }
        });
      }
      return jsonResponse({ error: { message: "unexpected EVM RPC method" } }, 500);
    }) as typeof fetch;

    const { upsertVideoAccessPackage } = await import("./packages");
    const { createPaymentOperatorSession, getPaymentOperatorSessionStatus } = await import("./paymentOperator");

    const hostPubkey = "9".repeat(64);
    const viewerPubkey = "a".repeat(64);
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-evm-watch-operator",
      title: "EVM watch operator package",
      paymentAsset: "eth",
      paymentAmount: "0.5",
      paymentRailId: "evm",
      paymentTarget: {
        version: 1,
        railId: "evm",
        asset: "eth",
        destination: "0x1111111111111111111111111111111111111111",
        network: "ethereum"
      },
      durationHours: 24,
      metadata: {
        paymentSession: {
          operatorEndpoint: "https://operator.example/evm"
        }
      }
    });

    const created = await createPaymentOperatorSession({
      version: 1,
      sessionId: "evm-built-in-watch-session",
      package: {
        id: pkg.id,
        hostPubkey: pkg.hostPubkey,
        streamId: pkg.streamId,
        paymentAsset: pkg.paymentAsset,
        paymentAmount: pkg.paymentAmount,
        paymentRailId: "evm",
        paymentTarget: pkg.paymentTarget
      },
      viewer: { pubkey: viewerPubkey }
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.status, "pending_operator");
    assert.notEqual(created.target.amountAtomic, "500000000000000000");

    const pending = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "evm-built-in-watch-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    assert.equal(pending.status, "pending_operator");

    blockTxs = [
      {
        hash: "0xevmwatchsession1",
        to: created.target.destination,
        value: `0x${BigInt(created.target.amountAtomic ?? "0").toString(16)}`,
        input: "0x"
      }
    ];

    const verified = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "evm-built-in-watch-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.status, "verified");
    assert.equal(verified.settlement?.railId, "evm");
    assert.equal(verified.settlement?.settlementKind, "evm_native_transfer");
    assert.equal(verified.settlement?.txRef, "0xevmwatchsession1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("payment operator: built-in Solana sessions reserve unique exact amounts and auto-verify by address signatures", async () => {
  const originalFetch = globalThis.fetch;
  const originalRpcUrl = process.env.DSTREAM_ACCESS_SOLANA_RPC_URL;

  try {
    process.env.DSTREAM_ACCESS_SOLANA_RPC_URL = "https://solana.example.com";
    let signatures: Array<Record<string, unknown>> = [];
    let transactionBySignature: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: any[] };
      if (request.method === "getSignaturesForAddress") {
        return jsonResponse({ result: signatures });
      }
      if (request.method === "getTransaction") {
        return jsonResponse({ result: transactionBySignature[String(request.params?.[0] ?? "")] ?? null });
      }
      return jsonResponse({ error: { message: "unexpected Solana RPC method" } }, 500);
    }) as typeof fetch;

    const { upsertVideoAccessPackage } = await import("./packages");
    const { createPaymentOperatorSession, getPaymentOperatorSessionStatus } = await import("./paymentOperator");

    const hostPubkey = "b".repeat(64);
    const viewerPubkey = "c".repeat(64);
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-solana-watch-operator",
      title: "Solana watch operator package",
      paymentAsset: "sol",
      paymentAmount: "0.25",
      paymentRailId: "solana",
      paymentTarget: {
        version: 1,
        railId: "solana",
        asset: "sol",
        destination: "6pM2jN2B7J4yX8nUaWm4z3k2d3U6hC2YbA6DfQp4o9sK",
        network: "devnet"
      },
      durationHours: 24,
      metadata: {
        paymentSession: {
          operatorEndpoint: "https://operator.example/solana"
        }
      }
    });

    const created = await createPaymentOperatorSession({
      version: 1,
      sessionId: "solana-built-in-watch-session",
      package: {
        id: pkg.id,
        hostPubkey: pkg.hostPubkey,
        streamId: pkg.streamId,
        paymentAsset: pkg.paymentAsset,
        paymentAmount: pkg.paymentAmount,
        paymentRailId: "solana",
        paymentTarget: pkg.paymentTarget
      },
      viewer: { pubkey: viewerPubkey }
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.status, "pending_operator");
    assert.notEqual(created.target.amountAtomic, "250000000");

    signatures = [
      {
        signature: "solana-built-in-watch-tx",
        blockTime: Math.floor(Date.now() / 1000),
        err: null
      }
    ];
    transactionBySignature = {
      "solana-built-in-watch-tx": {
        meta: { err: null },
        transaction: {
          message: {
            instructions: [
              {
                program: "system",
                parsed: {
                  type: "transfer",
                  info: {
                    destination: created.target.destination,
                    lamports: created.target.amountAtomic
                  }
                }
              }
            ]
          }
        }
      }
    };

    const verified = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "solana-built-in-watch-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.status, "verified");
    assert.equal(verified.settlement?.railId, "solana");
    assert.equal(verified.settlement?.settlementKind, "solana_native_transfer");
    assert.equal(verified.settlement?.txRef, "solana-built-in-watch-tx");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRpcUrl === undefined) delete process.env.DSTREAM_ACCESS_SOLANA_RPC_URL;
    else process.env.DSTREAM_ACCESS_SOLANA_RPC_URL = originalRpcUrl;
  }
});

test("payment operator: built-in TRON sessions reserve unique exact amounts and auto-verify by address history", async () => {
  const originalFetch = globalThis.fetch;
  const originalRpcUrl = process.env.DSTREAM_ACCESS_TRON_RPC_URL;

  try {
    process.env.DSTREAM_ACCESS_TRON_RPC_URL = "https://tron.example.com";
    let historyRows: Array<Record<string, unknown>> = [];
    let txBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/v1/accounts/") && url.includes("/transactions?")) {
        return jsonResponse({ data: historyRows });
      }
      if (url.endsWith("/wallet/gettransactionbyid")) {
        return jsonResponse(txBody);
      }
      if (url.endsWith("/walletsolidity/gettransactioninfobyid")) {
        return jsonResponse({
          blockNumber: 123,
          receipt: { result: "SUCCESS" }
        });
      }
      return jsonResponse({ error: { message: `unexpected TRON url ${url}` } }, 500);
    }) as typeof fetch;

    const { upsertVideoAccessPackage } = await import("./packages");
    const { createPaymentOperatorSession, getPaymentOperatorSessionStatus } = await import("./paymentOperator");

    const hostPubkey = "d".repeat(64);
    const viewerPubkey = "e".repeat(64);
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-tron-watch-operator",
      title: "TRON watch operator package",
      paymentAsset: "trx",
      paymentAmount: "42",
      paymentRailId: "tron",
      paymentTarget: {
        version: 1,
        railId: "tron",
        asset: "trx",
        destination: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
        network: "tron"
      },
      durationHours: 24,
      metadata: {
        paymentSession: {
          operatorEndpoint: "https://operator.example/tron"
        }
      }
    });

    const created = await createPaymentOperatorSession({
      version: 1,
      sessionId: "tron-built-in-watch-session",
      package: {
        id: pkg.id,
        hostPubkey: pkg.hostPubkey,
        streamId: pkg.streamId,
        paymentAsset: pkg.paymentAsset,
        paymentAmount: pkg.paymentAmount,
        paymentRailId: "tron",
        paymentTarget: pkg.paymentTarget
      },
      viewer: { pubkey: viewerPubkey }
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.status, "pending_operator");
    assert.notEqual(created.target.amountAtomic, "42000000");

    const destinationHex = tronBase58ToHex(created.target.destination);
    historyRows = [
      {
        txID: "tron-built-in-watch-tx",
        block_timestamp: Date.now(),
        raw_data: {
          contract: [
            {
              parameter: {
                value: {
                  to_address: destinationHex,
                  amount: created.target.amountAtomic
                }
              }
            }
          ]
        }
      }
    ];
    txBody = {
      raw_data: {
        contract: [
          {
            parameter: {
              value: {
                to_address: destinationHex,
                amount: created.target.amountAtomic
              }
            }
          }
        ]
      },
      ret: [{ contractRet: "SUCCESS" }]
    };

    const verified = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "tron-built-in-watch-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.status, "verified");
    assert.equal(verified.settlement?.railId, "tron");
    assert.equal(verified.settlement?.settlementKind, "tron_native_transfer");
    assert.equal(verified.settlement?.txRef, "tron-built-in-watch-tx");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRpcUrl === undefined) delete process.env.DSTREAM_ACCESS_TRON_RPC_URL;
    else process.env.DSTREAM_ACCESS_TRON_RPC_URL = originalRpcUrl;
  }
});

test("payment operator: built-in UTXO sessions reserve unique exact amounts and auto-verify by address history", async () => {
  const originalFetch = globalThis.fetch;

  try {
    let addressTxs: unknown[] = [];
    const txBodies = new Map<string, unknown>();
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/address/") && url.endsWith("/txs")) {
        return jsonResponse(addressTxs);
      }
      const txMatch = url.match(/\/tx\/([^/]+)$/);
      if (txMatch) {
        return jsonResponse(txBodies.get(txMatch[1] ?? "") ?? null, txBodies.has(txMatch[1] ?? "") ? 200 : 404);
      }
      return jsonResponse({ error: { message: `unexpected url ${url}` } }, 500);
    }) as typeof fetch;

    const { upsertVideoAccessPackage } = await import("./packages");
    const { createPaymentOperatorSession, getPaymentOperatorSessionStatus } = await import("./paymentOperator");

    const hostPubkey = "1".repeat(64);
    const viewerPubkey = "2".repeat(64);
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-utxo-operator",
      title: "UTXO operator package",
      paymentAsset: "btc",
      paymentAmount: "0.00042",
      paymentRailId: "utxo",
      paymentTarget: {
        version: 1,
        railId: "utxo",
        asset: "btc",
        destination: "bc1qsmokebtconchain0000000000000000000000000000",
        network: "bitcoin"
      },
      durationHours: 24,
      metadata: {
        paymentSession: {
          operatorEndpoint: "https://operator.example/utxo"
        }
      }
    });

    const created = await createPaymentOperatorSession({
      version: 1,
      sessionId: "utxo-built-in-session",
      package: {
        id: pkg.id,
        hostPubkey: pkg.hostPubkey,
        streamId: pkg.streamId,
        paymentAsset: pkg.paymentAsset,
        paymentAmount: pkg.paymentAmount,
        paymentRailId: "utxo",
        paymentTarget: pkg.paymentTarget
      },
      viewer: { pubkey: viewerPubkey }
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.status, "pending_operator");
    assert.notEqual(created.target.amountAtomic, "42000");

    const pending = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "utxo-built-in-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    assert.equal(pending.status, "pending_operator");

    addressTxs = [
      {
        txid: "btc-session-tx-1",
        status: { confirmed: true, block_time: Math.floor(Date.now() / 1000) },
        vout: [
          {
            scriptpubkey_address: created.target.destination,
            value: created.target.amountAtomic
          }
        ]
      }
    ];
    txBodies.set("btc-session-tx-1", {
      status: { confirmed: true },
      vout: [
        {
          scriptpubkey_address: created.target.destination,
          value: Number(created.target.amountAtomic)
        }
      ]
    });

    const verified = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "utxo-built-in-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.status, "verified");
    assert.equal(verified.settlement?.railId, "utxo");
    assert.equal(verified.settlement?.settlementKind, "utxo_output");
    assert.equal(verified.settlement?.txRef, "btc-session-tx-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("payment operator: built-in XRPL sessions allocate destination tags and auto-verify account history", async () => {
  const originalFetch = globalThis.fetch;
  const originalRpcUrl = process.env.DSTREAM_ACCESS_XRPL_RPC_URL;

  try {
    process.env.DSTREAM_ACCESS_XRPL_RPC_URL = "https://xrpl.example.com";
    globalThis.fetch = (async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: any[] };
      if (request.method === "account_tx") {
        return jsonResponse({
          result: {
            transactions: [
              {
                validated: true,
                tx: {
                  hash: "xrpl-session-tx-1",
                  TransactionType: "Payment",
                  Destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
                  DestinationTag: Number(request.params?.[0]?.account ? 0 : 0)
                },
                meta: {
                  TransactionResult: "tesSUCCESS",
                  delivered_amount: "12500000"
                }
              }
            ]
          }
        });
      }
      if (request.method === "tx") {
        return jsonResponse({
          result: {
            validated: true,
            Destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
            DestinationTag: 0,
            Amount: "12500000",
            meta: {
              TransactionResult: "tesSUCCESS",
              delivered_amount: "12500000"
            }
          }
        });
      }
      return jsonResponse({ error: { message: "unexpected xrpl rpc method" } }, 500);
    }) as typeof fetch;

    const { upsertVideoAccessPackage } = await import("./packages");
    const { createPaymentOperatorSession, getPaymentOperatorSessionStatus } = await import("./paymentOperator");

    const hostPubkey = "3".repeat(64);
    const viewerPubkey = "4".repeat(64);
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-xrpl-operator",
      title: "XRPL operator package",
      paymentAsset: "xrp",
      paymentAmount: "12.5",
      paymentRailId: "xrpl",
      paymentTarget: {
        version: 1,
        railId: "xrpl",
        asset: "xrp",
        destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
        network: "xrpl:testnet"
      },
      durationHours: 24,
      metadata: {
        paymentSession: {
          operatorEndpoint: "https://operator.example/xrpl"
        }
      }
    });

    const created = await createPaymentOperatorSession({
      version: 1,
      sessionId: "xrpl-built-in-session",
      package: {
        id: pkg.id,
        hostPubkey: pkg.hostPubkey,
        streamId: pkg.streamId,
        paymentAsset: pkg.paymentAsset,
        paymentAmount: pkg.paymentAmount,
        paymentRailId: "xrpl",
        paymentTarget: pkg.paymentTarget
      },
      viewer: { pubkey: viewerPubkey }
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.status, "pending_operator");
    assert.ok(created.target.reference);

    globalThis.fetch = (async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (request.method === "account_tx") {
        return jsonResponse({
          result: {
            transactions: [
              {
                validated: true,
                tx: {
                  hash: "xrpl-session-tx-1",
                  TransactionType: "Payment",
                  Destination: created.target.destination,
                  DestinationTag: Number(created.target.reference),
                  Amount: created.target.amountAtomic
                },
                meta: {
                  TransactionResult: "tesSUCCESS",
                  delivered_amount: created.target.amountAtomic
                }
              }
            ]
          }
        });
      }
      if (request.method === "tx") {
        return jsonResponse({
          result: {
            validated: true,
            Destination: created.target.destination,
            DestinationTag: Number(created.target.reference),
            Amount: created.target.amountAtomic,
            meta: {
              TransactionResult: "tesSUCCESS",
              delivered_amount: created.target.amountAtomic
            }
          }
        });
      }
      return jsonResponse({ error: { message: "unexpected xrpl rpc method" } }, 500);
    }) as typeof fetch;

    const verified = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "xrpl-built-in-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.status, "verified");
    assert.equal(verified.settlement?.railId, "xrpl");
    assert.equal(verified.settlement?.settlementKind, "xrpl_payment");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRpcUrl === undefined) delete process.env.DSTREAM_ACCESS_XRPL_RPC_URL;
    else process.env.DSTREAM_ACCESS_XRPL_RPC_URL = originalRpcUrl;
  }
});

test("payment operator: built-in Cardano sessions reserve unique exact amounts and auto-verify address history", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL;
  const originalProjectId = process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID;

  try {
    process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL = "https://cardano.example.com";
    process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID = "test-project";

    const { upsertVideoAccessPackage } = await import("./packages");
    const { createPaymentOperatorSession, getPaymentOperatorSessionStatus } = await import("./paymentOperator");

    const hostPubkey = "5".repeat(64);
    const viewerPubkey = "6".repeat(64);
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-cardano-operator",
      title: "Cardano operator package",
      paymentAsset: "ada",
      paymentAmount: "3.5",
      paymentRailId: "cardano",
      paymentTarget: {
        version: 1,
        railId: "cardano",
        asset: "ada",
        destination: "addr1vpsessioncardano0000000000000000000000000000000",
        network: "cardano:preprod"
      },
      durationHours: 24,
      metadata: {
        paymentSession: {
          operatorEndpoint: "https://operator.example/cardano"
        }
      }
    });

    const created = await createPaymentOperatorSession({
      version: 1,
      sessionId: "cardano-built-in-session",
      package: {
        id: pkg.id,
        hostPubkey: pkg.hostPubkey,
        streamId: pkg.streamId,
        paymentAsset: pkg.paymentAsset,
        paymentAmount: pkg.paymentAmount,
        paymentRailId: "cardano",
        paymentTarget: pkg.paymentTarget
      },
      viewer: { pubkey: viewerPubkey }
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.status, "pending_operator");
    assert.notEqual(created.target.amountAtomic, "3500000");

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/addresses/") && url.includes("/transactions")) {
        return jsonResponse([
          {
            tx_hash: "cardano-session-tx-1",
            block_time: Math.floor(Date.now() / 1000)
          }
        ]);
      }
      if (url.includes("/txs/cardano-session-tx-1/utxos")) {
        return jsonResponse({
          outputs: [
            {
              address: created.target.destination,
              amount: [
                {
                  unit: "lovelace",
                  quantity: created.target.amountAtomic
                }
              ]
            }
          ]
        });
      }
      return jsonResponse({ error: { message: `unexpected url ${url}` } }, 500);
    }) as typeof fetch;

    const verified = await getPaymentOperatorSessionStatus({
      version: 1,
      sessionId: "cardano-built-in-session",
      packageId: pkg.id,
      viewerPubkey
    });
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.status, "verified");
    assert.equal(verified.settlement?.railId, "cardano");
    assert.equal(verified.settlement?.settlementKind, "cardano_utxo_output");
    assert.equal(verified.settlement?.txRef, "cardano-session-tx-1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL;
    else process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL = originalBaseUrl;
    if (originalProjectId === undefined) delete process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID;
    else process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID = originalProjectId;
  }
});
