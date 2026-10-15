import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { after, afterEach, test } from "node:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { NextRequest } from "next/server";
import { MoneroWalletRpcClient } from "./walletRpc";
import { makeStakeLabel } from "./stakeSession";
import { claimWalletSettlement, completeWalletSettlement } from "./settlement";
import { POST as slash } from "../../../app/api/xmr/stake/slash/route";
import { GET as capabilities } from "../../../app/api/xmr/capabilities/route";
import { validateNip98Auth } from "../../../app/api/xmr/escrow/_lib";

const dir = mkdtempSync(join(tmpdir(), "dstream-wallet-security-"));
const proto = MoneroWalletRpcClient.prototype as unknown as { call: (method: string, params?: any) => Promise<any> };
const original = proto.call;
const oldNodeEnv = process.env.NODE_ENV;
process.env.DSTREAM_XMR_WALLET_RPC_ORIGIN = "http://audit.invalid";
afterEach(() => {
  proto.call = original;
  if (oldNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", oldNodeEnv);
});
after(() => { rmSync(dir, { recursive: true, force: true }); });

function request(secret: Uint8Array, body: Record<string, unknown>) {
  const url = "https://node.example/api/xmr/stake/slash";
  const encoded = JSON.stringify(body);
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000),
    tags: [["u", url], ["method", "POST"], ["payload", createHash("sha256").update(encoded).digest("hex")]], content: "" }, secret);
  return new NextRequest(url, { method: "POST", headers: {
    authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`,
    "content-type": "application/json"
  }, body: encoded });
}

test("slash denies a valid identity targeting another stream's wallet subaddress before spending", async () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const calls: string[] = [];
  proto.call = async (method) => {
    calls.push(method);
    if (method === "get_address") return { address: "node-wallet", addresses: [{ address: "victim-stake",
      address_index: 17, label: makeStakeLabel({ streamPubkey: "a".repeat(64), streamId: "victim", viewerPubkey: pubkey, nonce: "nonce" }) }] };
    throw new Error("Unexpected wallet call");
  };
  const response = await slash(request(secret, { streamPubkey: pubkey, streamId: "attacker", addressIndex: 17, destinationAddress: "attacker-wallet" }));
  assert.equal(response.status, 403);
  assert.deepEqual(calls, ["get_address"]);
});

test("slash permits an owned mature stake once and blocks replay across durable settlement reads", async () => {
  process.env.DSTREAM_XMR_SETTLEMENT_STORE_PATH = join(dir, "slash.json");
  const secret = generateSecretKey(), pubkey = getPublicKey(secret);
  let sweeps = 0;
  proto.call = async (method) => {
    if (method === "get_address") return { address: "node-wallet", addresses: [{ address: "owned-stake",
      address_index: 17, label: makeStakeLabel({ streamPubkey: pubkey, streamId: "owned", viewerPubkey: pubkey, nonce: "nonce" }) }] };
    if (method === "get_transfers") return { in: [{ amount: "1", confirmations: 10, timestamp: Math.floor(Date.now() / 1000) - 86400,
      subaddr_index: { major: 0, minor: 17 } }] };
    if (method === "get_balance") return { balance: "1", unlocked_balance: "1", per_subaddress: [{ address_index: 17, balance: "1", unlocked_balance: "1" }] };
    if (method === "sweep_all") { sweeps += 1; return { tx_hash_list: ["fixture-tx"], amount_list: ["1"] }; }
    throw new Error("Unexpected wallet call");
  };
  const body = { streamPubkey: pubkey, streamId: "owned", addressIndex: 17 };
  assert.equal((await slash(request(secret, body))).status, 200);
  assert.equal((await slash(request(secret, body))).status, 409);
  assert.equal(sweeps, 1);
});

test("pending settlement blocks concurrent or ambiguous retries and claim mismatch", () => {
  process.env.DSTREAM_XMR_SETTLEMENT_STORE_PATH = join(dir, "pending.json");
  const id = claimWalletSettlement("stake", "recipient");
  assert.throws(() => claimWalletSettlement("stake", "other"), /reconciliation/);
  assert.throws(() => completeWalletSettlement("stake", "wrong", []), /mismatch/);
  completeWalletSettlement("stake", id, ["tx"]);
  assert.throws(() => claimWalletSettlement("stake", "recipient"), /already settled/);
});

test("withdrawal proof rejects a changed destination before any wallet RPC", async () => {
  const secret = generateSecretKey(), pubkey = getPublicKey(secret);
  const signed = request(secret, { streamPubkey: pubkey, streamId: "owned", addressIndex: 17 });
  const changed = new NextRequest(signed.url, { method: "POST", headers: signed.headers,
    body: JSON.stringify({ streamPubkey: pubkey, streamId: "owned", addressIndex: 17, destinationAddress: "changed" }) });
  proto.call = async () => { throw new Error("Wallet RPC must not be reached"); };
  assert.equal((await slash(changed)).status, 401);
});

test("public capability checks reject active mode and never dispatch wallet mutations", async () => {
  const calls: string[] = [];
  proto.call = async (method) => { calls.push(method); return { version: 1 }; };
  assert.equal((await capabilities(new Request("https://node.example/api/xmr/capabilities?mode=active"))).status, 403);
  assert.deepEqual(calls, []);
  assert.equal((await capabilities(new Request("https://node.example/api/xmr/capabilities"))).status, 200);
  assert(calls.every((method) => ["get_version", "get_transfers", "get_balance"].includes(method)));
});

test("production escrow cannot reach the donation wallet", () => {
  Reflect.set(process.env, "NODE_ENV", "production");
  const result = validateNip98Auth(new NextRequest("https://node.example/api/xmr/escrow/session"), "POST");
  assert(result instanceof Response);
  assert.equal(result.status, 503);
});
