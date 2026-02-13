#!/usr/bin/env node
import crypto from "node:crypto";

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:5656").replace(/\/$/, "");
const DAEMON_RPC = (process.env.MONEROD_RPC || "http://127.0.0.1:28081").replace(/\/$/, "");
const SENDER_RPC = (process.env.SENDER_RPC || "http://127.0.0.1:28084").replace(/\/$/, "");
const RECEIVER_RPC = (process.env.RECEIVER_RPC || "http://127.0.0.1:28083").replace(/\/$/, "");
const SENDER_WALLET = (process.env.SENDER_WALLET || "sender_wallet").trim();
const RECEIVER_WALLET = (process.env.RECEIVER_WALLET || "receiver_wallet").trim();
const WALLET_PASS = process.env.WALLET_PASS || "";
const STREAM_PUBKEY = (process.env.STREAM_PUBKEY || crypto.randomBytes(32).toString("hex")).trim().toLowerCase();
const STREAM_ID = (process.env.STREAM_ID || `wallet-real-${Date.now()}`).trim();
const TIP_AMOUNT_ATOMIC = (process.env.TIP_AMOUNT_ATOMIC || "120000000000").trim();
const REQUIRED_CONFIRMATIONS = Number(process.env.REQUIRED_CONFIRMATIONS || 10);
const TIMEOUT_SECS = Number(process.env.TIMEOUT_SECS || 120);
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 15000);
const RPC_RETRY_MAX = Math.max(1, Number(process.env.RPC_RETRY_MAX || 4));
const RPC_RETRY_DELAY_MS = Number(process.env.RPC_RETRY_DELAY_MS || 750);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpc(origin, method, params = {}, opts = {}) {
  const timeoutMs = Number.isFinite(opts?.timeoutMs) && opts.timeoutMs > 0 ? Number(opts.timeoutMs) : RPC_TIMEOUT_MS;
  let lastErr = null;
  for (let attempt = 1; attempt <= RPC_RETRY_MAX; attempt += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${origin}/json_rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "0", method, params }),
          signal: ctrl.signal
        });
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`invalid JSON-RPC response (${origin}, ${method}): ${text.slice(0, 200)}`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} (${origin}, ${method})`);
        if (data?.error) throw new Error(`rpc ${method} failed (${origin}): ${data.error.message ?? data.error.code ?? "unknown"}`);
        return data?.result ?? {};
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      const retryable = err?.name === "AbortError" || err?.message?.includes("fetch failed");
      if (!retryable || attempt >= RPC_RETRY_MAX) break;
      await sleep(RPC_RETRY_DELAY_MS);
    }
  }
  const reason = lastErr?.message ? String(lastErr.message) : String(lastErr ?? "unknown");
  throw new Error(`rpc ${method} failed (${origin}): ${reason}`);
}

async function http(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json };
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

async function waitForRpc(origin, label) {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_SECS * 1000) {
    try {
      await rpc(origin, "get_version", {}, { timeoutMs: Math.max(5000, RPC_TIMEOUT_MS) });
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`${label} not reachable within ${TIMEOUT_SECS}s (${origin})`);
}

async function ensureWallet(origin, filename) {
  try {
    await rpc(origin, "open_wallet", { filename, password: WALLET_PASS });
    return;
  } catch (err) {
    if (walletAlreadyOpenError(err)) return;
    if (!walletMissingError(err)) throw err;
  }

  try {
    await rpc(origin, "create_wallet", { filename, password: WALLET_PASS, language: "English" });
  } catch (err) {
    if (!walletExistsError(err)) throw err;
  }
  await rpc(origin, "open_wallet", { filename, password: WALLET_PASS });
}

async function main() {
  assert(/^[a-f0-9]{64}$/i.test(STREAM_PUBKEY), "STREAM_PUBKEY must be 64-hex");
  assert(STREAM_ID, "STREAM_ID must be non-empty");
  assert(/^\d+$/.test(TIP_AMOUNT_ATOMIC), "TIP_AMOUNT_ATOMIC must be digits");
  assert(Number.isFinite(REQUIRED_CONFIRMATIONS) && REQUIRED_CONFIRMATIONS >= 0, "REQUIRED_CONFIRMATIONS must be >= 0");

  console.log("dStream real-wallet smoke");
  console.log(`  base: ${BASE_URL}`);
  console.log(`  daemon: ${DAEMON_RPC}`);
  console.log(`  sender rpc: ${SENDER_RPC}`);
  console.log(`  receiver rpc: ${RECEIVER_RPC}`);
  console.log(`  stream scope: ${STREAM_PUBKEY}/${STREAM_ID}`);

  await waitForRpc(DAEMON_RPC, "monerod rpc");
  await waitForRpc(SENDER_RPC, "sender wallet-rpc");
  await waitForRpc(RECEIVER_RPC, "receiver wallet-rpc");

  await ensureWallet(SENDER_RPC, SENDER_WALLET);
  await ensureWallet(RECEIVER_RPC, RECEIVER_WALLET);

  const senderAddressRes = await rpc(SENDER_RPC, "get_address", { account_index: 0 });
  const senderAddress = String(senderAddressRes?.address || "").trim();
  assert(senderAddress.length > 0, "sender address missing");

  await rpc(
    DAEMON_RPC,
    "generateblocks",
    {
      amount_of_blocks: 120,
      wallet_address: senderAddress
    },
    { timeoutMs: 120000 }
  );
  await rpc(SENDER_RPC, "refresh", {});

  const health = await http("/api/xmr/health", { cache: "no-store" });
  assert(health.ok, `xmr health failed (${health.status}): ${health.text}`);

  const sessionRes = await http("/api/xmr/tip/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID })
  });
  assert(sessionRes.ok, `tip session create failed (${sessionRes.status}): ${sessionRes.text}`);
  const session = String(sessionRes.json?.session || "").trim();
  const address = String(sessionRes.json?.address || "").trim();
  assert(session, "tip session token missing");
  assert(address, "tip address missing");

  const transfer = await rpc(SENDER_RPC, "transfer", {
    account_index: 0,
    destinations: [{ amount: TIP_AMOUNT_ATOMIC, address }],
    get_tx_key: true
  });
  const txid = String(transfer?.tx_hash || "").trim();
  assert(txid, "transfer tx hash missing");
  console.log(`  transfer txid: ${txid}`);

  await rpc(
    DAEMON_RPC,
    "generateblocks",
    {
      amount_of_blocks: Math.max(2, REQUIRED_CONFIRMATIONS + 1),
      wallet_address: senderAddress
    },
    { timeoutMs: 120000 }
  );
  await rpc(RECEIVER_RPC, "refresh", {});

  const started = Date.now();
  while (Date.now() - started < TIMEOUT_SECS * 1000) {
    try {
      await rpc(RECEIVER_RPC, "refresh", {});
    } catch {
      // Best effort; status endpoint can still observe already-indexed transfers.
    }
    const status = await http(`/api/xmr/tip/session/${encodeURIComponent(session)}`, { cache: "no-store" });
    assert(status.ok, `tip status failed (${status.status}): ${status.text}`);
    if (status.json?.found && status.json?.confirmed === true && Number(status.json?.confirmations ?? 0) >= REQUIRED_CONFIRMATIONS) {
      console.log(
        `PASS (amountAtomic=${status.json?.amountAtomic ?? "unknown"} confirmations=${status.json?.confirmations ?? 0} txid=${status.json?.txid ?? txid})`
      );
      return;
    }
    await sleep(1000);
  }

  throw new Error(`timeout waiting for confirmed transfer (${TIMEOUT_SECS}s)`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
