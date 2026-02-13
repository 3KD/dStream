#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:5656").replace(/\/$/, "");
const STREAM_ID = process.env.ESCROW_V3_STREAM_ID || `escrow-v3-smoke-${Date.now()}`;
const PARTICIPANT_RPC = (process.env.ESCROW_PARTICIPANT_RPC || "http://127.0.0.1:28084").replace(/\/$/, "");
const PARTICIPANT_WALLET = (process.env.ESCROW_PARTICIPANT_WALLET || `escrow_participant_${Date.now()}`).trim();
const PARTICIPANT_WALLET_PASS = process.env.ESCROW_PARTICIPANT_WALLET_PASS || process.env.WALLET_PASS || "";
const COORDINATOR_RPC = (process.env.ESCROW_COORDINATOR_RPC || "http://127.0.0.1:28083").replace(/\/$/, "");
const COORDINATOR_WALLET = (process.env.ESCROW_COORDINATOR_WALLET || `escrow_coordinator_${Date.now()}`).trim();
const COORDINATOR_WALLET_PASS = process.env.ESCROW_COORDINATOR_WALLET_PASS || process.env.WALLET_PASS || "";
const REQUIRE_PARTICIPANT_RPC = process.env.ESCROW_REQUIRE_PARTICIPANT_RPC === "1";
const RUN_SIGN_SUBMIT_IN_REAL_MODE = process.env.ESCROW_V3_RUN_SIGN_SUBMIT === "1";
const ENABLE_MULTISIG_CLI = process.env.ESCROW_ENABLE_MULTISIG_CLI !== "0";
const MONERO_CLI_CACHE_ROOT = (process.env.ESCROW_MONERO_CLI_CACHE_DIR || join(tmpdir(), "dstream-monero-cli")).trim();
const MONERO_CLI_FLAVOR_OVERRIDE = (process.env.ESCROW_MONERO_CLI_FLAVOR || "").trim().toLowerCase();
const MONERO_CLI_IMAGE = (process.env.ESCROW_MONERO_CLI_IMAGE || "dstream-work-web").trim();
const WALLET_VOLUME = (process.env.ESCROW_WALLET_VOLUME || "dstream-work_dstream_xmr_wallets").trim();

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
  const baseUrl = new URL(BASE_URL);
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCommand(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function detectCliFlavor() {
  if (MONERO_CLI_FLAVOR_OVERRIDE) return MONERO_CLI_FLAVOR_OVERRIDE;
  const { stdout } = await runCommand("docker", ["info", "--format", "{{.Architecture}}"], { capture: true });
  const arch = stdout.trim().toLowerCase();
  if (arch.includes("arm64") || arch.includes("aarch64")) return "linuxarm8";
  if (arch.includes("amd64") || arch.includes("x86_64")) return "linux64";
  return "linux64";
}

async function ensureMoneroCliDir() {
  const flavor = await detectCliFlavor();
  const flavorDir = join(MONERO_CLI_CACHE_ROOT, flavor);
  const binaryPath = join(flavorDir, "monero-wallet-cli");
  if (existsSync(binaryPath)) return flavorDir;

  mkdirSync(flavorDir, { recursive: true });
  const archivePath = join(flavorDir, `monero-cli-${flavor}.tar.bz2`);
  if (!existsSync(archivePath)) {
    await runCommand("curl", ["-fsSL", `https://downloads.getmonero.org/cli/${flavor}`, "-o", archivePath]);
  }
  await runCommand("tar", ["-xjf", archivePath, "--strip-components=1", "-C", flavorDir]);
  if (!existsSync(binaryPath)) throw new Error(`monero-wallet-cli missing after extract (${binaryPath})`);
  return flavorDir;
}

async function enableMultisigExperimental(wallets) {
  if (!ENABLE_MULTISIG_CLI) return;
  const cliDir = await ensureMoneroCliDir();
  for (const { filename, password } of wallets) {
    await runCommand("docker", [
      "run",
      "--rm",
      "--user",
      "1000:1000",
      "--entrypoint",
      "/opt/monero/monero-wallet-cli",
      "-v",
      `${cliDir}:/opt/monero:ro`,
      "-v",
      `${WALLET_VOLUME}:/wallets`,
      MONERO_CLI_IMAGE,
      "--wallet-file",
      `/wallets/${filename}`,
      "--password",
      password,
      "--offline",
      "set",
      "enable-multisig-experimental",
      "1"
    ], { capture: true });
  }
}

async function getApiWalletVersion() {
  try {
    const res = await fetch(`${BASE_URL}/api/xmr/health`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const v = Number(json?.version);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

async function rpc(origin, method, params = {}) {
  const res = await fetch(`${origin}/json_rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "0", method, params })
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`invalid JSON-RPC response (${origin}, ${method}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} (${origin}, ${method})`);
  if (json?.error) throw new Error(`rpc ${method} failed (${origin}): ${json.error.message ?? json.error.code ?? "unknown"}`);
  return json?.result ?? {};
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

async function ensureWallet(origin, filename, password) {
  try {
    await rpc(origin, "open_wallet", { filename, password });
    return;
  } catch (err) {
    if (walletAlreadyOpenError(err)) return;
    if (!walletMissingError(err)) throw err;
  }

  try {
    await rpc(origin, "create_wallet", { filename, password, language: "English" });
  } catch (err) {
    if (!walletExistsError(err)) throw err;
  }
  await rpc(origin, "open_wallet", { filename, password });
}

async function requestWithNip98(path, { method, secretKey, body }) {
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

async function main() {
  console.log("dStream escrow v3 smoke");
  console.log(`  base: ${BASE_URL}`);
  console.log(`  stream: ${STREAM_ID}`);
  const apiWalletVersion = await getApiWalletVersion();
  if (apiWalletVersion !== null) {
    console.log(`  api wallet version: ${apiWalletVersion}`);
  }

  const coordinatorSk = generateSecretKey();
  const participantSk = generateSecretKey();
  const coordinatorPubkey = getPublicKey(coordinatorSk);
  const participantPubkey = getPublicKey(participantSk);

  let coordinatorRpcReady = false;
  try {
    await rpc(COORDINATOR_RPC, "get_version");
    await ensureWallet(COORDINATOR_RPC, COORDINATOR_WALLET, COORDINATOR_WALLET_PASS);
    coordinatorRpcReady = true;
  } catch {
    coordinatorRpcReady = false;
  }

  let participantRpcReady = false;
  try {
    await rpc(PARTICIPANT_RPC, "get_version");
    await ensureWallet(PARTICIPANT_RPC, PARTICIPANT_WALLET, PARTICIPANT_WALLET_PASS);
    participantRpcReady = true;
  } catch (err) {
    if (REQUIRE_PARTICIPANT_RPC) {
      throw new Error(`participant rpc unavailable (${PARTICIPANT_RPC}): ${err?.message ?? String(err)}`);
    }
  }
  if (coordinatorRpcReady && participantRpcReady && ENABLE_MULTISIG_CLI) {
    await rpc(COORDINATOR_RPC, "close_wallet", {}).catch(() => {});
    await rpc(PARTICIPANT_RPC, "close_wallet", {}).catch(() => {});
    try {
      await enableMultisigExperimental([
        { filename: COORDINATOR_WALLET, password: COORDINATOR_WALLET_PASS },
        { filename: PARTICIPANT_WALLET, password: PARTICIPANT_WALLET_PASS }
      ]);
    } catch (err) {
      throw new Error(`failed to enable multisig experimental via monero-wallet-cli: ${err?.message ?? String(err)}`);
    }
    await ensureWallet(COORDINATOR_RPC, COORDINATOR_WALLET, COORDINATOR_WALLET_PASS);
    await ensureWallet(PARTICIPANT_RPC, PARTICIPANT_WALLET, PARTICIPANT_WALLET_PASS);
  }
  const apiWalletLikelyReal = apiWalletVersion !== null && apiWalletVersion >= 65560;
  const realParticipantMode = coordinatorRpcReady && participantRpcReady && apiWalletLikelyReal;
  console.log(`  participant mode: ${realParticipantMode ? "real-wallet-rpc" : "synthetic"}`);

  const created = await requestWithNip98("/api/xmr/escrow/session", {
    method: "POST",
    secretKey: coordinatorSk,
    body: {
      streamPubkey: coordinatorPubkey,
      streamId: STREAM_ID,
      participantPubkeys: [participantPubkey],
      threshold: 2
    }
  });
  assert(created.ok, `escrow session create failed (${created.status}): ${created.text}`);
  const sessionId = created.json?.sessionId;
  const coordinatorPrepareInfo = created.json?.prepare?.coordinatorMultisigInfo;
  assert(typeof sessionId === "string" && sessionId, "sessionId missing");
  assert(typeof coordinatorPrepareInfo === "string" && coordinatorPrepareInfo, "coordinator prepare info missing");

  let participantPrepareInfo = `peer_prepare:${coordinatorPrepareInfo}`;
  if (realParticipantMode) {
    const prepared = await rpc(PARTICIPANT_RPC, "prepare_multisig", {});
    participantPrepareInfo = typeof prepared?.multisig_info === "string" ? prepared.multisig_info.trim() : "";
    assert(participantPrepareInfo, "participant prepare_multisig returned empty multisig_info");
  }

  const joinPrepare = await requestWithNip98(`/api/xmr/escrow/session/${encodeURIComponent(sessionId)}/participant`, {
    method: "POST",
    secretKey: participantSk,
    body: { phase: "prepare", multisigInfo: participantPrepareInfo }
  });
  assert(joinPrepare.ok, `participant prepare failed (${joinPrepare.status}): ${joinPrepare.text}`);

  const made = await requestWithNip98(`/api/xmr/escrow/session/${encodeURIComponent(sessionId)}/make`, {
    method: "POST",
    secretKey: coordinatorSk
  });
  assert(made.ok, `make_multisig failed (${made.status}): ${made.text}`);

  let round = 0;
  let phase = String(made.json?.phase || "");
  let participantPendingExchangeInfo = "";
  if (realParticipantMode && (phase === "collecting_exchange" || phase === "exchange_ready")) {
    const participantMade = await rpc(PARTICIPANT_RPC, "make_multisig", {
      multisig_info: [coordinatorPrepareInfo],
      threshold: 2,
      password: PARTICIPANT_WALLET_PASS
    });
    participantPendingExchangeInfo = typeof participantMade?.multisig_info === "string" ? participantMade.multisig_info.trim() : "";
    assert(participantPendingExchangeInfo, "participant make_multisig returned no multisig_info for exchange");
  }

  while (phase === "collecting_exchange" || phase === "exchange_ready") {
    round += 1;
    let participantExchangeInfo = `peer_exchange_round_${round}`;
    if (realParticipantMode) {
      participantExchangeInfo = participantPendingExchangeInfo;
      assert(participantExchangeInfo, `participant exchange info missing for round ${round}`);
    }

    const joinExchange = await requestWithNip98(`/api/xmr/escrow/session/${encodeURIComponent(sessionId)}/participant`, {
      method: "POST",
      secretKey: participantSk,
      body: { phase: "exchange", multisigInfo: participantExchangeInfo }
    });
    assert(joinExchange.ok, `participant exchange failed (${joinExchange.status}): ${joinExchange.text}`);

    const exchanged = await requestWithNip98(`/api/xmr/escrow/session/${encodeURIComponent(sessionId)}/exchange`, {
      method: "POST",
      secretKey: coordinatorSk
    });
    assert(exchanged.ok, `exchange_multisig_keys failed (${exchanged.status}): ${exchanged.text}`);
    phase = String(exchanged.json?.phase || "");

    if (realParticipantMode && (phase === "collecting_exchange" || phase === "exchange_ready")) {
      const coordinatorExchangeInfo = typeof exchanged.json?.exchange?.coordinatorMultisigInfo === "string" ? exchanged.json.exchange.coordinatorMultisigInfo.trim() : "";
      assert(coordinatorExchangeInfo, "coordinator exchange multisig info missing");
      const participantExchanged = await rpc(PARTICIPANT_RPC, "exchange_multisig_keys", {
        multisig_info: [coordinatorExchangeInfo],
        password: PARTICIPANT_WALLET_PASS
      });
      participantPendingExchangeInfo = typeof participantExchanged?.multisig_info === "string" ? participantExchanged.multisig_info.trim() : "";
      assert(participantPendingExchangeInfo, `participant exchange_multisig_keys returned empty multisig_info at round ${round}`);
    }

    if (round > 8) throw new Error("exchange loop exceeded expected rounds");
  }

  assert(phase === "exchanged", `unexpected phase after exchange: ${phase}`);

  let importInfos = ["peer_export"];
  if (realParticipantMode) {
    const exported = await rpc(PARTICIPANT_RPC, "export_multisig_info", {});
    const info = typeof exported?.info === "string" ? exported.info.trim() : "";
    assert(info, "participant export_multisig_info returned empty info");
    importInfos = [info];
  }

  const imported = await requestWithNip98(`/api/xmr/escrow/session/${encodeURIComponent(sessionId)}/import`, {
    method: "POST",
    secretKey: coordinatorSk,
    body: { infos: importInfos }
  });
  assert(imported.ok, `import_multisig_info failed (${imported.status}): ${imported.text}`);
  const importedNow = Number(imported.json?.importedNow ?? 0);
  assert(Number.isFinite(importedNow), "imported outputs result missing");
  if (!realParticipantMode) {
    assert(importedNow > 0, "imported outputs missing");
  }

  const status = await requestWithNip98(`/api/xmr/escrow/session/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    secretKey: participantSk
  });
  assert(status.ok, `session status failed (${status.status}): ${status.text}`);

  if (realParticipantMode && !RUN_SIGN_SUBMIT_IN_REAL_MODE) {
    assert(status.json?.phase === "exchanged", "status phase mismatch (expected exchanged)");
    console.log("note: sign/submit skipped in real-wallet mode (requires externally generated multisig tx_data_hex)");
    console.log(`session: ${sessionId}`);
    console.log(`exchange rounds: ${round}`);
    console.log("PASS");
    return;
  }

  const signed = await requestWithNip98(`/api/xmr/escrow/session/${encodeURIComponent(sessionId)}/sign`, {
    method: "POST",
    secretKey: coordinatorSk,
    body: { txDataHex: "deadbeef" }
  });
  assert(signed.ok, `sign_multisig failed (${signed.status}): ${signed.text}`);
  const signedTxDataHex = signed.json?.signedTxDataHex;
  assert(typeof signedTxDataHex === "string" && signedTxDataHex, "signedTxDataHex missing");

  const submitted = await requestWithNip98(`/api/xmr/escrow/session/${encodeURIComponent(sessionId)}/submit`, {
    method: "POST",
    secretKey: coordinatorSk
  });
  assert(submitted.ok, `submit_multisig failed (${submitted.status}): ${submitted.text}`);
  assert(Array.isArray(submitted.json?.submittedTxids) && submitted.json.submittedTxids.length > 0, "submitted txids missing");
  assert(submitted.json?.phase === "submitted", "session not marked submitted");

  const submittedStatus = await requestWithNip98(`/api/xmr/escrow/session/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    secretKey: participantSk
  });
  assert(submittedStatus.ok, `session status after submit failed (${submittedStatus.status}): ${submittedStatus.text}`);
  assert(submittedStatus.json?.phase === "submitted", "status phase mismatch (expected submitted)");

  console.log(`session: ${sessionId}`);
  console.log(`exchange rounds: ${round}`);
  console.log("PASS");
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
