import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ReadinessStatus = "ready" | "partial" | "blocked";

interface RequirementGroup {
  label: string;
  vars: string[];
  mode: "all" | "any";
  note?: string;
}

interface RailQaSpec {
  rail: string;
  assets: string;
  network: string;
  wallets: string[];
  automatedGate: string;
  targetData: string;
  fundedWalletPass: string;
  requirements: RequirementGroup[];
  partialWhenUnset?: string;
}

interface RailQaResult extends RailQaSpec {
  status: ReadinessStatus;
  missing: string[];
  configured: string[];
  notes: string[];
}

const ENV_FILE = (process.env.ENV_FILE ?? "").trim();
const REQUIRE_READY = process.env.WALLET_QA_REQUIRE_READY === "1";
const REQUIRE_ALL = process.env.WALLET_QA_REQUIRE_ALL === "1";
const JSON_OUTPUT = process.argv.includes("--json");

function parseEnvFile(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const overlay = (() => {
  if (!ENV_FILE) return {};
  const path = ENV_FILE.startsWith("/") ? ENV_FILE : resolve(process.cwd(), ENV_FILE);
  return parseEnvFile(readFileSync(path, "utf8"));
})();

function env(name: string): string {
  if (Object.prototype.hasOwnProperty.call(overlay, name)) return String(overlay[name] ?? "").trim();
  return String(process.env[name] ?? "").trim();
}

function configuredVars(vars: string[]): string[] {
  return vars.filter((name) => env(name).length > 0);
}

function evaluateGroup(group: RequirementGroup): { ready: boolean; configured: string[]; missing: string[] } {
  const configured = configuredVars(group.vars);
  const ready = group.mode === "all" ? configured.length === group.vars.length : configured.length > 0;
  return {
    ready,
    configured,
    missing: group.vars.filter((name) => !configured.includes(name))
  };
}

const railSpecs: RailQaSpec[] = [
  {
    rail: "xmr",
    assets: "XMR",
    network: "stagenet, regtest, or production daemon-backed wallet-rpc",
    wallets: ["Cake Wallet", "Feather", "monero-wallet-cli"],
    automatedGate: "npm run smoke:payments:live + npm run smoke:wallet:matrix",
    targetData: "unique wallet-rpc subaddress allocated per session",
    fundedWalletPass: "funded wallet sends to generated subaddress; verifier observes txid, amount, and confirmations",
    requirements: [
      {
        label: "Monero wallet-rpc",
        vars: ["DSTREAM_XMR_WALLET_RPC_ORIGIN"],
        mode: "all"
      }
    ]
  },
  {
    rail: "lightning",
    assets: "BTC over Lightning",
    network: "testnet, signet/regtest LN, or production Lightning",
    wallets: ["Phoenix", "Zeus", "Alby", "Breez"],
    automatedGate: "npm run smoke:payments:live plus NIP-57 zap receipt verification",
    targetData: "package LNURL or Lightning-address target that can issue a session-bound invoice",
    fundedWalletPass: "funded Lightning wallet pays the invoice; operator observes a verified zap receipt or settled invoice",
    requirements: [
      {
        label: "optional Lightning health endpoint",
        vars: ["DSTREAM_ACCESS_LIGHTNING_HEALTH_URL"],
        mode: "all",
        note: "Lightning targets are package-scoped, so this env only proves the configured health endpoint."
      }
    ],
    partialWhenUnset: "Lightning is package-target scoped; configure at least one LNURL/Lightning-address package and capture a paid invoice receipt."
  },
  {
    rail: "evm",
    assets: "ETH, ERC-20, USDT, USDC, PEPE",
    network: "Sepolia, Base Sepolia, Polygon Amoy, or production EVM chain",
    wallets: ["MetaMask", "Rabby", "Coinbase Wallet"],
    automatedGate: "npm run smoke:payments:live",
    targetData: "package target address plus session-specific amount delta/reference",
    fundedWalletPass: "wallet returns or operator observes tx hash; verifier checks recipient, asset, amount, chain, and confirmation",
    requirements: [
      {
        label: "EVM JSON-RPC",
        vars: [
          "DSTREAM_ACCESS_EVM_RPC_URL",
          "DSTREAM_ACCESS_EVM_RPC_ETHEREUM",
          "DSTREAM_ACCESS_EVM_RPC_BASE",
          "DSTREAM_ACCESS_EVM_RPC_POLYGON",
          "DSTREAM_ACCESS_EVM_RPC_BSC",
          "DSTREAM_ACCESS_EVM_RPC_OPTIMISM",
          "DSTREAM_ACCESS_EVM_RPC_ARBITRUM"
        ],
        mode: "any"
      }
    ]
  },
  {
    rail: "solana",
    assets: "SOL, SPL tokens",
    network: "devnet or production Solana",
    wallets: ["Phantom", "Solflare", "Backpack"],
    automatedGate: "npm run smoke:payments:live",
    targetData: "package target address plus session-specific lamport/token amount delta/reference",
    fundedWalletPass: "wallet returns or operator observes signature; verifier checks recipient, mint/native asset, amount, and confirmation",
    requirements: [
      {
        label: "Solana JSON-RPC",
        vars: ["DSTREAM_ACCESS_SOLANA_RPC_URL"],
        mode: "all"
      }
    ]
  },
  {
    rail: "tron",
    assets: "TRX, TRC-20",
    network: "Nile/Shasta or production TRON",
    wallets: ["TronLink", "Klever"],
    automatedGate: "npm run smoke:payments:live",
    targetData: "package target address plus session-specific SUN/token amount delta/reference",
    fundedWalletPass: "wallet returns or operator observes tx id; verifier checks recipient, asset, amount, and solidity confirmation",
    requirements: [
      {
        label: "TRON RPC",
        vars: ["DSTREAM_ACCESS_TRON_RPC_URL"],
        mode: "all"
      }
    ]
  },
  {
    rail: "btc",
    assets: "BTC",
    network: "signet/testnet or production Bitcoin",
    wallets: ["Sparrow", "Electrum", "BlueWallet"],
    automatedGate: "npm run smoke:payments:live",
    targetData: "package target address plus session-specific sat amount delta/reference",
    fundedWalletPass: "wallet broadcasts tx; verifier checks output address, sats, and confirmations",
    requirements: [
      {
        label: "Bitcoin Core RPC",
        vars: ["DSTREAM_ACCESS_BTC_RPC_URL"],
        mode: "all"
      }
    ],
    partialWhenUnset: "BTC has limited public fallback paths, but production wallet QA should use node RPC or an operator indexer."
  },
  {
    rail: "doge",
    assets: "DOGE",
    network: "testnet or production Dogecoin",
    wallets: ["Dogecoin Core", "MyDoge"],
    automatedGate: "npm run smoke:payments:live",
    targetData: "package target address plus session-specific atomic amount delta/reference",
    fundedWalletPass: "wallet broadcasts tx; verifier checks output address, atomic amount, and confirmations",
    requirements: [
      {
        label: "Dogecoin Core RPC",
        vars: ["DSTREAM_ACCESS_DOGE_RPC_URL"],
        mode: "all"
      }
    ]
  },
  {
    rail: "bch",
    assets: "BCH",
    network: "chipnet/testnet or production Bitcoin Cash",
    wallets: ["Electron Cash", "Bitcoin.com Wallet"],
    automatedGate: "npm run smoke:payments:live",
    targetData: "package target address plus session-specific sat amount delta/reference",
    fundedWalletPass: "wallet broadcasts tx; verifier checks output address, sats, and confirmations",
    requirements: [
      {
        label: "Bitcoin Cash node RPC",
        vars: ["DSTREAM_ACCESS_BCH_RPC_URL"],
        mode: "all"
      }
    ]
  },
  {
    rail: "xrpl",
    assets: "XRP",
    network: "XRPL testnet/devnet or production XRPL",
    wallets: ["Xaman", "GemWallet"],
    automatedGate: "npm run smoke:payments:live",
    targetData: "destination account plus session destination tag or amount delta/reference",
    fundedWalletPass: "wallet returns or operator observes transaction; verifier checks destination, tag/reference, amount, and validated ledger",
    requirements: [
      {
        label: "XRPL JSON-RPC",
        vars: ["DSTREAM_ACCESS_XRPL_RPC_URL"],
        mode: "all"
      }
    ]
  },
  {
    rail: "cardano",
    assets: "ADA",
    network: "preprod/preview or production Cardano",
    wallets: ["Lace", "Eternl", "Nami"],
    automatedGate: "npm run smoke:payments:live",
    targetData: "package target address plus session-specific lovelace amount delta/reference",
    fundedWalletPass: "wallet submits tx; verifier checks UTXO address, lovelace amount, and block confirmation",
    requirements: [
      {
        label: "Blockfrost/provider",
        vars: ["DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL", "DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID"],
        mode: "all"
      }
    ]
  }
];

function assessRail(spec: RailQaSpec): RailQaResult {
  const groupResults = spec.requirements.map(evaluateGroup);
  const configured = Array.from(new Set(groupResults.flatMap((result) => result.configured))).sort();
  const missing = Array.from(
    new Set(groupResults.filter((result) => !result.ready).flatMap((result) => result.missing))
  ).sort();
  const readyGroups = groupResults.filter((result) => result.ready).length;
  const anyConfigured = configured.length > 0;
  let status: ReadinessStatus = "blocked";
  if (readyGroups === spec.requirements.length) {
    status = "ready";
  } else if (anyConfigured || spec.partialWhenUnset) {
    status = "partial";
  }

  const notes = spec.requirements.flatMap((group) => (group.note ? [`${group.label}: ${group.note}`] : []));
  if (status !== "ready" && spec.partialWhenUnset) notes.push(spec.partialWhenUnset);

  return {
    ...spec,
    status,
    missing,
    configured,
    notes
  };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function shortList(values: string[], fallback: string, maxLength = 70): string {
  if (!values.length) return fallback;
  const joined = values.join(", ");
  return joined.length <= maxLength ? joined : `${joined.slice(0, Math.max(0, maxLength - 3))}...`;
}

function printHuman(results: RailQaResult[]): void {
  const ready = results.filter((result) => result.status === "ready").length;
  const partial = results.filter((result) => result.status === "partial").length;
  const blocked = results.filter((result) => result.status === "blocked").length;

  console.log("dStream wallet QA readiness");
  console.log(`  env file: ${ENV_FILE || "none"}`);
  console.log(`  strict mode: ${REQUIRE_ALL ? "all rails must be ready" : REQUIRE_READY ? "at least one rail must be ready" : "report only"}`);
  console.log("");
  console.log(`${pad("rail", 10)} ${pad("status", 8)} ${pad("wallets", 32)} missing/config note`);
  console.log(`${pad("-".repeat(10), 10)} ${pad("-".repeat(8), 8)} ${pad("-".repeat(32), 32)} ${"-".repeat(24)}`);

  for (const result of results) {
    const missing = shortList(result.missing, result.status === "ready" ? "configured" : "package/manual target required", 72);
    console.log(`${pad(result.rail, 10)} ${pad(result.status, 8)} ${pad(shortList(result.wallets, "n/a", 30), 32)} ${missing}`);
  }

  console.log("");
  console.log(`summary: ${ready} ready, ${partial} partial, ${blocked} blocked`);
  console.log("");
  console.log("Automated gates:");
  console.log("  npm run smoke:payments          # mocked route-level settlement/grant coverage for all rails");
  console.log("  npm run smoke:payments:live     # configured provider/node reachability");
  console.log("  npm run smoke:wallet:matrix     # XMR funded/manual or AUTO_INJECT wallet certification");
  console.log("");
  console.log("Funded-wallet pass criteria:");
  for (const result of results) {
    console.log(`  ${result.rail}: ${result.fundedWalletPass}`);
  }
  const notes = results.flatMap((result) => result.notes.map((note) => `${result.rail}: ${note}`));
  if (notes.length) {
    console.log("");
    console.log("Notes:");
    for (const note of notes) console.log(`  ${note}`);
  }
}

function main(): void {
  const results = railSpecs.map(assessRail);

  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify(
        {
          envFile: ENV_FILE || null,
          requireReady: REQUIRE_READY,
          requireAll: REQUIRE_ALL,
          summary: {
            ready: results.filter((result) => result.status === "ready").length,
            partial: results.filter((result) => result.status === "partial").length,
            blocked: results.filter((result) => result.status === "blocked").length
          },
          rails: results.map((result) => ({
            rail: result.rail,
            assets: result.assets,
            network: result.network,
            status: result.status,
            wallets: result.wallets,
            automatedGate: result.automatedGate,
            targetData: result.targetData,
            fundedWalletPass: result.fundedWalletPass,
            configured: result.configured,
            missing: result.missing,
            notes: result.notes
          }))
        },
        null,
        2
      )
    );
  } else {
    printHuman(results);
  }

  const ready = results.filter((result) => result.status === "ready");
  const notReady = results.filter((result) => result.status !== "ready");
  if (REQUIRE_ALL && notReady.length > 0) {
    console.error(`wallet QA readiness requires all rails ready; not ready: ${notReady.map((result) => result.rail).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (REQUIRE_READY && ready.length === 0) {
    console.error("wallet QA readiness requires at least one ready rail.");
    process.exitCode = 1;
  }
}

main();
