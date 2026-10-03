import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  getResolvedRtcConfig,
  parsePublicStunServers,
  resetWebRtcIceServerCacheForTests
} from "./webrtc";
import { issueTurnCredentials, parseTurnCredentialTtl, parseTurnUrls } from "./webrtcServer";

test("TURN credentials use coturn REST HMAC and expire", () => {
  const sharedSecret = "test-only-".repeat(4);
  const issued = issueTurnCredentials({
    urls: ["turn:turn.example.test:3478?transport=udp"],
    sharedSecret,
    ttlSec: 600,
    nowSec: 1_700_000_000,
    nonce: "client"
  });

  assert.equal(issued.expiresAt, 1_700_000_600);
  assert.equal(issued.iceServer.username, "1700000600:client");
  assert.equal(
    issued.iceServer.credential,
    createHmac("sha1", sharedSecret).update(issued.iceServer.username).digest("base64")
  );
});

test("TURN configuration accepts only TURN URLs and clamps TTL", () => {
  assert.deepEqual(
    parseTurnUrls('["turn:relay.example.test:3478","https://not-turn.example.test","turn:relay.example.test:3478"]'),
    ["turn:relay.example.test:3478"]
  );
  assert.equal(parseTurnCredentialTtl("5"), 60);
  assert.equal(parseTurnCredentialTtl("999999"), 86_400);
  assert.equal(parseTurnCredentialTtl("invalid"), 600);
});

test("public ICE configuration accepts STUN URLs only", () => {
  assert.deepEqual(
    parsePublicStunServers('["stun:stun.example.test:3478","turn:turn.example.test:3478"]'),
    [{ urls: "stun:stun.example.test:3478" }]
  );
});

test("resolved RTC config merges short-lived TURN credentials", async () => {
  resetWebRtcIceServerCacheForTests();
  const nowMs = 1_700_000_000_000;
  const fetcher = async () => Response.json({
    iceServers: [{
      urls: ["turn:turn.example.test:3478?transport=udp"],
      username: "1700000600:client",
      credential: "temporary-credential"
    }],
    expiresAt: 1_700_000_600
  });

  const config = await getResolvedRtcConfig({ fetcher: fetcher as typeof fetch, nowMs });
  assert.equal(config.iceServers?.some((server) => server.username === "1700000600:client"), true);
});

test("resolved RTC config falls back to STUN when credential service is unavailable", async () => {
  resetWebRtcIceServerCacheForTests();
  const fetcher = async () => new Response(null, { status: 503 });
  const config = await getResolvedRtcConfig({ fetcher: fetcher as typeof fetch, nowMs: 1_700_000_000_000 });
  assert.equal(config.iceServers?.every((server) => serverUrls(server).every((url) => url.startsWith("stun:"))), true);
});

function serverUrls(server: RTCIceServer): string[] {
  return Array.isArray(server.urls) ? server.urls : [server.urls];
}
