import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "dstream-payment-sessions-test-"));
process.env.DSTREAM_ACCESS_STORE_PATH = join(tempDir, "access.json");
process.env.DSTREAM_Video_PACKAGE_STORE_PATH = join(tempDir, "video-packages.json");
process.env.DSTREAM_VIDEO_PACKAGE_SESSION_STORE_PATH = join(tempDir, "payment-sessions.json");

test("payment sessions: payment operator route auth requires bearer in hardened mode", async () => {
  const previousToken = process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN;
  const previousRequire = process.env.DSTREAM_PAYMENT_OPERATOR_REQUIRE_BEARER;
  try {
    const { authorizePaymentOperatorRequest } = await import("../../../app/api/payment-operator/_lib");
    process.env.DSTREAM_PAYMENT_OPERATOR_REQUIRE_BEARER = "1";
    delete process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN;

    const missingToken = authorizePaymentOperatorRequest(new Request("https://operator.example/sessions/create"));
    assert.equal(missingToken?.status, 503);

    process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN = "test-payment-operator-token-123456789";
    const wrongToken = authorizePaymentOperatorRequest(
      new Request("https://operator.example/sessions/create", {
        headers: { authorization: "Bearer wrong-token" }
      })
    );
    assert.equal(wrongToken?.status, 401);

    const authorized = authorizePaymentOperatorRequest(
      new Request("https://operator.example/sessions/create", {
        headers: { authorization: "Bearer test-payment-operator-token-123456789" }
      })
    );
    assert.equal(authorized, null);
  } finally {
    if (previousToken === undefined) delete process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN;
    else process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN = previousToken;
    if (previousRequire === undefined) delete process.env.DSTREAM_PAYMENT_OPERATOR_REQUIRE_BEARER;
    else process.env.DSTREAM_PAYMENT_OPERATOR_REQUIRE_BEARER = previousRequire;
  }
});

test("payment sessions: embedded session auto-grants after client tx hash verification", async () => {
  const originalFetch = globalThis.fetch;
  const originalLegacyFallback = process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS;
  try {
    process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS = "1";
    const { upsertVideoAccessPackage } = await import("./packages");
    const { createVideoPackagePaymentSession, observeVideoPackagePaymentSession } = await import("./paymentSessions");

    const hostPubkey = "1".repeat(64);
    const viewerPubkey = "2".repeat(64);
    const recipient = "0x2222222222222222222222222222222222222222";
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-embedded",
      title: "Embedded USDT package",
      paymentAsset: "usdt",
      paymentAmount: "1.25",
      paymentRailId: "evm",
      paymentTarget: {
        version: 1,
        railId: "evm",
        asset: "usdt",
        destination: recipient,
        network: "ethereum"
      },
      durationHours: 24,
      metadata: {
        paymentSession: {
          proofMode: "client_tx_ref"
        }
      }
    });

    const transferAmount = 1_250_000n;
    const erc20Input = `0xa9059cbb${recipient.replace(/^0x/, "").padStart(64, "0")}${transferAmount.toString(16).padStart(64, "0")}`;
    globalThis.fetch = (async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (request.method === "eth_getTransactionByHash") {
        return new Response(
          JSON.stringify({
            result: {
              to: "0xdac17f958d2ee523a2206206994597c13d831ec7",
              from: "0x9999999999999999999999999999999999999999",
              input: erc20Input
            }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      if (request.method === "eth_getTransactionReceipt") {
        return new Response(
          JSON.stringify({
            result: {
              status: "0x1",
              blockNumber: "0x10"
            }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ error: { message: "unexpected rpc call" } }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const session = await createVideoPackagePaymentSession({
      packageId: pkg.id,
      viewerPubkey,
      metadata: { origin: "test_embedded" }
    });
    assert.equal(session.status, "awaiting_payment");
    assert.equal(session.proofMode, "client_tx_ref");

    const granted = await observeVideoPackagePaymentSession({
      sessionId: session.id,
      txRef: "0xabc123"
    });
    assert.equal(granted.status, "granted");
    assert.equal(granted.settlement?.railId, "evm");
    assert.ok(granted.purchaseId);
    assert.ok(granted.entitlementId);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLegacyFallback === undefined) delete process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS;
    else process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS = originalLegacyFallback;
  }
});

test("payment sessions: remote node-operator session grants access across operator-observed rails", async () => {
  const originalFetch = globalThis.fetch;
  const originalOperatorToken = process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN;
  try {
    const { upsertVideoAccessPackage } = await import("./packages");
    const { createVideoPackagePaymentSession, syncVideoPackagePaymentSession } = await import("./paymentSessions");

    const hostPubkey = "3".repeat(64);
    const viewerPubkey = "4".repeat(64);
    const operatorToken = "remote-operator-token-123456789012345";
    process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN = operatorToken;
    const seenAuthorizations: string[] = [];
    const cases = [
      {
        label: "lightning",
        asset: "btc" as const,
        amount: "0.000015",
        railId: "lightning" as const,
        operatorLabel: "Host LN node",
        target: {
          version: 1 as const,
          railId: "lightning" as const,
          asset: "btc" as const,
          targetType: "invoice" as const,
          destination: "lnbc15u1p0sessioninvoice",
          network: "lightning",
          amount: "0.000015",
          amountAtomic: "1500",
          walletUri: "lightning:lnbc15u1p0sessioninvoice"
        },
        settlement: {
          version: 1 as const,
          railId: "lightning" as const,
          asset: "btc" as const,
          settlementKind: "bolt11_invoice",
          settlementRef: "invoice:settlement",
          txRef: "invoice-settlement",
          amountAtomic: "1500",
          confirmed: true,
          observedAtMs: Date.now(),
          verifier: "host_origin" as const
        }
      },
      {
        label: "evm",
        asset: "eth" as const,
        amount: "0.015",
        railId: "evm" as const,
        operatorLabel: "Host EVM operator",
        target: {
          version: 1 as const,
          railId: "evm" as const,
          asset: "eth" as const,
          targetType: "address" as const,
          destination: "0x2222222222222222222222222222222222222222",
          network: "ethereum",
          amount: "0.015",
          amountAtomic: "15000000000000000"
        },
        settlement: {
          version: 1 as const,
          railId: "evm" as const,
          asset: "eth" as const,
          settlementKind: "evm_native_transfer",
          settlementRef: "evm-tx",
          txRef: "evm-tx",
          amountAtomic: "15000000000000000",
          confirmed: true,
          observedAtMs: Date.now(),
          verifier: "host_origin" as const
        }
      },
      {
        label: "solana",
        asset: "sol" as const,
        amount: "0.25",
        railId: "solana" as const,
        operatorLabel: "Host Solana operator",
        target: {
          version: 1 as const,
          railId: "solana" as const,
          asset: "sol" as const,
          targetType: "address" as const,
          destination: "6pM2jN2B7J4yX8nUaWm4z3k2d3U6hC2YbA6DfQp4o9sK",
          network: "solana:devnet",
          amount: "0.25",
          amountAtomic: "250000000"
        },
        settlement: {
          version: 1 as const,
          railId: "solana" as const,
          asset: "sol" as const,
          settlementKind: "solana_native_transfer",
          settlementRef: "solana-tx",
          txRef: "solana-tx",
          amountAtomic: "250000000",
          confirmed: true,
          observedAtMs: Date.now(),
          verifier: "host_origin" as const
        }
      },
      {
        label: "tron",
        asset: "trx" as const,
        amount: "42",
        railId: "tron" as const,
        operatorLabel: "Host TRON operator",
        target: {
          version: 1 as const,
          railId: "tron" as const,
          asset: "trx" as const,
          targetType: "address" as const,
          destination: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
          network: "tron",
          amount: "42",
          amountAtomic: "42000000"
        },
        settlement: {
          version: 1 as const,
          railId: "tron" as const,
          asset: "trx" as const,
          settlementKind: "tron_native_transfer",
          settlementRef: "tron-tx",
          txRef: "tron-tx",
          amountAtomic: "42000000",
          confirmed: true,
          observedAtMs: Date.now(),
          verifier: "host_origin" as const
        }
      },
      {
        label: "utxo",
        asset: "btc" as const,
        amount: "0.00042",
        railId: "utxo" as const,
        operatorLabel: "Host BTC node",
        target: {
          version: 1 as const,
          railId: "utxo" as const,
          asset: "btc" as const,
          targetType: "address" as const,
          destination: "bcrt1qsessionbtc0000000000000000000000000000000",
          network: "bitcoin:regtest",
          amount: "0.00042",
          amountAtomic: "42000"
        },
        settlement: {
          version: 1 as const,
          railId: "utxo" as const,
          asset: "btc" as const,
          settlementKind: "utxo_output",
          settlementRef: "btc-tx:0",
          txRef: "btc-tx",
          amountAtomic: "42000",
          confirmed: true,
          observedAtMs: Date.now(),
          verifier: "host_origin" as const
        }
      },
      {
        label: "xrpl",
        asset: "xrp" as const,
        amount: "12.5",
        railId: "xrpl" as const,
        operatorLabel: "Host XRPL operator",
        target: {
          version: 1 as const,
          railId: "xrpl" as const,
          asset: "xrp" as const,
          targetType: "address" as const,
          destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
          network: "xrpl:testnet",
          reference: "4821",
          amount: "12.5",
          amountAtomic: "12500000"
        },
        settlement: {
          version: 1 as const,
          railId: "xrpl" as const,
          asset: "xrp" as const,
          settlementKind: "xrpl_payment",
          settlementRef: "xrpl-payment:4821",
          txRef: "xrpl-tx-1",
          amountAtomic: "12500000",
          confirmed: true,
          observedAtMs: Date.now(),
          verifier: "host_origin" as const
        }
      },
      {
        label: "cardano",
        asset: "ada" as const,
        amount: "3.5",
        railId: "cardano" as const,
        operatorLabel: "Host Cardano operator",
        target: {
          version: 1 as const,
          railId: "cardano" as const,
          asset: "ada" as const,
          targetType: "address" as const,
          destination: "addr_test1vpsessioncardano0000000000000000000000000000000",
          network: "cardano:preprod",
          amount: "3.5",
          amountAtomic: "3500000"
        },
        settlement: {
          version: 1 as const,
          railId: "cardano" as const,
          asset: "ada" as const,
          settlementKind: "cardano_utxo_output",
          settlementRef: "cardano-tx-1:0",
          txRef: "cardano-tx-1",
          amountAtomic: "3500000",
          confirmed: true,
          observedAtMs: Date.now(),
          verifier: "host_origin" as const
        }
      }
    ];

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      seenAuthorizations.push(new Headers(init?.headers).get("authorization") ?? "");
      const match = url.match(/^https:\/\/operator\.example\/([^/]+)\/sessions\/(create|status)$/);
      if (!match) {
        return new Response(JSON.stringify({ ok: false, error: "unexpected fetch" }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
      const [, railId, action] = match;
      const config = cases.find((row) => row.railId === railId);
      if (!config) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "unexpected rail"
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" }
          }
        );
      }
      if (action === "create") {
        return new Response(
          JSON.stringify({
            ok: true,
            status: "pending_operator",
            proofMode: "operator_observed",
            operatorLabel: config.operatorLabel,
            target: config.target
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      if (action === "status") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { sessionId?: string };
        return new Response(
          JSON.stringify({
            ok: true,
            status: "verified",
            settlement: {
              ...config.settlement,
              settlementRef: `${config.settlement.settlementRef}:${body.sessionId ?? "missing"}`,
              txRef: body.sessionId ?? config.settlement.txRef
            }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ ok: false, error: "unexpected fetch" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    for (const config of cases) {
      const pkg = upsertVideoAccessPackage({
        hostPubkey,
        streamId: `stream-remote-${config.railId}`,
        title: `Remote ${config.label} package`,
        paymentAsset: config.asset,
        paymentAmount: config.amount,
        paymentRailId: config.railId,
        durationHours: 24,
        metadata: {
          paymentSession: {
            operatorEndpoint: `https://operator.example/${config.railId}`,
            operatorLabel: config.operatorLabel
          }
        }
      });

      const session = await createVideoPackagePaymentSession({
        packageId: pkg.id,
        viewerPubkey,
        metadata: { origin: `test_remote_${config.railId}` }
      });
      assert.equal(session.operator.transport, "http");
      assert.equal(session.status, "pending_operator");
      assert.equal(session.proofMode, "operator_observed");
      assert.equal(session.target.destination, config.target.destination);
      assert.equal(session.target.reference, config.target.reference);

      const granted = await syncVideoPackagePaymentSession(session.id);
      assert.equal(granted.status, "granted");
      assert.equal(granted.settlement?.railId, config.railId);
      assert.equal(granted.settlement?.settlementKind, config.settlement.settlementKind);
      assert.ok(granted.purchaseId);
    }
    assert.ok(seenAuthorizations.length >= cases.length * 2);
    assert.ok(seenAuthorizations.every((value) => value === `Bearer ${operatorToken}`));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOperatorToken === undefined) delete process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN;
    else process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN = originalOperatorToken;
  }
});

test("payment sessions: xmr embedded session allocates a unique subaddress and grants after wallet-rpc observation", async () => {
  const originalOrigin = process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN;
  const originalConfirmations = process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED;
  let transfers: Array<Record<string, unknown>> = [];
  const createdAddressIndex = 11;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
      id?: string | number;
      method?: string;
    };
    const respond = (result: unknown) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id ?? "0",
          result
        })
      );
    };

      switch (body.method) {
      case "create_address":
        respond({
          address: "7BnERTpvL5MbCLtj5n9No7J5oE5hHiB3tVCK5cjSvCsYWD2WRJLFuWeKTLiXo5QJqt2ZwUaLy2Vh1Ad51K7FNgqcHgjW85o",
          address_index: createdAddressIndex
        });
        return;
      case "refresh":
        respond({});
        return;
      case "get_transfers":
        respond({
          in: transfers,
          pending: [],
          pool: []
        });
        return;
      default:
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id ?? "0",
            error: { code: -1, message: `unexpected method ${body.method ?? "unknown"}` }
          })
        );
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind xmr wallet-rpc test server");

  process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN = `http://127.0.0.1:${address.port}`;
  process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED = "10";

  try {
    const { upsertVideoAccessPackage } = await import("./packages");
    const { createVideoPackagePaymentSession, syncVideoPackagePaymentSession } = await import("./paymentSessions");

    const hostPubkey = "5".repeat(64);
    const viewerPubkey = "6".repeat(64);
    const pkg = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "stream-xmr",
      title: "XMR archive pass",
      paymentAsset: "xmr",
      paymentAmount: "1.5",
      paymentRailId: "xmr",
      durationHours: 24
    });

    const session = await createVideoPackagePaymentSession({
      packageId: pkg.id,
      viewerPubkey,
      metadata: { origin: "test_xmr_embedded" }
    });
    assert.equal(session.status, "pending_operator");
    assert.equal(session.proofMode, "operator_observed");
    assert.equal(session.metadata?.xmrAddressIndex, createdAddressIndex);
    assert.equal(session.target.destination, "7BnERTpvL5MbCLtj5n9No7J5oE5hHiB3tVCK5cjSvCsYWD2WRJLFuWeKTLiXo5QJqt2ZwUaLy2Vh1Ad51K7FNgqcHgjW85o");

    const pending = await syncVideoPackagePaymentSession(session.id);
    assert.equal(pending.status, "pending_operator");

    transfers = [
      {
        amount: "1500000000000",
        confirmations: 12,
        subaddr_index: { major: 0, minor: createdAddressIndex },
        txid: "abc123xmr",
        timestamp: Math.floor(Date.now() / 1000)
      }
    ];

    const granted = await syncVideoPackagePaymentSession(session.id);
    assert.equal(granted.status, "granted");
    assert.equal(granted.settlement?.railId, "xmr");
    assert.equal(granted.settlement?.settlementKind, "xmr_subaddress_transfer");
    assert.equal(granted.settlement?.txRef, "abc123xmr");
    assert.ok(granted.purchaseId);
    assert.ok(granted.entitlementId);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (originalOrigin === undefined) delete process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN;
    else process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN = originalOrigin;
    if (originalConfirmations === undefined) delete process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED;
    else process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED = originalConfirmations;
  }
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
