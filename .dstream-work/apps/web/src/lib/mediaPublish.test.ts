import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { buildStreamAnnounceEvent } from "@dstream/protocol";
import { NextRequest } from "next/server";
import { issuePublishCredential, verifyPublishCredential } from "./mediaPublish";
import { registerPlaybackPolicyFromAnnounceEvent } from "./playback-access";
import { POST as issue } from "../../app/api/broadcast/publish-credential/route";
import { POST as mediaAuth } from "../../app/api/broadcast/media-auth/route";
import { POST as whip } from "../../app/api/whip/[...path]/route";
import { GET as ingestStatus } from "../../app/api/broadcast/ingest-status/[originStreamId]/route";
import { issueMediaServiceCredential } from "../../../../services/media-auth.mjs";

const dir = mkdtempSync(join(tmpdir(), "dstream-media-auth-"));
process.env.DSTREAM_MEDIA_AUTH_SECRET = "fixture-media-secret-0123456789abcdef";
process.env.DSTREAM_PLAYBACK_POLICY_STORE_PATH = join(dir, "policies.json");
after(() => rmSync(dir, { recursive: true, force: true }));

test("publish credentials bind identity, reject spoofed owners and reject tampering", async () => {
  const key = generateSecretKey(), pubkey = getPublicKey(key), origin = `${pubkey}--fixture`;
  const token = issuePublishCredential(origin).token;
  assert(verifyPublishCredential(token, origin));
  assert(!verifyPublishCredential(token + "x", origin));
  assert(!verifyPublishCredential(token, `${"a".repeat(64)}--fixture`));
  const url = "https://node.example/api/broadcast/publish-credential";
  const body = JSON.stringify({ originStreamId: `${"a".repeat(64)}--fixture`, streamId: "fixture" });
  const proof = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: "",
    tags: [["u", url], ["method", "POST"], ["payload", createHash("sha256").update(body).digest("hex")]] }, key);
  const response = await issue(new Request(url, { method: "POST", headers: { authorization: `Nostr ${Buffer.from(JSON.stringify(proof)).toString("base64")}` }, body }));
  assert.equal(response.status, 403);
  assert.equal((await whip(new NextRequest(`https://node.example/api/whip/${origin}/whip`, { method: "POST" }),
    { params: Promise.resolve({ path: [origin, "whip"] }) })).status, 403);
});

test("media origin callback requires its server secret and enforces public/private reads and publisher scope", async () => {
  const key = generateSecretKey(), pubkey = getPublicKey(key);
  for (const visibility of ["public", "private"] as const) {
    const event = finalizeEvent(buildStreamAnnounceEvent({ pubkey, streamId: visibility, title: visibility,
      createdAt: Math.floor(Date.now() / 1000), status: "live", streamVisibility: visibility }) as any, key);
    assert(registerPlaybackPolicyFromAnnounceEvent(event).ok);
  }
  const invoke = async (body: object, credential = true) => mediaAuth(new Request("http://web:5656/api/broadcast/media-auth", {
    method: "POST", headers: credential ? { authorization: `Basic ${Buffer.from(`media:${process.env.DSTREAM_MEDIA_AUTH_SECRET}`).toString("base64")}` } : {},
    body: JSON.stringify(body)
  }));
  assert.equal((await invoke({ action: "read", path: `${pubkey}--public`, query: "" }, false)).status, 401);
  assert.equal((await invoke({ action: "read", path: `${pubkey}--public`, query: "" })).status, 204);
  assert.equal((await invoke({ action: "read", path: `${pubkey}--private`, query: "" })).status, 403);
  assert.equal((await invoke({ action: "read", path: `${pubkey}--unknown`, query: "" })).status, 403);
  assert.equal((await invoke({ action: "publish", path: `${pubkey}--public`, query: "" })).status, 403);
  const token = issuePublishCredential(`${pubkey}--public`).token;
  assert.equal((await invoke({ action: "api", ip: "127.0.0.1" })).status, 204);
  assert.equal((await invoke({ action: "api", ip: "172.20.0.2" })).status, 403);
  assert.equal((await invoke({ action: "api", ip: "127.0.0.1" }, false)).status, 401);
  assert.equal((await invoke({ action: "publish", path: `${pubkey}--public`, query: `publish=${token}` })).status, 204);
  assert.equal((await invoke({ action: "publish", path: `${pubkey}--private`, query: `publish=${token}` })).status, 403);
  assert.equal((await invoke({ action: "read", path: `${pubkey}--unknown`, query: `publish=${token}` })).status, 403);
  process.env.DSTREAM_MEDIA_MANIFEST_SECRET = "manifest-fixture-0123456789abcdef012345";
  process.env.DSTREAM_MEDIA_TRANSCODER_SECRET = "transcode-fixture-0123456789abcdef012345";
  const privatePath = `${pubkey}--private`;
  const manifestRead = issueMediaServiceCredential(process.env.DSTREAM_MEDIA_MANIFEST_SECRET, "manifest", privatePath, "read");
  assert.equal((await invoke({ action: "read", path: privatePath, query: "", token: manifestRead })).status, 204);
  assert.equal((await invoke({ action: "publish", path: privatePath, query: "", token: manifestRead })).status, 403);
  const rendition = `${privatePath}__r360p`;
  const pipelinePublish = issueMediaServiceCredential(process.env.DSTREAM_MEDIA_TRANSCODER_SECRET, "transcoder", rendition, "publish");
  assert.equal((await invoke({ action: "publish", path: rendition, query: `pipeline=${pipelinePublish}` })).status, 204);
  assert.equal((await invoke({ action: "publish", path: privatePath, query: `pipeline=${pipelinePublish}` })).status, 403);
});

test("the owner can detect ingest before any live announcement without opening anonymous reads", async () => {
  const origin = `${getPublicKey(generateSecretKey())}--unannounced`;
  const token = issuePublishCredential(origin).token;
  const context = { params: Promise.resolve({ originStreamId: origin }) };
  const url = `https://node.example/api/broadcast/ingest-status/${origin}`;
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (input) => {
    fetches++;
    const upstream = new URL(String(input));
    assert.equal(upstream.pathname, `/${origin}/index.m3u8`);
    const result = await mediaAuth(new Request("http://web:5656/api/broadcast/media-auth", {
      method: "POST", headers: { authorization: `Basic ${Buffer.from(`media:${process.env.DSTREAM_MEDIA_AUTH_SECRET}`).toString("base64")}` },
      body: JSON.stringify({ action: "read", path: origin, query: upstream.search.slice(1) })
    }));
    assert.equal(result.status, 204);
    return new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nmain.m3u8\n");
  };
  try {
    assert.equal((await ingestStatus(new Request(url), context)).status, 403);
    assert.equal(fetches, 0);
    const response = await ingestStatus(new Request(url, { headers: { authorization: `Bearer ${token}` } }), context);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ready, true);
    assert.equal(fetches, 1);
  } finally { globalThis.fetch = originalFetch; }
});
