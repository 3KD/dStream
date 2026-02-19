#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";

const RECEIVER_RPC = (process.env.XMR_INIT_RECEIVER_RPC || "http://127.0.0.1:28083").replace(/\/$/, "");
const SENDER_RPC = (process.env.XMR_INIT_SENDER_RPC || "http://127.0.0.1:28084").replace(/\/$/, "");
const RECEIVER_WALLET = (process.env.XMR_INIT_RECEIVER_WALLET || "receiver_wallet").trim();
const SENDER_WALLET = (process.env.XMR_INIT_SENDER_WALLET || "sender_wallet").trim();
const WALLET_PASS = process.env.XMR_INIT_WALLET_PASS || "";
const RPC_USER = (process.env.XMR_INIT_RPC_USER || "").trim();
const RPC_PASS = process.env.XMR_INIT_RPC_PASS || "";
const TIMEOUT_SECS = Number(process.env.XMR_INIT_TIMEOUT_SECS || 90);
const WALLET_RETRY_SECS = Number(process.env.XMR_INIT_WALLET_RETRY_SECS || 120);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function md5Hex(input) {
  return createHash("md5").update(input, "utf8").digest("hex");
}

function parseDigestChallenge(headerValue) {
  const raw = String(headerValue || "").trim();
  const lower = raw.toLowerCase();
  const digestPos = lower.indexOf("digest ");
  if (digestPos < 0) return null;
  const attrs = {};
  const body = raw.slice(digestPos + 7);
  const re = /([a-zA-Z0-9_-]+)=("([^"]*)"|([^,]+))/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const key = String(match[1] || "").toLowerCase();
    const value = (match[3] ?? match[4] ?? "").trim();
    if (key) attrs[key] = value;
  }
  const realm = String(attrs.realm || "").trim();
  const nonce = String(attrs.nonce || "").trim();
  if (!realm || !nonce) return null;
  const algorithm = String(attrs.algorithm || "MD5").trim();
  let qop = String(attrs.qop || "").trim();
  if (qop.includes(",")) {
    const options = qop
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    qop = options.includes("auth") ? "auth" : options[0] || "";
  }
  return { realm, nonce, opaque: String(attrs.opaque || "").trim(), algorithm, qop };
}

function buildDigestAuthorization({ username, password, method, uri, challenge }) {
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");
  const algo = String(challenge.algorithm || "MD5");
  let ha1 = md5Hex(`${username}:${challenge.realm}:${password}`);
  if (algo.toLowerCase() === "md5-sess") {
    ha1 = md5Hex(`${ha1}:${challenge.nonce}:${cnonce}`);
  }
  const ha2 = md5Hex(`${method}:${uri}`);
  const response = challenge.qop
    ? md5Hex(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`)
    : md5Hex(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${algo}`
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (challenge.qop) {
    parts.push(`qop=${challenge.qop}`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${cnonce}"`);
  }
  return `Digest ${parts.join(", ")}`;
}

async function rpc(origin, method, params = {}) {
  const url = `${origin}/json_rpc`;
  const uri = new URL(url).pathname || "/json_rpc";
  const payload = JSON.stringify({ jsonrpc: "2.0", id: "0", method, params });
  const baseHeaders = { "content-type": "application/json" };

  async function doRequest(authHeader) {
    const headers = { ...baseHeaders };
    if (authHeader) headers.authorization = authHeader;
    return fetch(url, {
      method: "POST",
      headers,
      body: payload
    });
  }

  const basicAuth = RPC_USER
    ? `Basic ${Buffer.from(`${RPC_USER}:${RPC_PASS}`, "utf8").toString("base64")}`
    : "";

  let res = await doRequest(basicAuth || "");
  if (res.status === 401 && RPC_USER) {
    const challenge = parseDigestChallenge(res.headers.get("www-authenticate"));
    if (challenge) {
      const digestAuth = buildDigestAuthorization({
        username: RPC_USER,
        password: RPC_PASS,
        method: "POST",
        uri,
        challenge
      });
      res = await doRequest(digestAuth);
    }
    if (res.status === 401) {
      res = await doRequest("");
    }
  }

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
  let lastError = "";
  while (Date.now() - start < TIMEOUT_SECS * 1000) {
    try {
      await rpc(origin, "get_version");
      return;
    } catch (err) {
      lastError = String(err?.message ?? err ?? "");
      await sleep(1000);
    }
  }
  const suffix = lastError ? `; last error: ${lastError}` : "";
  throw new Error(`wallet-rpc did not become ready in ${TIMEOUT_SECS}s (${origin})${suffix}`);
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

function walletWrongPasswordError(err) {
  const msg = String(err?.message ?? "");
  return /wrong password|invalid password|keys file failed verification|failed to decrypt|decrypt.*failed/i.test(msg);
}

async function withRetry(label, fn, timeoutSecs = WALLET_RETRY_SECS) {
  const start = Date.now();
  let lastError = "";
  while (Date.now() - start < timeoutSecs * 1000) {
    try {
      return await fn();
    } catch (err) {
      if (walletWrongPasswordError(err)) {
        throw new Error(
          `${label} failed due to wallet password mismatch. ` +
          "Set DSTREAM_XMR_WALLET_FILE_PASS to the existing wallet password, " +
          "or purge the regtest wallet volume before redeploy."
        );
      }
      lastError = String(err?.message ?? err ?? "");
      await sleep(2000);
    }
  }
  throw new Error(`${label} failed after ${timeoutSecs}s; last error: ${lastError || "unknown"}`);
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

  await withRetry(`ensure receiver wallet (${RECEIVER_WALLET})`, () => ensureWallet(RECEIVER_RPC, RECEIVER_WALLET));
  await withRetry(`ensure sender wallet (${SENDER_WALLET})`, () => ensureWallet(SENDER_RPC, SENDER_WALLET));

  console.log("PASS");
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
