import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { buildAccessAdminProof, grantAccessEntitlementClient } from "./client";
import { authorizeAccessAdmin } from "../../../app/api/access/_lib";
import { requestAuthorizationUrl } from "../server/requestUrl";

const dir = mkdtempSync(join(tmpdir(), "dstream-request-proof-"));
process.env.DSTREAM_ACCESS_NONCE_STORE_PATH = join(dir, "nonces.json");
after(() => rmSync(dir, { recursive: true, force: true }));

test("request audience uses the preserved HTTP authority through a managed reverse proxy", () => {
  const request = new Request("http://0.0.0.0:5656/api/test?q=1", { headers: { host: "node.example", "x-forwarded-proto": "https", "x-forwarded-host": "attacker.example" } });
  assert.equal(requestAuthorizationUrl(request), "https://node.example/api/test?q=1");
  assert.equal(requestAuthorizationUrl(new Request("http://0.0.0.0:5656/api/test", { headers: { host: "127.0.0.1:6101" } })), "http://127.0.0.1:6101/api/test");
  assert.equal(requestAuthorizationUrl(new Request("http://0.0.0.0:5656/api/test", { headers: { host: "node.example:80", "x-forwarded-proto": "https" } })), "https://node.example:80/api/test");
  assert.throws(() => requestAuthorizationUrl(new Request("http://localhost/", { headers: { host: "node.example@attacker.example" } })), /Invalid request authority/);
});

test("admin transport binds each signed operation and rejects changed body, route and replay", async () => {
  const key = generateSecretKey(), pubkey = getPublicKey(key);
  const proof = await buildAccessAdminProof(async (event) => finalizeEvent(event as any, key), pubkey, pubkey);
  assert(proof);
  assert.equal(authorizeAccessAdmin(proof, pubkey).ok, false);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body));
    const req = new Request(new URL(String(url), "http://localhost"), { method: init?.method });
    const event = payload.operatorProofEvent;
    assert.equal(authorizeAccessAdmin(event, pubkey, { request: req, payload: { ...payload, actions: ["watch_video"] } }).ok, false);
    assert.equal(authorizeAccessAdmin(event, pubkey, { request: new Request("http://localhost/different", { method: "POST" }), payload }).ok, false);
    assert.equal(authorizeAccessAdmin(event, pubkey, { request: req, payload }).ok, true);
    assert.equal(authorizeAccessAdmin(event, pubkey, { request: req, payload }).ok, false);
    calls += 1;
    return Response.json({ ok: true, entitlement: { id: "fixture" }, actorPubkey: pubkey });
  };
  try {
    const input = { hostPubkey: pubkey, subjectPubkey: "a".repeat(64), resourceId: "fixture", actions: ["watch_live"] as const, operatorProofEvent: proof };
    await grantAccessEntitlementClient({ ...input, actions: [...input.actions] });
    await grantAccessEntitlementClient({ ...input, actions: [...input.actions] });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
