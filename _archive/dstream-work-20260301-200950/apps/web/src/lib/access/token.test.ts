import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { issueAccessToken, verifyAccessToken, type AccessTokenPayload } from "./token";

process.env.DSTREAM_ACCESS_TOKEN_SECRET = "dstream-access-test-secret";

function signPayload(payload: AccessTokenPayload): string {
  const payloadEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", Buffer.from(process.env.DSTREAM_ACCESS_TOKEN_SECRET ?? "", "utf8"))
    .update(payloadEncoded)
    .digest("base64url");
  return `${payloadEncoded}.${signature}`;
}

test("access token: issue + verify roundtrip", () => {
  const issued = issueAccessToken({
    hostPubkey: "a".repeat(64),
    resourceId: `stream:${"a".repeat(64)}:test:live`,
    subjectPubkey: "b".repeat(64),
    actions: ["watch_live"],
    sourceCode: "allow_public",
    ttlSec: 120
  });

  const verified = verifyAccessToken(issued.token);
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.payload.host, "a".repeat(64));
  assert.equal(verified.payload.sub, "b".repeat(64));
  assert.equal(verified.payload.act.includes("watch_live"), true);
});

test("access token: rejects malformed and tampered values", () => {
  assert.equal(verifyAccessToken("").ok, false);
  assert.equal(verifyAccessToken("abc").ok, false);

  const issued = issueAccessToken({
    hostPubkey: "c".repeat(64),
    resourceId: `stream:${"c".repeat(64)}:test:live`,
    subjectPubkey: "d".repeat(64),
    actions: ["watch_live"],
    sourceCode: "allow_public",
    ttlSec: 120
  });
  const tampered = issued.token.slice(0, -1) + (issued.token.endsWith("a") ? "b" : "a");
  const verified = verifyAccessToken(tampered);
  assert.equal(verified.ok, false);
  if (verified.ok) return;
  assert.equal(verified.error, "invalid token signature");
});

test("access token: rejects expired and future-issued payloads", () => {
  const now = Math.floor(Date.now() / 1000);
  const basePayload: AccessTokenPayload = {
    v: 1,
    host: "e".repeat(64),
    res: `stream:${"e".repeat(64)}:test:live`,
    sub: "f".repeat(64),
    act: ["watch_live"],
    src: "allow_public",
    iat: now,
    exp: now + 120,
    jti: "test-jti"
  };

  const expired = signPayload({ ...basePayload, iat: now - 200, exp: now - 100 });
  const expiredResult = verifyAccessToken(expired);
  assert.equal(expiredResult.ok, false);
  if (!expiredResult.ok) assert.equal(expiredResult.error, "token expired");

  const futureIssued = signPayload({ ...basePayload, iat: now + 120, exp: now + 220, jti: "future-jti" });
  const futureResult = verifyAccessToken(futureIssued);
  assert.equal(futureResult.ok, false);
  if (!futureResult.ok) assert.equal(futureResult.error, "token issued in the future");
});
