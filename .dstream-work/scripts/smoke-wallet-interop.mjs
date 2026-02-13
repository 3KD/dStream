#!/usr/bin/env node
import crypto from "node:crypto";

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:5656").replace(/\/$/, "");
const DAEMON_RPC = (process.env.MONEROD_RPC || "http://127.0.0.1:28081").replace(/\/$/, "");
const SENDER_RPC = (process.env.SENDER_RPC || "http://127.0.0.1:28084").replace(/\/$/, "");
const SENDER_WALLET = (process.env.SENDER_WALLET || "sender_wallet").trim();
const WALLET_PASS = process.env.WALLET_PASS || "";
const STREAM_PUBKEY = (process.env.STREAM_PUBKEY || crypto.randomBytes(32).toString("hex")).trim().toLowerCase();
const STREAM_ID = (process.env.STREAM_ID || `wallet-interop-${Date.now()}`).trim();
const TIMEOUT_SECS = Number(process.env.TIMEOUT_SECS || 240);
const POLL_MS = Number(process.env.POLL_MS || 2000);
const REQUIRE_CONFIRMED = process.env.REQUIRE_CONFIRMED !== "0";
const AUTO_INJECT = process.env.AUTO_INJECT === "1";
const REAL_WALLET_TIMEOUT_SECS = Number(process.env.REAL_WALLET_TIMEOUT_SECS || 120);
const INJECT_AMOUNT_ATOMIC = (process.env.INJECT_AMOUNT_ATOMIC || "150000000000").trim();
const INJECT_CONFIRMATIONS = Number(process.env.INJECT_CONFIRMATIONS || (REQUIRE_CONFIRMED ? 10 : 0));
const EXPECT_MIN_ATOMIC = (process.env.EXPECT_MIN_ATOMIC || "").trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isHex64(value) {
  return /^[a-f0-9]{64}$/i.test((value || "").trim());
}

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json, url };
}

async function rpc(origin, method, params = {}) {
  const res = await fetch(`${origin}/json_rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "0", method, params })
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
  while (Date.now() - started < REAL_WALLET_TIMEOUT_SECS * 1000) {
    try {
      await rpc(origin, "get_version");
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`${label} not reachable within ${REAL_WALLET_TIMEOUT_SECS}s (${origin})`);
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

const realWalletInjector = {
  initialized: false,
  senderAddress: null
};

function shouldFallbackToRealWallet(injectRes) {
  if (!injectRes || injectRes.ok) return false;
  const text = String(injectRes.text || "").toLowerCase();
  return (
    injectRes.status === 404 ||
    injectRes.status === 501 ||
    injectRes.status === 502 ||
    text.includes("method not found") ||
    text.includes("inject unavailable") ||
    text.includes("xmr inject error")
  );
}

async function ensureRealWalletInjector() {
  if (realWalletInjector.initialized && realWalletInjector.senderAddress) {
    return realWalletInjector.senderAddress;
  }

  await waitForRpc(DAEMON_RPC, "monerod rpc");
  await waitForRpc(SENDER_RPC, "sender wallet-rpc");
  await ensureWallet(SENDER_RPC, SENDER_WALLET);

  const senderAddressRes = await rpc(SENDER_RPC, "get_address", { account_index: 0 });
  const senderAddress = String(senderAddressRes?.address || "").trim();
  assert(senderAddress.length > 0, "real wallet injector: sender address missing");

  await rpc(DAEMON_RPC, "generateblocks", {
    amount_of_blocks: 120,
    wallet_address: senderAddress
  });
  await rpc(SENDER_RPC, "refresh", {});

  realWalletInjector.initialized = true;
  realWalletInjector.senderAddress = senderAddress;
  return senderAddress;
}

async function injectViaRealWallet(address) {
  const senderAddress = await ensureRealWalletInjector();
  const transfer = await rpc(SENDER_RPC, "transfer", {
    account_index: 0,
    destinations: [{ amount: INJECT_AMOUNT_ATOMIC, address }],
    get_tx_key: true
  });
  const txid = String(transfer?.tx_hash || "").trim();
  assert(txid, "real wallet injector: transfer tx hash missing");

  await rpc(DAEMON_RPC, "generateblocks", {
    amount_of_blocks: Math.max(2, INJECT_CONFIRMATIONS + 1),
    wallet_address: senderAddress
  });
  await rpc(SENDER_RPC, "refresh", {});

  return txid;
}

function parseAtomic(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

async function main() {
  assert(isHex64(STREAM_PUBKEY), "STREAM_PUBKEY must be 64-hex");
  assert(STREAM_ID.length > 0, "STREAM_ID must be non-empty");
  assert(Number.isFinite(TIMEOUT_SECS) && TIMEOUT_SECS > 0, "TIMEOUT_SECS must be > 0");
  assert(Number.isFinite(POLL_MS) && POLL_MS > 0, "POLL_MS must be > 0");
  assert(Number.isFinite(REAL_WALLET_TIMEOUT_SECS) && REAL_WALLET_TIMEOUT_SECS > 0, "REAL_WALLET_TIMEOUT_SECS must be > 0");
  assert(/^\d+$/.test(INJECT_AMOUNT_ATOMIC), "INJECT_AMOUNT_ATOMIC must be digits");
  assert(Number.isFinite(INJECT_CONFIRMATIONS) && INJECT_CONFIRMATIONS >= 0, "INJECT_CONFIRMATIONS must be >= 0");

  const expectedMinAtomic = EXPECT_MIN_ATOMIC ? parseAtomic(EXPECT_MIN_ATOMIC) : null;
  if (EXPECT_MIN_ATOMIC && expectedMinAtomic === null) {
    throw new Error("EXPECT_MIN_ATOMIC must be a digits-only atomic string");
  }

  console.log("dStream wallet interoperability smoke");
  console.log(`  base: ${BASE_URL}`);
  console.log(`  stream scope: ${STREAM_PUBKEY}/${STREAM_ID}`);
  console.log(`  require confirmed: ${REQUIRE_CONFIRMED ? "yes" : "no"}`);
  console.log(`  timeout: ${TIMEOUT_SECS}s`);
  if (AUTO_INJECT) {
    console.log("  auto-inject: dev route first, real-wallet fallback enabled");
  }

  const health = await request("/api/xmr/health", { cache: "no-store" });
  assert(health.ok, `xmr health failed (${health.status}): ${health.text}`);
  console.log(`wallet rpc: ok (version=${health.json?.version ?? "unknown"})`);

  const sessionRes = await request("/api/xmr/tip/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID })
  });
  assert(sessionRes.ok, `tip session create failed (${sessionRes.status}): ${sessionRes.text}`);

  const session = typeof sessionRes.json?.session === "string" ? sessionRes.json.session : "";
  const address = typeof sessionRes.json?.address === "string" ? sessionRes.json.address : "";
  assert(session, "tip session token missing");
  assert(address, "tip session address missing");

  console.log(`tip session: ${session}`);
  console.log(`pay-to address: ${address}`);
  console.log(`wallet URI: monero:${address}`);

  if (AUTO_INJECT) {
    const inject = await request("/api/dev/xmr/inject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session,
        amountAtomic: INJECT_AMOUNT_ATOMIC,
        confirmations: INJECT_CONFIRMATIONS
      })
    });
    if (inject.ok) {
      console.log(`auto-inject: ok (${INJECT_AMOUNT_ATOMIC} atomic, confirmations=${INJECT_CONFIRMATIONS})`);
    } else if (shouldFallbackToRealWallet(inject)) {
      const txid = await injectViaRealWallet(address);
      console.log(
        `auto-inject: fallback via sender wallet (txid=${txid}, amount=${INJECT_AMOUNT_ATOMIC}, confirmations>=${INJECT_CONFIRMATIONS})`
      );
    } else {
      assert(false, `AUTO_INJECT failed (${inject.status}): ${inject.text}`);
    }
  } else {
    console.log("manual step: send a tip to the address above from the wallet under test.");
    console.log("             then keep this process running until it detects the transfer.");
  }

  const started = nowMs();
  let lastStatus = null;

  while (nowMs() - started < TIMEOUT_SECS * 1000) {
    const status = await request(`/api/xmr/tip/session/${encodeURIComponent(session)}`, { cache: "no-store" });
    assert(status.ok, `tip status failed (${status.status}): ${status.text}`);
    const found = !!status.json?.found;
    const confirmed = status.json?.confirmed === true;
    const amountAtomic = typeof status.json?.amountAtomic === "string" ? status.json.amountAtomic : null;
    const txid = typeof status.json?.txid === "string" ? status.json.txid : null;

    lastStatus = { found, confirmed, amountAtomic, txid };
    if (!found) {
      process.stdout.write(".");
      await sleep(POLL_MS);
      continue;
    }

    if (expectedMinAtomic !== null && amountAtomic) {
      const observed = parseAtomic(amountAtomic);
      assert(observed !== null, "status returned invalid amountAtomic");
      assert(observed >= expectedMinAtomic, `observed amount ${amountAtomic} < EXPECT_MIN_ATOMIC ${expectedMinAtomic.toString()}`);
    }

    if (REQUIRE_CONFIRMED && !confirmed) {
      process.stdout.write("c");
      await sleep(POLL_MS);
      continue;
    }

    console.log("");
    console.log(`detected tip: amountAtomic=${amountAtomic ?? "unknown"} confirmed=${confirmed ? "yes" : "no"} txid=${txid ?? "n/a"}`);
    console.log("PASS");
    return;
  }

  throw new Error(
    `timeout waiting for transfer (${TIMEOUT_SECS}s). Last status: ${JSON.stringify(lastStatus ?? { found: false })}`
  );
}

main().catch((err) => {
  console.error("");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
