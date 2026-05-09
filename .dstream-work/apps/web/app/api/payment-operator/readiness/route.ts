import { getXmrConfirmationsRequired, getXmrWalletRpcAccountIndex, getXmrWalletRpcClient } from "@/lib/monero/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RailReadinessStatus = "ready" | "fallback" | "missing" | "error";

interface RailReadiness {
  railId: string;
  label: string;
  assets: string[];
  status: RailReadinessStatus;
  operatorMode: string;
  summary: string;
  requiredEnv: string[];
  configuredEnv: string[];
  missingEnv: string[];
  details?: Record<string, string | number | boolean>;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function configured(names: string[]): string[] {
  return names.filter((name) => !!env(name));
}

function missing(names: string[]): string[] {
  return names.filter((name) => !env(name));
}

function rail(input: {
  railId: string;
  label: string;
  assets: string[];
  status: RailReadinessStatus;
  operatorMode: string;
  summary: string;
  requiredEnv?: string[];
  details?: Record<string, string | number | boolean>;
}): RailReadiness {
  const requiredEnv = input.requiredEnv ?? [];
  return {
    railId: input.railId,
    label: input.label,
    assets: input.assets,
    status: input.status,
    operatorMode: input.operatorMode,
    summary: input.summary,
    requiredEnv,
    configuredEnv: configured(requiredEnv),
    missingEnv: missing(requiredEnv),
    details: input.details
  };
}

async function xmrReadiness(): Promise<RailReadiness> {
  const requiredEnv = ["DSTREAM_XMR_WALLET_RPC_ORIGIN"];
  const client = getXmrWalletRpcClient();
  if (!client) {
    return rail({
      railId: "xmr",
      label: "Monero",
      assets: ["XMR"],
      status: "missing",
      operatorMode: "embedded wallet-rpc",
      summary: "Wallet RPC is not configured.",
      requiredEnv,
      details: {
        accountIndex: getXmrWalletRpcAccountIndex(),
        confirmationsRequired: getXmrConfirmationsRequired()
      }
    });
  }

  try {
    const version = await client.getVersion();
    return rail({
      railId: "xmr",
      label: "Monero",
      assets: ["XMR"],
      status: "ready",
      operatorMode: "embedded wallet-rpc",
      summary: "Wallet RPC responded.",
      requiredEnv,
      details: {
        version: version.version,
        accountIndex: getXmrWalletRpcAccountIndex(),
        confirmationsRequired: getXmrConfirmationsRequired()
      }
    });
  } catch (error: any) {
    return rail({
      railId: "xmr",
      label: "Monero",
      assets: ["XMR"],
      status: "error",
      operatorMode: "embedded wallet-rpc",
      summary: error?.message ? `Wallet RPC error: ${error.message}` : "Wallet RPC did not respond.",
      requiredEnv,
      details: {
        accountIndex: getXmrWalletRpcAccountIndex(),
        confirmationsRequired: getXmrConfirmationsRequired()
      }
    });
  }
}

function evmReadiness(): RailReadiness {
  const evmEnv = [
    "DSTREAM_ACCESS_EVM_RPC_URL",
    "DSTREAM_ACCESS_EVM_RPC_ETHEREUM",
    "DSTREAM_ACCESS_EVM_RPC_POLYGON",
    "DSTREAM_ACCESS_EVM_RPC_BSC",
    "DSTREAM_ACCESS_EVM_RPC_OPTIMISM",
    "DSTREAM_ACCESS_EVM_RPC_ARBITRUM",
    "DSTREAM_ACCESS_EVM_RPC_BASE"
  ];
  const configuredEnv = configured(evmEnv);
  return rail({
    railId: "evm",
    label: "EVM",
    assets: ["ETH", "USDT", "USDC", "PEPE"],
    status: configuredEnv.length ? "ready" : "fallback",
    operatorMode: "amount-watch JSON-RPC",
    summary: configuredEnv.length ? "Explicit EVM RPC configured." : "Using public default RPC endpoints.",
    requiredEnv: evmEnv
  });
}

function simpleConfiguredRail(input: {
  railId: string;
  label: string;
  assets: string[];
  operatorMode: string;
  requiredEnv: string[];
  fallbackSummary?: string;
  readySummary?: string;
}): RailReadiness {
  const missingEnv = missing(input.requiredEnv);
  return rail({
    railId: input.railId,
    label: input.label,
    assets: input.assets,
    status: missingEnv.length ? (input.fallbackSummary ? "fallback" : "missing") : "ready",
    operatorMode: input.operatorMode,
    summary: missingEnv.length ? input.fallbackSummary ?? "Required provider configuration is missing." : input.readySummary ?? "Provider configuration is present.",
    requiredEnv: input.requiredEnv
  });
}

export async function GET(): Promise<Response> {
  const xmr = await xmrReadiness();
  const rails: RailReadiness[] = [
    xmr,
    rail({
      railId: "lightning",
      label: "Lightning",
      assets: ["BTC Lightning"],
      status: "fallback",
      operatorMode: "package LNURL / Lightning address",
      summary: "Readiness is package-scoped; packages need a reusable Lightning address or LNURL target.",
      requiredEnv: []
    }),
    simpleConfiguredRail({
      railId: "btc",
      label: "Bitcoin",
      assets: ["BTC"],
      operatorMode: "UTXO amount-watch",
      requiredEnv: ["DSTREAM_ACCESS_BTC_RPC_URL"],
      fallbackSummary: "BTC can use the public fallback verifier; configure Bitcoin RPC for production.",
      readySummary: "Bitcoin RPC is configured."
    }),
    simpleConfiguredRail({
      railId: "doge",
      label: "Dogecoin",
      assets: ["DOGE"],
      operatorMode: "UTXO amount-watch",
      requiredEnv: ["DSTREAM_ACCESS_DOGE_RPC_URL"],
      readySummary: "Dogecoin RPC is configured."
    }),
    simpleConfiguredRail({
      railId: "bch",
      label: "Bitcoin Cash",
      assets: ["BCH"],
      operatorMode: "UTXO amount-watch",
      requiredEnv: ["DSTREAM_ACCESS_BCH_RPC_URL"],
      readySummary: "Bitcoin Cash RPC is configured."
    }),
    evmReadiness(),
    simpleConfiguredRail({
      railId: "solana",
      label: "Solana",
      assets: ["SOL"],
      operatorMode: "signature-watch JSON-RPC",
      requiredEnv: ["DSTREAM_ACCESS_SOLANA_RPC_URL"],
      fallbackSummary: "Using Solana public/default RPC endpoints.",
      readySummary: "Solana RPC is configured."
    }),
    simpleConfiguredRail({
      railId: "tron",
      label: "TRON",
      assets: ["TRX", "USDT"],
      operatorMode: "address-history watch",
      requiredEnv: ["DSTREAM_ACCESS_TRON_RPC_URL"],
      fallbackSummary: "Using the default TronGrid-compatible endpoint.",
      readySummary: "TRON RPC is configured."
    }),
    simpleConfiguredRail({
      railId: "xrpl",
      label: "XRPL",
      assets: ["XRP"],
      operatorMode: "destination-tag watch",
      requiredEnv: ["DSTREAM_ACCESS_XRPL_RPC_URL"],
      fallbackSummary: "Using the default XRPL public endpoint.",
      readySummary: "XRPL RPC is configured."
    }),
    simpleConfiguredRail({
      railId: "cardano",
      label: "Cardano",
      assets: ["ADA"],
      operatorMode: "Blockfrost UTXO watch",
      requiredEnv: ["DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL", "DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID"],
      readySummary: "Cardano provider is configured."
    })
  ];

  return Response.json({
    ok: true,
    checkedAtMs: Date.now(),
    rails,
    summary: {
      ready: rails.filter((item) => item.status === "ready").length,
      fallback: rails.filter((item) => item.status === "fallback").length,
      missing: rails.filter((item) => item.status === "missing").length,
      error: rails.filter((item) => item.status === "error").length
    }
  });
}
