#!/usr/bin/env node
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5656";
const base = BASE_URL.replace(/\/$/, "");
const STREAM_ID = process.env.STAKE_STREAM_ID || `stake-smoke-${Date.now()}`;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function toB64(input) {
  return Buffer.from(input, "utf8").toString("base64");
}

function authHeader(secretKey, url, method) {
  const unsigned = {
    kind: 27235,
    created_at: nowSec(),
    tags: [
      ["u", url],
      ["method", method]
    ],
    content: ""
  };
  const signed = finalizeEvent(unsigned, secretKey);
  return `Nostr ${toB64(JSON.stringify(signed))}`;
}

function candidateUrls(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const raw = new Set();
  const baseUrl = new URL(base);
  const hosts = new Set([baseUrl.host]);
  if (baseUrl.hostname === "127.0.0.1") hosts.add(`localhost${baseUrl.port ? `:${baseUrl.port}` : ""}`);
  if (baseUrl.hostname === "localhost") hosts.add(`127.0.0.1${baseUrl.port ? `:${baseUrl.port}` : ""}`);

  for (const host of hosts) {
    const root = `${baseUrl.protocol}//${host}`;
    raw.add(`${root}${normalizedPath}`);
    if (normalizedPath.endsWith("/")) raw.add(`${root}${normalizedPath.slice(0, -1)}`);
    else raw.add(`${root}${normalizedPath}/`);
  }
  return Array.from(raw);
}

async function requestJson(path, options = {}) {
  const url = `${base}${path}`;
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

async function requestJsonWithNip98(path, { method, secretKey, body }) {
  const variants = candidateUrls(path);
  let last = null;
  for (const url of variants) {
    const auth = authHeader(secretKey, url, method);
    const res = await fetch(url, {
      method,
      headers: {
        authorization: auth,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const out = { ok: res.ok, status: res.status, text, json, url };
    if (res.ok) return out;
    last = out;
    if (!text.includes("NIP-98 url mismatch")) return out;
  }
  return last;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildP2PReceipt({ signerSk, streamPubkey, streamId, fromPubkey, servedBytes, sessionId }) {
  const unsigned = {
    kind: 30316,
    created_at: nowSec(),
    tags: [
      ["a", `30311:${streamPubkey}:${streamId}`],
      ["p", fromPubkey]
    ],
    content: JSON.stringify({
      v: 1,
      t: "p2p_bytes_receipt",
      streamPubkey,
      streamId,
      fromPubkey,
      servedBytes,
      observedAtMs: Date.now(),
      sessionId
    })
  };
  return finalizeEvent(unsigned, signerSk);
}

async function createStakeSession({ viewerSk, streamPubkey, streamId }) {
  const out = await requestJsonWithNip98("/api/xmr/stake/session", {
    method: "POST",
    secretKey: viewerSk,
    body: { streamPubkey, streamId }
  });
  assert(out.ok, `stake session create failed (${out.status}): ${out.text}`);
  const session = out.json?.session;
  const accountIndex = out.json?.accountIndex;
  const addressIndex = out.json?.addressIndex;
  assert(typeof session === "string" && session, "stake session token missing");
  assert(Number.isInteger(accountIndex), "stake accountIndex missing");
  assert(Number.isInteger(addressIndex), "stake addressIndex missing");
  return { session, accountIndex, addressIndex };
}

async function injectTransfer({ accountIndex, addressIndex, amountAtomic, confirmations, timestampSec }) {
  const out = await requestJson("/api/dev/xmr/inject", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountIndex,
      addressIndex,
      amountAtomic,
      confirmations,
      timestampSec
    })
  });
  assert(out.ok, `inject failed (${out.status}): ${out.text}`);
}

async function checkStake({ viewerSk, session }) {
  const out = await requestJsonWithNip98(`/api/xmr/stake/session/${encodeURIComponent(session)}`, {
    method: "GET",
    secretKey: viewerSk
  });
  assert(out.ok, `stake check failed (${out.status}): ${out.text}`);
  return out.json;
}

async function requestRefund({ viewerSk, session, refundAddress, receipts }) {
  const out = await requestJsonWithNip98(`/api/xmr/stake/session/${encodeURIComponent(session)}/refund`, {
    method: "POST",
    secretKey: viewerSk,
    body: { refundAddress, receipts }
  });
  assert(out.ok, `refund failed (${out.status}): ${out.text}`);
  return out.json;
}

async function slashStake({ broadcasterSk, streamPubkey, streamId, addressIndex }) {
  const out = await requestJsonWithNip98("/api/xmr/stake/slash", {
    method: "POST",
    secretKey: broadcasterSk,
    body: { streamPubkey, streamId, addressIndex }
  });
  assert(out.ok, `slash failed (${out.status}): ${out.text}`);
  return out.json;
}

async function main() {
  console.log("dStream escrow smoke");
  console.log(`  base: ${base}`);
  console.log(`  stream: ${STREAM_ID}`);

  const broadcasterSk = generateSecretKey();
  const viewerSk = generateSecretKey();
  const viewer2Sk = generateSecretKey();
  const broadcasterPubkey = getPublicKey(broadcasterSk);

  const reset = await requestJson("/api/dev/xmr/reset", { method: "POST" });
  if (!reset.ok) {
    const msg = String(reset.text || "");
    const mockUnavailable =
      reset.status === 404 ||
      msg.includes("Method not found") ||
      msg.includes("xmr reset error");
    if (mockUnavailable) {
      console.log("SKIP: smoke:escrow requires mock wallet-rpc dev routes (/api/dev/xmr/*).");
      console.log("      Real-wallet environments should use `npm run smoke:wallet:real`.");
      return;
    }
    assert(reset.ok, `xmr reset failed (${reset.status}): ${reset.text}`);
  }

  const refundSession = await createStakeSession({
    viewerSk,
    streamPubkey: broadcasterPubkey,
    streamId: STREAM_ID
  });

  const refundAmount = "1500000000000";
  await injectTransfer({
    accountIndex: refundSession.accountIndex,
    addressIndex: refundSession.addressIndex,
    amountAtomic: refundAmount,
    confirmations: 12,
    timestampSec: nowSec() - 20
  });

  const statusBeforeRefund = await checkStake({ viewerSk, session: refundSession.session });
  assert(statusBeforeRefund?.confirmedAtomic === refundAmount, "stake confirmedAtomic mismatch before refund");

  const receipt = buildP2PReceipt({
    signerSk: viewerSk,
    streamPubkey: broadcasterPubkey,
    streamId: STREAM_ID,
    fromPubkey: getPublicKey(viewerSk),
    servedBytes: 262144,
    sessionId: refundSession.session
  });
  const refund = await requestRefund({
    viewerSk,
    session: refundSession.session,
    refundAddress: "4".repeat(95),
    receipts: [receipt]
  });
  assert(refund?.settled === true, "refund did not settle");
  assert(refund?.amountAtomic === refundAmount, "refund amount mismatch");
  assert(Array.isArray(refund?.txids) && refund.txids.length > 0, "refund txid missing");

  const statusAfterRefund = await checkStake({ viewerSk, session: refundSession.session });
  assert(statusAfterRefund?.confirmedAtomic === "0", "stake still confirmed after refund");

  const slashSession = await createStakeSession({
    viewerSk: viewer2Sk,
    streamPubkey: broadcasterPubkey,
    streamId: STREAM_ID
  });
  const slashAmount = "2200000000000";
  await injectTransfer({
    accountIndex: slashSession.accountIndex,
    addressIndex: slashSession.addressIndex,
    amountAtomic: slashAmount,
    confirmations: 15,
    timestampSec: nowSec() - 7200
  });

  const slash = await slashStake({
    broadcasterSk,
    streamPubkey: broadcasterPubkey,
    streamId: STREAM_ID,
    addressIndex: slashSession.addressIndex
  });
  assert(slash?.settled === true, "slash did not settle");
  assert(slash?.amountAtomic === slashAmount, "slash amount mismatch");
  assert(Array.isArray(slash?.txids) && slash.txids.length > 0, "slash txid missing");

  console.log(`refund: ok (${refundAmount} atomic)`);
  console.log(`slash: ok (${slashAmount} atomic)`);
  console.log("PASS");
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
