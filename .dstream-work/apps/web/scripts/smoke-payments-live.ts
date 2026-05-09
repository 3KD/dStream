import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MoneroWalletRpcClient } from "../src/lib/monero/walletRpc";

type ProbeStatus = "ok" | "skip" | "fail";

interface ProbeResult {
  rail: string;
  status: ProbeStatus;
  message: string;
}

const ENV_FILE = (process.env.ENV_FILE ?? "").trim();
const FETCH_TIMEOUT_MS = Number(process.env.PAYMENT_LIVE_SMOKE_TIMEOUT_MS ?? "8000");

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

function basicAuthHeaders(user: string, pass: string): Record<string, string> | undefined {
  if (!user || !pass) return undefined;
  return { authorization: `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}` };
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function postJsonRpc<T>(input: {
  url: string;
  method: string;
  params?: unknown[];
  headers?: Record<string, string>;
}): Promise<T> {
  const response = await fetchWithTimeout(input.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.headers ?? {})
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "live-smoke",
      method: input.method,
      params: input.params ?? []
    })
  });
  const body = (await response.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
  if (!response.ok || !body) throw new Error(`HTTP ${response.status}`);
  if (body.error) throw new Error(body.error.message || `${input.method} returned JSON-RPC error`);
  return body.result as T;
}

async function probeXmr(): Promise<ProbeResult> {
  const origin = env("DSTREAM_XMR_WALLET_RPC_ORIGIN");
  if (!origin) return { rail: "xmr", status: "skip", message: "DSTREAM_XMR_WALLET_RPC_ORIGIN is not set." };
  const client = new MoneroWalletRpcClient({
    origin,
    username: env("DSTREAM_XMR_WALLET_RPC_USER") || undefined,
    password: env("DSTREAM_XMR_WALLET_RPC_PASS") || undefined,
    timeoutMs: FETCH_TIMEOUT_MS
  });
  const version = await client.getVersion();
  return { rail: "xmr", status: "ok", message: `wallet-rpc version ${version.version}` };
}

async function probeEvm(): Promise<ProbeResult> {
  const url =
    env("DSTREAM_ACCESS_EVM_RPC_URL") ||
    env("DSTREAM_ACCESS_EVM_RPC_ETHEREUM") ||
    env("DSTREAM_ACCESS_EVM_RPC_BASE") ||
    env("DSTREAM_ACCESS_EVM_RPC_POLYGON") ||
    env("DSTREAM_ACCESS_EVM_RPC_BSC") ||
    env("DSTREAM_ACCESS_EVM_RPC_OPTIMISM") ||
    env("DSTREAM_ACCESS_EVM_RPC_ARBITRUM");
  if (!url) return { rail: "evm", status: "skip", message: "No explicit EVM RPC env is set." };
  const blockNumber = await postJsonRpc<string>({ url, method: "eth_blockNumber" });
  return { rail: "evm", status: "ok", message: `latest block ${blockNumber}` };
}

async function probeSolana(): Promise<ProbeResult> {
  const url = env("DSTREAM_ACCESS_SOLANA_RPC_URL");
  if (!url) return { rail: "solana", status: "skip", message: "DSTREAM_ACCESS_SOLANA_RPC_URL is not set." };
  const health = await postJsonRpc<string>({ url, method: "getHealth" });
  return { rail: "solana", status: "ok", message: `health ${health}` };
}

async function probeTron(): Promise<ProbeResult> {
  const url = env("DSTREAM_ACCESS_TRON_RPC_URL").replace(/\/$/, "");
  if (!url) return { rail: "tron", status: "skip", message: "DSTREAM_ACCESS_TRON_RPC_URL is not set." };
  const response = await fetchWithTimeout(`${url}/wallet/getnowblock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  const body = (await response.json().catch(() => null)) as { blockID?: string } | null;
  if (!response.ok || !body?.blockID) throw new Error(`TRON getnowblock failed (${response.status})`);
  return { rail: "tron", status: "ok", message: `block ${body.blockID.slice(0, 16)}` };
}

async function probeXrpl(): Promise<ProbeResult> {
  const url = env("DSTREAM_ACCESS_XRPL_RPC_URL");
  if (!url) return { rail: "xrpl", status: "skip", message: "DSTREAM_ACCESS_XRPL_RPC_URL is not set." };
  const result = await postJsonRpc<{ info?: { validated_ledger?: { seq?: number } } }>({ url, method: "server_info", params: [{}] });
  const seq = result?.info?.validated_ledger?.seq;
  return { rail: "xrpl", status: "ok", message: seq ? `validated ledger ${seq}` : "server_info responded" };
}

async function probeCardano(): Promise<ProbeResult> {
  const baseUrl = env("DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL").replace(/\/$/, "");
  const projectId = env("DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID");
  if (!baseUrl || !projectId) {
    return {
      rail: "cardano",
      status: "skip",
      message: "DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL or DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID is not set."
    };
  }
  const response = await fetchWithTimeout(`${baseUrl}/blocks/latest`, {
    headers: { project_id: projectId }
  });
  const body = (await response.json().catch(() => null)) as { hash?: string; height?: number } | null;
  if (!response.ok || !body?.hash) throw new Error(`Cardano latest block failed (${response.status})`);
  return { rail: "cardano", status: "ok", message: body.height ? `block height ${body.height}` : `block ${body.hash.slice(0, 16)}` };
}

async function probeUtxo(asset: "btc" | "doge" | "bch"): Promise<ProbeResult> {
  const prefix = `DSTREAM_ACCESS_${asset.toUpperCase()}_RPC`;
  const url = env(`${prefix}_URL`);
  if (!url) return { rail: asset, status: "skip", message: `${prefix}_URL is not set.` };
  const headers = basicAuthHeaders(env(`${prefix}_USER`), env(`${prefix}_PASS`));
  const info = await postJsonRpc<{ blocks?: number; chain?: string }>({ url, method: "getblockchaininfo", headers });
  return {
    rail: asset,
    status: "ok",
    message: `${info.chain ?? "chain"} height ${typeof info.blocks === "number" ? info.blocks : "unknown"}`
  };
}

async function probeLightning(): Promise<ProbeResult> {
  const healthUrl = env("DSTREAM_ACCESS_LIGHTNING_HEALTH_URL");
  if (!healthUrl) {
    return {
      rail: "lightning",
      status: "skip",
      message: "No global Lightning health endpoint is configured; Lightning readiness is package-target scoped."
    };
  }
  const response = await fetchWithTimeout(healthUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Lightning health endpoint returned ${response.status}`);
  return { rail: "lightning", status: "ok", message: `health endpoint ${response.status}` };
}

async function runProbe(name: string, fn: () => Promise<ProbeResult>): Promise<ProbeResult> {
  try {
    return await fn();
  } catch (error: any) {
    return {
      rail: name,
      status: "fail",
      message: error?.message ?? "probe failed"
    };
  }
}

async function main(): Promise<void> {
  const results = await Promise.all([
    runProbe("xmr", probeXmr),
    runProbe("lightning", probeLightning),
    runProbe("btc", () => probeUtxo("btc")),
    runProbe("doge", () => probeUtxo("doge")),
    runProbe("bch", () => probeUtxo("bch")),
    runProbe("evm", probeEvm),
    runProbe("solana", probeSolana),
    runProbe("tron", probeTron),
    runProbe("xrpl", probeXrpl),
    runProbe("cardano", probeCardano)
  ]);

  const failed = results.filter((result) => result.status === "fail");
  const ok = results.filter((result) => result.status === "ok");
  const skipped = results.filter((result) => result.status === "skip");
  const requireConfigured = env("PAYMENT_LIVE_SMOKE_REQUIRE_CONFIGURED") === "1";

  console.log(failed.length ? "smoke:payments:live failed" : "smoke:payments:live passed");
  for (const result of results) {
    console.log(`  ${result.status.padEnd(4)} ${result.rail}: ${result.message}`);
  }

  if (requireConfigured && ok.length === 0) {
    console.error("smoke:payments:live requires at least one configured live rail.");
    process.exitCode = 1;
    return;
  }

  if (failed.length) {
    console.error(`smoke:payments:live failures: ${failed.map((result) => result.rail).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`  summary: ${ok.length} ok, ${skipped.length} skipped`);
}

void main().catch((error) => {
  console.error("smoke:payments:live failed");
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
