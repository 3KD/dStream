import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStreamAnnounceEvent } from "@dstream/protocol";
import bs58 from "bs58";
import { finalizeEvent, generateSecretKey, getPublicKey, type UnsignedEvent } from "nostr-tools";
import { makeOriginStreamId } from "../src/lib/origin";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function tronBase58ToHex(address: string): string {
  const decoded = Buffer.from(bs58.decode(address));
  return decoded.subarray(0, decoded.length - 4).toString("hex");
}

function formatAtomicDecimal(amountAtomic: string | undefined, decimals: number): string {
  const digits = String(amountAtomic ?? "0").replace(/\D/g, "") || "0";
  if (decimals <= 0) return digits;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function buildJsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function signEvent(secret: Uint8Array, event: Omit<UnsignedEvent, "pubkey">): ReturnType<typeof finalizeEvent> {
  return finalizeEvent(
    {
      ...event,
      pubkey: getPublicKey(secret)
    } as UnsignedEvent,
    secret
  );
}

function buildProofEvent(
  secret: Uint8Array,
  scope: "access_admin" | "access_purchase" | "access_viewer" | "watch_access",
  extraTags: string[][]
): ReturnType<typeof finalizeEvent> {
  return signEvent(secret, {
    kind: 27235,
    created_at: nowSec(),
    tags: [["dstream", scope], ["exp", String(nowSec() + 10 * 60)], ...extraTags],
    content: ""
  });
}

async function parseOkJson<T extends Record<string, unknown>>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || `request failed (${response.status})`);
  }
  return body;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "dstream-smoke-payments-"));
  const originalEnv = {
    accessStore: process.env.DSTREAM_ACCESS_STORE_PATH,
    videoStore: process.env.DSTREAM_Video_PACKAGE_STORE_PATH,
    sessionStore: process.env.DSTREAM_VIDEO_PACKAGE_SESSION_STORE_PATH,
    operatorStore: process.env.DSTREAM_PAYMENT_OPERATOR_STORE_PATH,
    legacyFallbacks: process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS,
    playbackSecret: process.env.DSTREAM_PLAYBACK_ACCESS_SECRET,
    verifierUrl: process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_URL,
    verifierSecret: process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_SECRET,
    xmrOrigin: process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN,
    xmrConfirmations: process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED,
    evmRpcUrl: process.env.DSTREAM_ACCESS_EVM_RPC_URL,
    solanaRpcUrl: process.env.DSTREAM_ACCESS_SOLANA_RPC_URL,
    tronRpcUrl: process.env.DSTREAM_ACCESS_TRON_RPC_URL,
    dogeRpcUrl: process.env.DSTREAM_ACCESS_DOGE_RPC_URL,
    bchRpcUrl: process.env.DSTREAM_ACCESS_BCH_RPC_URL,
    xrplRpcUrl: process.env.DSTREAM_ACCESS_XRPL_RPC_URL,
    cardanoUrl: process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL,
    cardanoProjectId: process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID
  };
  const originalFetch = globalThis.fetch;
  let xmrServer: ReturnType<typeof createServer> | null = null;

  process.env.DSTREAM_ACCESS_STORE_PATH = join(tempDir, "access.json");
  process.env.DSTREAM_Video_PACKAGE_STORE_PATH = join(tempDir, "video-packages.json");
  process.env.DSTREAM_VIDEO_PACKAGE_SESSION_STORE_PATH = join(tempDir, "payment-sessions.json");
  process.env.DSTREAM_PAYMENT_OPERATOR_STORE_PATH = join(tempDir, "payment-operator-sessions.json");
  process.env.DSTREAM_PLAYBACK_ACCESS_SECRET = "smoke-payments-secret";
  process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS = "1";
  delete process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_URL;
  delete process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_SECRET;
  process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED = "10";
    process.env.DSTREAM_ACCESS_EVM_RPC_URL = "https://evm.example.com";
    process.env.DSTREAM_ACCESS_SOLANA_RPC_URL = "https://solana.example.com";
    process.env.DSTREAM_ACCESS_TRON_RPC_URL = "https://tron.example.com";
    process.env.DSTREAM_ACCESS_DOGE_RPC_URL = "https://doge.example.com";
    process.env.DSTREAM_ACCESS_BCH_RPC_URL = "https://bch.example.com";
    process.env.DSTREAM_ACCESS_XRPL_RPC_URL = "https://xrpl.example.com";
    process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL = "https://cardano.example.com";
    process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID = "smoke-project";

  try {
    let xmrTransfers: Array<Record<string, unknown>> = [];
    const xmrAddressIndex = 17;
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
            address: "7BnERTpvL5MbCLtj5n9No7J5oE5hHiB3tVCK5cjSvCsYWD2WRJLFuWeKTLiXo5QJqt2ZwUaLy2Vh1Ad51K7FNgqcHgjW85o",
            address_index: xmrAddressIndex
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
    const xmrAddress = xmrServer.address();
    if (!xmrAddress || typeof xmrAddress === "string") throw new Error("failed to start XMR smoke wallet-rpc server");
    process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN = `http://127.0.0.1:${xmrAddress.port}`;

    const { POST: issuePlaybackAccessRoute } = await import("../app/api/playback-access/issue/route");
    const { POST: createPaymentSessionRoute } = await import("../app/api/access/video-packages/session/create/route");
    const { POST: observePaymentSessionRoute } = await import("../app/api/access/video-packages/session/observe/route");
    const { POST: paymentSessionStatusRoute } = await import("../app/api/access/video-packages/session/status/route");
    const { POST: upsertVideoPackageRoute } = await import("../app/api/access/video-packages/upsert/route");
    const { POST: viewerStatusRoute } = await import("../app/api/access/video-packages/viewer-status/route");
    const { POST: createBuiltInOperatorSessionRoute } = await import("../app/api/payment-operator/sessions/create/route");
    const { POST: statusBuiltInOperatorSessionRoute } = await import("../app/api/payment-operator/sessions/status/route");
    const { listVideoPackagePurchases } = await import("../src/lib/access/packages");
    const { authorizePlaybackProxyRequest } = await import("../src/lib/playback-access");

    const hostSecret = generateSecretKey();
    const viewerSecret = generateSecretKey();
    const hostPubkey = getPublicKey(hostSecret);
    const viewerPubkey = getPublicKey(viewerSecret);
    const streamId = "smoke-payments-1";

    const operatorProofEvent = buildProofEvent(hostSecret, "access_admin", [["host", hostPubkey]]);

    const remoteOperatorCases = [
      {
        key: "lightning",
        title: "Lightning archive pass",
        paymentAsset: "btc" as const,
        paymentAmount: "0.000015",
        paymentRailId: "lightning" as const,
        durationHours: 24,
        operatorLabel: "Host LN node",
        target: {
          version: 1 as const,
          railId: "lightning" as const,
          asset: "btc" as const,
          targetType: "invoice" as const,
          destination: "lnbc15u1p0smokepass",
          network: "lightning",
          amount: "0.000015",
          amountAtomic: "1500",
          walletUri: "lightning:lnbc15u1p0smokepass"
        },
        settlement: {
          version: 1 as const,
          railId: "lightning" as const,
          asset: "btc" as const,
          settlementKind: "bolt11_invoice",
          settlementRef: "invoice",
          txRef: "ln-settlement",
          amountAtomic: "1500",
          confirmed: true,
          observedAtMs: Date.now(),
          verifier: "host_origin" as const
        }
      },
      {
        key: "evm",
        title: "ETH operator archive",
        paymentAsset: "eth" as const,
        paymentAmount: "0.015",
        paymentRailId: "evm" as const,
        playlistId: "eth-operator",
        durationHours: 36,
        operatorLabel: "Host EVM operator",
        target: {
          version: 1 as const,
          railId: "evm" as const,
          asset: "eth" as const,
          targetType: "address" as const,
          destination: "0x3333333333333333333333333333333333333333",
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
        key: "solana",
        title: "Solana operator archive",
        paymentAsset: "sol" as const,
        paymentAmount: "0.25",
        paymentRailId: "solana" as const,
        playlistId: "sol-operator",
        durationHours: 60,
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
        key: "tron",
        title: "TRON operator archive",
        paymentAsset: "trx" as const,
        paymentAmount: "42",
        paymentRailId: "tron" as const,
        relativePath: "archives/tron/index.m3u8",
        durationHours: 84,
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
        key: "utxo",
        title: "BTC on-chain bundle",
        paymentAsset: "btc" as const,
        paymentAmount: "0.00042",
        paymentRailId: "utxo" as const,
        playlistId: "btc-onchain",
        durationHours: 48,
        operatorLabel: "Host BTC node",
        target: {
          version: 1 as const,
          railId: "utxo" as const,
          asset: "btc" as const,
          targetType: "address" as const,
          destination: "bcrt1qsmokebtconchain0000000000000000000000000000",
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
        key: "xrpl",
        title: "XRPL guild archive",
        paymentAsset: "xrp" as const,
        paymentAmount: "12.5",
        paymentRailId: "xrpl" as const,
        playlistId: "xrpl-premium",
        durationHours: 72,
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
          settlementRef: "xrpl-payment",
          txRef: "xrpl-tx-1",
          amountAtomic: "12500000",
          confirmed: true,
          observedAtMs: Date.now(),
          verifier: "host_origin" as const
        }
      },
      {
        key: "cardano",
        title: "Cardano file unlock",
        paymentAsset: "ada" as const,
        paymentAmount: "3.5",
        paymentRailId: "cardano" as const,
        relativePath: "archives/cardano/index.m3u8",
        durationHours: 96,
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
    const remotePackages: Record<
      string,
      {
        package: { id: string; paymentTarget?: { metadata?: Record<string, unknown> } };
        buyerProofEvent: ReturnType<typeof finalizeEvent>;
      }
    > = {};
    const builtInPackages: Record<
      string,
      {
        package: { id: string };
        buyerProofEvent: ReturnType<typeof finalizeEvent>;
      }
    > = {};
    const builtInSessions: Record<
      string,
      {
        id: string;
        target: { destination?: string; amountAtomic?: string; reference?: string };
      }
    > = {};

    for (const config of remoteOperatorCases) {
      const upsert = await parseOkJson<{
        package: { id: string; paymentTarget?: { metadata?: Record<string, unknown> } };
      }>(
        await upsertVideoPackageRoute(
          buildJsonRequest("http://localhost/api/access/video-packages/upsert", {
            hostPubkey,
            streamId,
            title: config.title,
            paymentAsset: config.paymentAsset,
            paymentAmount: config.paymentAmount,
            paymentRailId: config.paymentRailId,
            playlistId: config.playlistId,
            relativePath: config.relativePath,
            metadata: {
              paymentSession: {
                operatorEndpoint: `https://operator.example/${config.key}`,
                operatorLabel: config.operatorLabel
              }
            },
            durationHours: config.durationHours,
            operatorProofEvent
          })
        )
      );

      remotePackages[config.key] = {
        package: upsert.package,
        buyerProofEvent: buildProofEvent(viewerSecret, "access_purchase", [
          ["host", hostPubkey],
          ["pkg", upsert.package.id]
        ])
      };
      assert.equal(upsert.package.paymentTarget, undefined);
    }

    const evmRecipient = "0x2222222222222222222222222222222222222222";
    const evmUpsert = await parseOkJson<{
      package: { id: string };
    }>(
      await upsertVideoPackageRoute(
        buildJsonRequest("http://localhost/api/access/video-packages/upsert", {
          hostPubkey,
          streamId,
          playlistId: "season-one",
          title: "USDT season pass",
          paymentAsset: "usdt",
          paymentAmount: "1.25",
          paymentRailId: "evm",
          paymentTarget: {
            version: 1,
            railId: "evm",
            asset: "usdt",
            destination: evmRecipient,
            network: "ethereum"
          },
          metadata: {
            paymentSession: {
              proofMode: "client_tx_ref"
            }
          },
          durationHours: 72,
          operatorProofEvent
        })
      )
    );

    const evmBuyerProof = buildProofEvent(viewerSecret, "access_purchase", [
      ["host", hostPubkey],
      ["pkg", evmUpsert.package.id]
    ]);
    const xmrUpsert = await parseOkJson<{
      package: { id: string };
    }>(
      await upsertVideoPackageRoute(
        buildJsonRequest("http://localhost/api/access/video-packages/upsert", {
          hostPubkey,
          streamId,
          relativePath: "archives/xmr/index.m3u8",
          title: "XMR archive pass",
          paymentAsset: "xmr",
          paymentAmount: "1.5",
          paymentRailId: "xmr",
          durationHours: 24,
          operatorProofEvent
        })
      )
    );

    const xmrBuyerProof = buildProofEvent(viewerSecret, "access_purchase", [
      ["host", hostPubkey],
      ["pkg", xmrUpsert.package.id]
    ]);
    const builtInOperatorCases = [
      {
        key: "utxo_local",
        title: "BTC local operator archive",
        paymentAsset: "btc" as const,
        paymentAmount: "0.00042",
        paymentRailId: "utxo" as const,
        durationHours: 48,
        paymentTarget: {
          version: 1 as const,
          railId: "utxo" as const,
          asset: "btc" as const,
          destination: "bc1qsmokebtconchain0000000000000000000000000000",
          network: "bitcoin"
        }
      },
      {
        key: "doge_local",
        title: "DOGE local operator archive",
        paymentAsset: "doge" as const,
        paymentAmount: "42",
        paymentRailId: "utxo" as const,
        durationHours: 52,
        paymentTarget: {
          version: 1 as const,
          railId: "utxo" as const,
          asset: "doge" as const,
          destination: "D5jYjWcsf8P7T7TvM8S46HoPazTAp3GEXL",
          network: "dogecoin"
        }
      },
      {
        key: "bch_local",
        title: "BCH local operator archive",
        paymentAsset: "bch" as const,
        paymentAmount: "0.015",
        paymentRailId: "utxo" as const,
        durationHours: 56,
        paymentTarget: {
          version: 1 as const,
          railId: "utxo" as const,
          asset: "bch" as const,
          destination: `bitcoincash:q${"q".repeat(41)}`,
          network: "bitcoincash"
        }
      },
      {
        key: "evm_local",
        title: "EVM local operator archive",
        paymentAsset: "eth" as const,
        paymentAmount: "0.015",
        paymentRailId: "evm" as const,
        durationHours: 36,
        paymentTarget: {
          version: 1 as const,
          railId: "evm" as const,
          asset: "eth" as const,
          destination: "0x3333333333333333333333333333333333333333",
          network: "ethereum"
        }
      },
      {
        key: "solana_local",
        title: "Solana local operator archive",
        paymentAsset: "sol" as const,
        paymentAmount: "0.25",
        paymentRailId: "solana" as const,
        durationHours: 60,
        paymentTarget: {
          version: 1 as const,
          railId: "solana" as const,
          asset: "sol" as const,
          destination: "6pM2jN2B7J4yX8nUaWm4z3k2d3U6hC2YbA6DfQp4o9sK",
          network: "devnet"
        }
      },
      {
        key: "tron_local",
        title: "TRON local operator archive",
        paymentAsset: "trx" as const,
        paymentAmount: "42",
        paymentRailId: "tron" as const,
        durationHours: 84,
        paymentTarget: {
          version: 1 as const,
          railId: "tron" as const,
          asset: "trx" as const,
          destination: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
          network: "tron"
        }
      },
      {
        key: "xrpl_local",
        title: "XRPL local operator archive",
        paymentAsset: "xrp" as const,
        paymentAmount: "12.5",
        paymentRailId: "xrpl" as const,
        durationHours: 72,
        paymentTarget: {
          version: 1 as const,
          railId: "xrpl" as const,
          asset: "xrp" as const,
          destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
          network: "xrpl:testnet"
        }
      },
      {
        key: "cardano_local",
        title: "Cardano local operator archive",
        paymentAsset: "ada" as const,
        paymentAmount: "3.5",
        paymentRailId: "cardano" as const,
        durationHours: 96,
        paymentTarget: {
          version: 1 as const,
          railId: "cardano" as const,
          asset: "ada" as const,
          destination: "addr1vpsessioncardano0000000000000000000000000000000",
          network: "cardano:preprod"
        }
      }
    ];
    for (const config of builtInOperatorCases) {
      const upsert = await parseOkJson<{
        package: { id: string };
      }>(
        await upsertVideoPackageRoute(
          buildJsonRequest("http://localhost/api/access/video-packages/upsert", {
            hostPubkey,
            streamId,
            title: config.title,
            paymentAsset: config.paymentAsset,
            paymentAmount: config.paymentAmount,
            paymentRailId: config.paymentRailId,
            paymentTarget: config.paymentTarget,
            metadata: {
              paymentSession: {
                operatorEndpoint: "http://localhost/api/payment-operator",
                operatorLabel: "Built-in host operator"
              }
            },
            durationHours: config.durationHours,
            operatorProofEvent
          })
        )
      );

      builtInPackages[config.key] = {
        package: upsert.package,
        buyerProofEvent: buildProofEvent(viewerSecret, "access_purchase", [
          ["host", hostPubkey],
          ["pkg", upsert.package.id]
        ])
      };
    }
    const erc20Amount = 1_250_000n;
    const erc20Input = `0xa9059cbb${evmRecipient.replace(/^0x/, "").padStart(64, "0")}${erc20Amount.toString(16).padStart(64, "0")}`;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "http://localhost/api/payment-operator/sessions/create") {
        return createBuiltInOperatorSessionRoute(new Request(url, init as RequestInit));
      }
      if (url === "http://localhost/api/payment-operator/sessions/status") {
        return statusBuiltInOperatorSessionRoute(new Request(url, init as RequestInit));
      }
      const operatorMatch = url.match(/^https:\/\/operator\.example\/([^/]+)\/sessions\/(create|status)$/);
      if (operatorMatch) {
        const [, key, action] = operatorMatch;
        const config = remoteOperatorCases.find((row) => row.key === key);
        if (!config) return jsonResponse({ ok: false, error: "unexpected operator rail" }, 500);
        if (action === "create") {
          return jsonResponse({
            ok: true,
            status: "pending_operator",
            proofMode: "operator_observed",
            operatorLabel: config.operatorLabel,
            target: config.target
          });
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as { sessionId?: string };
        return jsonResponse({
          ok: true,
          status: "verified",
          settlement: {
            ...config.settlement,
            settlementRef: `${config.settlement.settlementRef}:${body.sessionId ?? "missing"}`,
            txRef: body.sessionId ?? config.settlement.txRef
          }
        });
      }
      if (url === "https://evm.example.com") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: any[] };
        const built = builtInSessions.evm_local;
        if (body.method === "eth_blockNumber") {
          return jsonResponse({ result: "0x10" });
        }
        if (body.method === "eth_getBlockByNumber") {
          return jsonResponse({
            result: {
              timestamp: `0x${nowSec().toString(16)}`,
              transactions: built
                ? [
                    {
                      hash: "evm-local-session-tx",
                      to: built.target.destination,
                      value: `0x${BigInt(built.target.amountAtomic ?? "0").toString(16)}`,
                      input: "0x"
                    }
                  ]
                : []
            }
          });
        }
        if (body.method === "eth_getTransactionByHash") {
          const txRef = String(body.params?.[0] ?? "");
          return jsonResponse({
            result:
              txRef === "0xevmsmoke"
                ? {
                    hash: "0xevmsmoke",
                    to: "0xdac17f958d2ee523a2206206994597c13d831ec7",
                    from: "0x9999999999999999999999999999999999999999",
                    value: "0x0",
                    input: erc20Input
                  }
                : built
                  ? {
                      hash: "evm-local-session-tx",
                      to: built.target.destination,
                      value: `0x${BigInt(built.target.amountAtomic ?? "0").toString(16)}`,
                      input: "0x"
                    }
                  : null
          });
        }
        if (body.method === "eth_getTransactionReceipt") {
          const txRef = String(body.params?.[0] ?? "");
          return jsonResponse({
            result:
              txRef === "0xevmsmoke"
                ? {
                    status: "0x1",
                    blockNumber: "0x10"
                  }
                : built
                  ? {
                      status: "0x1",
                      blockNumber: "0x10"
                    }
                  : null
          });
        }
      }
      if (url === "https://solana.example.com") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: any[] };
        const built = builtInSessions.solana_local;
        if (body.method === "getSignaturesForAddress") {
          return jsonResponse({
            result: built
              ? [
                  {
                    signature: "solana-local-session-tx",
                    blockTime: nowSec(),
                    err: null
                  }
                ]
              : []
          });
        }
        if (body.method === "getTransaction") {
          return jsonResponse({
            result: built
              ? {
                  meta: { err: null },
                  transaction: {
                    message: {
                      instructions: [
                        {
                          program: "system",
                          parsed: {
                            type: "transfer",
                            info: {
                              destination: built.target.destination,
                              lamports: built.target.amountAtomic
                            }
                          }
                        }
                      ]
                    }
                  }
                }
              : null
          });
        }
      }
      if (url.includes("https://tron.example.com/v1/accounts/") && url.includes("/transactions?")) {
        const built = builtInSessions.tron_local;
        return jsonResponse({
          data: built
            ? [
                {
                  txID: "tron-local-session-tx",
                  block_timestamp: Date.now(),
                  raw_data: {
                    contract: [
                      {
                        parameter: {
                          value: {
                            to_address: tronBase58ToHex(built.target.destination ?? ""),
                            amount: built.target.amountAtomic
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            : []
        });
      }
      if (url === "https://tron.example.com/wallet/gettransactionbyid") {
        const built = builtInSessions.tron_local;
        return jsonResponse(
          built
            ? {
                raw_data: {
                  contract: [
                    {
                      parameter: {
                        value: {
                          to_address: tronBase58ToHex(built.target.destination ?? ""),
                          amount: built.target.amountAtomic
                        }
                      }
                    }
                  ]
                },
                ret: [{ contractRet: "SUCCESS" }]
              }
            : null
        );
      }
      if (url === "https://tron.example.com/walletsolidity/gettransactioninfobyid") {
        const built = builtInSessions.tron_local;
        return jsonResponse(
          built
            ? {
                blockNumber: 321,
                receipt: { result: "SUCCESS" }
              }
            : null
        );
      }
      if (url.includes("https://blockstream.info/api/address/") && url.endsWith("/txs")) {
        const built = builtInSessions.utxo_local;
        return jsonResponse(
          built
            ? [
                {
                  txid: "btc-local-session-tx",
                  status: { confirmed: true, block_time: Math.floor(Date.now() / 1000) },
                  vout: [
                    {
                      scriptpubkey_address: built.target.destination,
                      value: built.target.amountAtomic
                    }
                  ]
                }
              ]
            : []
        );
      }
      if (url === "https://blockstream.info/api/tx/btc-local-session-tx") {
        const built = builtInSessions.utxo_local;
        return jsonResponse({
          status: { confirmed: true },
          vout: [
            {
              scriptpubkey_address: built?.target.destination,
              value: Number(built?.target.amountAtomic ?? "0")
            }
          ]
        });
      }
      if (url === "https://doge.example.com") {
        const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
        const built = builtInSessions.doge_local;
        if (request.method === "listreceivedbyaddress") {
          return jsonResponse({
            result: built
              ? [
                  {
                    address: built.target.destination,
                    txids: ["doge-local-session-tx"]
                  }
                ]
              : []
          });
        }
        if (request.method === "getrawtransaction") {
          return jsonResponse({
            result: built
              ? {
                  confirmations: 12,
                  vout: [
                    {
                      scriptPubKey: {
                        address: built.target.destination
                      },
                      value: formatAtomicDecimal(built.target.amountAtomic, 8)
                    }
                  ]
                }
              : null
          });
        }
      }
      if (url === "https://bch.example.com") {
        const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
        const built = builtInSessions.bch_local;
        if (request.method === "listreceivedbyaddress") {
          return jsonResponse({
            result: built
              ? [
                  {
                    address: built.target.destination,
                    txids: ["bch-local-session-tx"]
                  }
                ]
              : []
          });
        }
        if (request.method === "getrawtransaction") {
          return jsonResponse({
            result: built
              ? {
                  confirmations: 8,
                  vout: [
                    {
                      scriptPubKey: {
                        address: built.target.destination
                      },
                      value: formatAtomicDecimal(built.target.amountAtomic, 8)
                    }
                  ]
                }
              : null
          });
        }
      }
      if (url === "https://xrpl.example.com") {
        const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
        const built = builtInSessions.xrpl_local;
        if (request.method === "account_tx") {
          return jsonResponse({
            result: {
              transactions: built
                ? [
                    {
                      validated: true,
                      tx: {
                        hash: "xrpl-local-session-tx",
                        TransactionType: "Payment",
                        Destination: built.target.destination,
                        DestinationTag: Number(built.target.reference),
                        Amount: built.target.amountAtomic
                      },
                      meta: {
                        TransactionResult: "tesSUCCESS",
                        delivered_amount: built.target.amountAtomic
                      }
                    }
                  ]
                : []
            }
          });
        }
        if (request.method === "tx") {
          return jsonResponse({
            result: {
              validated: true,
              Destination: built?.target.destination,
              DestinationTag: Number(built?.target.reference),
              Amount: built?.target.amountAtomic,
              meta: {
                TransactionResult: "tesSUCCESS",
                delivered_amount: built?.target.amountAtomic
              }
            }
          });
        }
      }
      if (url.includes("https://cardano.example.com/addresses/") && url.includes("/transactions")) {
        return jsonResponse(
          builtInSessions.cardano_local
            ? [
                {
                  tx_hash: "cardano-local-session-tx",
                  block_time: Math.floor(Date.now() / 1000)
                }
              ]
            : []
        );
      }
      if (url === "https://cardano.example.com/txs/cardano-local-session-tx/utxos") {
        const built = builtInSessions.cardano_local;
        return jsonResponse({
          outputs: [
            {
              address: built?.target.destination,
              amount: [
                {
                  unit: "lovelace",
                  quantity: built?.target.amountAtomic
                }
              ]
            }
          ]
        });
      }
      const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      if (request.method === "eth_getTransactionByHash") {
        return jsonResponse({
          result: {
            to: "0xdac17f958d2ee523a2206206994597c13d831ec7",
            from: "0x9999999999999999999999999999999999999999",
            input: erc20Input
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
      return jsonResponse({ error: { message: "unexpected rpc method" } }, 500);
    }) as typeof fetch;

    for (const config of remoteOperatorCases) {
      const remote = remotePackages[config.key];
      const session = await parseOkJson<{
        session: { id: string; status: string; target?: { destination?: string; walletUri?: string; reference?: string } };
      }>(
        await createPaymentSessionRoute(
          buildJsonRequest("http://localhost/api/access/video-packages/session/create", {
            packageId: remote.package.id,
            buyerProofEvent: remote.buyerProofEvent,
            metadata: { origin: `smoke_payments_${config.key}` }
          })
        )
      );
      assert.equal(session.session.status, "pending_operator");
      assert.equal(session.session.target?.destination, config.target.destination);
      assert.equal(session.session.target?.reference, config.target.reference);
      if (config.target.walletUri) {
        assert.equal(session.session.target?.walletUri, config.target.walletUri);
      }

      const granted = await parseOkJson<{
        session: { status: string; settlement?: { railId?: string; settlementKind?: string } };
      }>(
        await paymentSessionStatusRoute(
          buildJsonRequest("http://localhost/api/access/video-packages/session/status", {
            sessionId: session.session.id
          })
        )
      );
      assert.equal(granted.session.status, "granted");
      assert.equal(granted.session.settlement?.railId, config.paymentRailId);
      assert.equal(granted.session.settlement?.settlementKind, config.settlement.settlementKind);
    }

    for (const config of builtInOperatorCases) {
      const built = builtInPackages[config.key];
      const session = await parseOkJson<{
        session: { id: string; status: string; target?: { destination?: string; amountAtomic?: string; reference?: string } };
      }>(
        await createPaymentSessionRoute(
          buildJsonRequest("http://localhost/api/access/video-packages/session/create", {
            packageId: built.package.id,
            buyerProofEvent: built.buyerProofEvent,
            metadata: { origin: `smoke_payments_${config.key}` }
          })
        )
      );
      assert.equal(session.session.status, "pending_operator");
      builtInSessions[config.key] = {
        id: session.session.id,
        target: session.session.target ?? {}
      };
      if (config.key === "utxo_local") {
        assert.notEqual(session.session.target?.amountAtomic, "42000");
      }
      if (config.key === "doge_local") {
        assert.notEqual(session.session.target?.amountAtomic, "4200000000");
      }
      if (config.key === "bch_local") {
        assert.notEqual(session.session.target?.amountAtomic, "1500000");
      }
      if (config.key === "evm_local") {
        assert.notEqual(session.session.target?.amountAtomic, "15000000000000000");
      }
      if (config.key === "solana_local") {
        assert.notEqual(session.session.target?.amountAtomic, "250000000");
      }
      if (config.key === "tron_local") {
        assert.notEqual(session.session.target?.amountAtomic, "42000000");
      }
      if (config.key === "xrpl_local") {
        assert.ok(session.session.target?.reference);
      }
      if (config.key === "cardano_local") {
        assert.notEqual(session.session.target?.amountAtomic, "3500000");
      }

      const granted = await parseOkJson<{
        session: { status: string; settlement?: { railId?: string; settlementKind?: string } };
      }>(
        await paymentSessionStatusRoute(
          buildJsonRequest("http://localhost/api/access/video-packages/session/status", {
            sessionId: session.session.id
          })
        )
      );
      assert.equal(granted.session.status, "granted");
      assert.equal(granted.session.settlement?.railId, config.paymentRailId);
    }

    const evmSession = await parseOkJson<{
      session: { id: string; status: string; proofMode?: string };
    }>(
      await createPaymentSessionRoute(
        buildJsonRequest("http://localhost/api/access/video-packages/session/create", {
          packageId: evmUpsert.package.id,
          buyerProofEvent: evmBuyerProof,
          metadata: { origin: "smoke_payments_evm" }
        })
      )
    );
    assert.equal(evmSession.session.status, "awaiting_payment");
    assert.equal(evmSession.session.proofMode, "client_tx_ref");

    const evmGranted = await parseOkJson<{
      session: { status: string; settlement?: { railId?: string; settlementKind?: string } };
    }>(
      await observePaymentSessionRoute(
        buildJsonRequest("http://localhost/api/access/video-packages/session/observe", {
          sessionId: evmSession.session.id,
          buyerProofEvent: evmBuyerProof,
          txRef: "0xevmsmoke",
          metadata: { origin: "smoke_payments_evm_observe" }
        })
      )
    );

    assert.equal(evmGranted.session.status, "granted");
    assert.equal(evmGranted.session.settlement?.railId, "evm");
    assert.equal(evmGranted.session.settlement?.settlementKind, "evm_erc20_transfer");

    const xmrSession = await parseOkJson<{
      session: { id: string; status: string; proofMode?: string; metadata?: Record<string, unknown> };
    }>(
      await createPaymentSessionRoute(
        buildJsonRequest("http://localhost/api/access/video-packages/session/create", {
          packageId: xmrUpsert.package.id,
          buyerProofEvent: xmrBuyerProof,
          metadata: { origin: "smoke_payments_xmr" }
        })
      )
    );
    assert.equal(xmrSession.session.status, "pending_operator");
    assert.equal(xmrSession.session.proofMode, "operator_observed");
    assert.equal(xmrSession.session.metadata?.xmrAddressIndex, xmrAddressIndex);

    xmrTransfers = [
      {
        amount: "1500000000000",
        confirmations: 12,
        subaddr_index: { major: 0, minor: xmrAddressIndex },
        txid: "xmrsmoketx",
        timestamp: Math.floor(Date.now() / 1000)
      }
    ];

    const xmrGranted = await parseOkJson<{
      session: { status: string; settlement?: { railId?: string; settlementKind?: string; txRef?: string } };
    }>(
      await paymentSessionStatusRoute(
        buildJsonRequest("http://localhost/api/access/video-packages/session/status", {
          sessionId: xmrSession.session.id
        })
      )
    );
    assert.equal(xmrGranted.session.status, "granted");
    assert.equal(xmrGranted.session.settlement?.railId, "xmr");
    assert.equal(xmrGranted.session.settlement?.settlementKind, "xmr_subaddress_transfer");
    assert.equal(xmrGranted.session.settlement?.txRef, "xmrsmoketx");

    globalThis.fetch = originalFetch;

    const viewerProofEvent = buildProofEvent(viewerSecret, "access_viewer", [["host", hostPubkey]]);
    const viewerStatus = await parseOkJson<{
      count: number;
      byPackageId: Record<string, { entitlementId: string }>;
    }>(
      await viewerStatusRoute(
        buildJsonRequest("http://localhost/api/access/video-packages/viewer-status", {
          hostPubkey,
          streamId,
          viewerProofEvent
        })
      )
    );

    assert.equal(viewerStatus.count >= remoteOperatorCases.length + builtInOperatorCases.length + 2, true);
    const missingRemoteUnlocks = remoteOperatorCases
      .map((config) => ({ key: config.key, packageId: remotePackages[config.key].package.id }))
      .filter(({ packageId }) => !viewerStatus.byPackageId[packageId]);
    const missingBuiltInUnlocks = builtInOperatorCases
      .map((config) => ({ key: config.key, packageId: builtInPackages[config.key].package.id }))
      .filter(({ packageId }) => !viewerStatus.byPackageId[packageId]);
    const missingSpecialUnlocks = [evmUpsert.package.id, xmrUpsert.package.id].filter(
      (packageId) => !viewerStatus.byPackageId[packageId]
    );
    assert.deepEqual(
      {
        remote: missingRemoteUnlocks,
        builtIn: missingBuiltInUnlocks,
        special: missingSpecialUnlocks
      },
      { remote: [], builtIn: [], special: [] }
    );

    const purchases = listVideoPackagePurchases({
      hostPubkey,
      viewerPubkey,
      limit: 32
    });
    assert.equal(purchases.length >= remoteOperatorCases.length + builtInOperatorCases.length + 2, true);
    for (const config of remoteOperatorCases) {
      assert.equal(
        purchases.some((row) => row.packageId === remotePackages[config.key].package.id && row.verifiedSettlement?.railId === config.paymentRailId),
        true
      );
    }
    for (const config of builtInOperatorCases) {
      assert.equal(
        purchases.some((row) => row.packageId === builtInPackages[config.key].package.id && row.verifiedSettlement?.railId === config.paymentRailId),
        true
      );
    }
    assert.equal(
      purchases.some((row) => row.packageId === evmUpsert.package.id && row.verifiedSettlement?.railId === "evm"),
      true
    );
    assert.equal(
      purchases.some((row) => row.packageId === xmrUpsert.package.id && row.verifiedSettlement?.railId === "xmr"),
      true
    );

    const announceEvent = signEvent(hostSecret, buildStreamAnnounceEvent({
      pubkey: hostPubkey,
      createdAt: nowSec(),
      streamId,
      title: "Smoke archive",
      status: "ended",
      videoArchiveEnabled: true,
      videoVisibility: "private"
    }) as UnsignedEvent);
    const originStreamId = makeOriginStreamId(hostPubkey, streamId);
    assert.ok(originStreamId);
    if (!originStreamId) throw new Error("failed to build origin stream id");

    const watchAccessProof = buildProofEvent(viewerSecret, "watch_access", [["stream", originStreamId]]);
    const playbackIssued = await parseOkJson<{
      token: string;
      originStreamId: string;
      privateVideo: boolean;
      videoVisibility: string;
    }>(
      await issuePlaybackAccessRoute(
        buildJsonRequest("http://localhost/api/playback-access/issue", {
          announceEvent,
          streamPubkey: hostPubkey,
          streamId,
          originStreamId,
          viewerProofEvent: watchAccessProof
        })
      )
    );

    assert.equal(playbackIssued.originStreamId, originStreamId);
    assert.equal(playbackIssued.privateVideo, true);
    assert.equal(playbackIssued.videoVisibility, "private");
    assert.equal(authorizePlaybackProxyRequest([originStreamId, "index.m3u8"], playbackIssued.token).ok, true);

    console.log("smoke:payments passed");
    for (const config of remoteOperatorCases) {
      console.log(`  ${config.key} package: ${remotePackages[config.key].package.id}`);
    }
    console.log(`  evm package: ${evmUpsert.package.id}`);
    console.log(`  xmr package: ${xmrUpsert.package.id}`);
    console.log(`  viewer unlocks: ${viewerStatus.count}`);
    console.log(`  playback token scope: ${playbackIssued.originStreamId}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (xmrServer) {
      await new Promise<void>((resolve, reject) => xmrServer!.close((error) => (error ? reject(error) : resolve())));
    }
    if (originalEnv.accessStore === undefined) delete process.env.DSTREAM_ACCESS_STORE_PATH;
    else process.env.DSTREAM_ACCESS_STORE_PATH = originalEnv.accessStore;
    if (originalEnv.videoStore === undefined) delete process.env.DSTREAM_Video_PACKAGE_STORE_PATH;
    else process.env.DSTREAM_Video_PACKAGE_STORE_PATH = originalEnv.videoStore;
    if (originalEnv.sessionStore === undefined) delete process.env.DSTREAM_VIDEO_PACKAGE_SESSION_STORE_PATH;
    else process.env.DSTREAM_VIDEO_PACKAGE_SESSION_STORE_PATH = originalEnv.sessionStore;
    if (originalEnv.operatorStore === undefined) delete process.env.DSTREAM_PAYMENT_OPERATOR_STORE_PATH;
    else process.env.DSTREAM_PAYMENT_OPERATOR_STORE_PATH = originalEnv.operatorStore;
    if (originalEnv.legacyFallbacks === undefined) delete process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS;
    else process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS = originalEnv.legacyFallbacks;
    if (originalEnv.playbackSecret === undefined) delete process.env.DSTREAM_PLAYBACK_ACCESS_SECRET;
    else process.env.DSTREAM_PLAYBACK_ACCESS_SECRET = originalEnv.playbackSecret;
    if (originalEnv.verifierUrl === undefined) delete process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_URL;
    else process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_URL = originalEnv.verifierUrl;
    if (originalEnv.verifierSecret === undefined) delete process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_SECRET;
    else process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_SECRET = originalEnv.verifierSecret;
    if (originalEnv.xmrOrigin === undefined) delete process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN;
    else process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN = originalEnv.xmrOrigin;
    if (originalEnv.xmrConfirmations === undefined) delete process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED;
    else process.env.DSTREAM_XMR_CONFIRMATIONS_REQUIRED = originalEnv.xmrConfirmations;
    if (originalEnv.evmRpcUrl === undefined) delete process.env.DSTREAM_ACCESS_EVM_RPC_URL;
    else process.env.DSTREAM_ACCESS_EVM_RPC_URL = originalEnv.evmRpcUrl;
    if (originalEnv.solanaRpcUrl === undefined) delete process.env.DSTREAM_ACCESS_SOLANA_RPC_URL;
    else process.env.DSTREAM_ACCESS_SOLANA_RPC_URL = originalEnv.solanaRpcUrl;
    if (originalEnv.tronRpcUrl === undefined) delete process.env.DSTREAM_ACCESS_TRON_RPC_URL;
    else process.env.DSTREAM_ACCESS_TRON_RPC_URL = originalEnv.tronRpcUrl;
    if (originalEnv.dogeRpcUrl === undefined) delete process.env.DSTREAM_ACCESS_DOGE_RPC_URL;
    else process.env.DSTREAM_ACCESS_DOGE_RPC_URL = originalEnv.dogeRpcUrl;
    if (originalEnv.bchRpcUrl === undefined) delete process.env.DSTREAM_ACCESS_BCH_RPC_URL;
    else process.env.DSTREAM_ACCESS_BCH_RPC_URL = originalEnv.bchRpcUrl;
    if (originalEnv.xrplRpcUrl === undefined) delete process.env.DSTREAM_ACCESS_XRPL_RPC_URL;
    else process.env.DSTREAM_ACCESS_XRPL_RPC_URL = originalEnv.xrplRpcUrl;
    if (originalEnv.cardanoUrl === undefined) delete process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL;
    else process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL = originalEnv.cardanoUrl;
    if (originalEnv.cardanoProjectId === undefined) delete process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID;
    else process.env.DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID = originalEnv.cardanoProjectId;
    rmSync(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("smoke:payments failed");
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
