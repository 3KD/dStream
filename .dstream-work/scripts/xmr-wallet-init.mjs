#!/usr/bin/env node

const RECEIVER_RPC = (process.env.XMR_INIT_RECEIVER_RPC || "http://127.0.0.1:28083").replace(/\/$/, "");
const SENDER_RPC = (process.env.XMR_INIT_SENDER_RPC || "http://127.0.0.1:28084").replace(/\/$/, "");
const RECEIVER_WALLET = (process.env.XMR_INIT_RECEIVER_WALLET || "receiver_wallet").trim();
const SENDER_WALLET = (process.env.XMR_INIT_SENDER_WALLET || "sender_wallet").trim();
const WALLET_PASS = process.env.XMR_INIT_WALLET_PASS || "";
const RPC_USER = (process.env.XMR_INIT_RPC_USER || "").trim();
const RPC_PASS = process.env.XMR_INIT_RPC_PASS || "";
const TIMEOUT_SECS = Number(process.env.XMR_INIT_TIMEOUT_SECS || 90);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpc(origin, method, params = {}) {
  const headers = { "content-type": "application/json" };
  if (RPC_USER) {
    const token = Buffer.from(`${RPC_USER}:${RPC_PASS}`, "utf8").toString("base64");
    headers.authorization = `Basic ${token}`;
  }
  const res = await fetch(`${origin}/json_rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: "0", method, params })
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`invalid JSON-RPC response from ${origin} (${method}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${origin} (${method})`);
  if (data?.error) throw new Error(`rpc ${method} failed: ${data.error.message ?? data.error.code ?? "unknown"}`);
  return data?.result ?? {};
}

async function waitForRpc(origin) {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_SECS * 1000) {
    try {
      await rpc(origin, "get_version");
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`wallet-rpc did not become ready in ${TIMEOUT_SECS}s (${origin})`);
}

function walletMissingError(err) {
  const msg = String(err?.message ?? "");
  return /open wallet|file not found|No wallet|wallet.*not found|doesn't exist|failed to open/i.test(msg);
}

function walletAlreadyOpenError(err) {
  const msg = String(err?.message ?? "");
  return /opened by another wallet program|already opened/i.test(msg);
}

function walletExistsError(err) {
  const msg = String(err?.message ?? "");
  return /already exists|file exists|already opened|opened by another wallet program/i.test(msg);
}

async function ensureWallet(origin, filename) {
  try {
    await rpc(origin, "open_wallet", { filename, password: WALLET_PASS });
    return;
  } catch (err) {
    if (walletAlreadyOpenError(err)) return;
    if (!walletMissingError(err)) {
      throw new Error(`open_wallet failed (${origin}, ${filename}): ${String(err?.message ?? err)}`);
    }
  }

  try {
    await rpc(origin, "create_wallet", { filename, password: WALLET_PASS, language: "English" });
  } catch (err) {
    if (!walletExistsError(err)) {
      throw new Error(`create_wallet failed (${origin}, ${filename}): ${String(err?.message ?? err)}`);
    }
  }

  await rpc(origin, "open_wallet", { filename, password: WALLET_PASS });
}

async function main() {
  assert(RECEIVER_WALLET, "XMR_INIT_RECEIVER_WALLET must be set");
  assert(SENDER_WALLET, "XMR_INIT_SENDER_WALLET must be set");

  console.log("dStream xmr wallet init");
  console.log(`  receiver rpc: ${RECEIVER_RPC}`);
  console.log(`  sender rpc:   ${SENDER_RPC}`);
  console.log(`  receiver wallet: ${RECEIVER_WALLET}`);
  console.log(`  sender wallet:   ${SENDER_WALLET}`);
  if (RPC_USER) console.log("  rpc auth: basic");

  await waitForRpc(RECEIVER_RPC);
  await waitForRpc(SENDER_RPC);

  await ensureWallet(RECEIVER_RPC, RECEIVER_WALLET);
  await ensureWallet(SENDER_RPC, SENDER_WALLET);

  console.log("PASS");
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
