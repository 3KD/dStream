import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { buildStreamAnnounceEvent } from "@dstream/protocol";
import { makeOriginStreamId } from "./origin";
import {
  authorizePlaybackProxyRequest,
  authorizeVodProxyRequest,
  getPlaybackPolicy,
  parseOriginStreamIdFromPath,
  refreshPlaybackAccessToken,
  issuePlaybackAccessToken,
  registerPlaybackPolicyFromAnnounceEvent,
  verifyPlaybackAccessToken,
  verifyViewerProofEvent
} from "./playback-access";
import { upsertAccessDenyRule } from "./access/store";

function buildSignedAnnounce(input: {
  streamId: string;
  status?: "live" | "ended";
  viewerAllowPubkeys?: string[];
  vodArchiveEnabled?: boolean;
  vodVisibility?: "public" | "private";
  createdAt?: number;
}) {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const unsigned = buildStreamAnnounceEvent({
    pubkey,
    createdAt: input.createdAt ?? Math.floor(Date.now() / 1000),
    streamId: input.streamId,
    title: "test",
    status: input.status ?? "live",
    viewerAllowPubkeys: input.viewerAllowPubkeys ?? [],
    vodArchiveEnabled: input.vodArchiveEnabled,
    vodVisibility: input.vodVisibility
  });
  return { pubkey, secret, signed: finalizeEvent(unsigned as any, secret) as any };
}

test("playback access: private stream requires allowlisted token", () => {
  const viewerAllowed = "a".repeat(64);
  const viewerDenied = "b".repeat(64);
  const { pubkey, signed } = buildSignedAnnounce({
    streamId: "playback-private-1",
    viewerAllowPubkeys: [viewerAllowed]
  });
  const registration = registerPlaybackPolicyFromAnnounceEvent(signed);
  assert.equal(registration.ok, true);
  if (!registration.ok) return;

  const originStreamId = makeOriginStreamId(pubkey, "playback-private-1");
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const path = [originStreamId, "index.m3u8"];
  const deniedWithoutToken = authorizePlaybackProxyRequest(path, null);
  assert.equal(deniedWithoutToken.ok, false);

  const allowedToken = issuePlaybackAccessToken({
    originStreamId,
    viewerPubkey: viewerAllowed,
    privateStream: true,
    ttlSec: 300
  });
  assert.equal(authorizePlaybackProxyRequest(path, allowedToken.token).ok, true);

  const deniedToken = issuePlaybackAccessToken({
    originStreamId,
    viewerPubkey: viewerDenied,
    privateStream: true,
    ttlSec: 300
  });
  const deniedAuth = authorizePlaybackProxyRequest(path, deniedToken.token);
  assert.equal(deniedAuth.ok, false);
});

test("playback access: non-private stream allows passthrough without token", () => {
  const { pubkey, signed } = buildSignedAnnounce({
    streamId: "playback-public-1",
    viewerAllowPubkeys: []
  });
  const registration = registerPlaybackPolicyFromAnnounceEvent(signed);
  assert.equal(registration.ok, true);
  if (!registration.ok) return;

  const originStreamId = makeOriginStreamId(pubkey, "playback-public-1");
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const authz = authorizePlaybackProxyRequest([originStreamId, "index.m3u8"], null);
  assert.equal(authz.ok, true);
});

test("playback access: rendition suffix still enforces origin token", () => {
  const viewerAllowed = "c".repeat(64);
  const { pubkey, signed } = buildSignedAnnounce({
    streamId: "playback-private-2",
    viewerAllowPubkeys: [viewerAllowed]
  });
  const registration = registerPlaybackPolicyFromAnnounceEvent(signed);
  assert.equal(registration.ok, true);
  if (!registration.ok) return;

  const originStreamId = makeOriginStreamId(pubkey, "playback-private-2");
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const renditionSegment = `${originStreamId}__r720p`;
  const withoutToken = authorizePlaybackProxyRequest([renditionSegment, "index.m3u8"], null);
  assert.equal(withoutToken.ok, false);

  const token = issuePlaybackAccessToken({
    originStreamId,
    viewerPubkey: viewerAllowed,
    privateStream: true,
    ttlSec: 300
  });
  const withToken = authorizePlaybackProxyRequest([renditionSegment, "index.m3u8"], token.token);
  assert.equal(withToken.ok, true);
});

test("playback access: refresh token succeeds for valid private viewer", () => {
  const viewerAllowed = "d".repeat(64);
  const streamId = "playback-refresh-ok";
  const { pubkey, signed } = buildSignedAnnounce({
    streamId,
    viewerAllowPubkeys: [viewerAllowed]
  });
  const registration = registerPlaybackPolicyFromAnnounceEvent(signed);
  assert.equal(registration.ok, true);
  if (!registration.ok) return;

  const originStreamId = makeOriginStreamId(pubkey, streamId);
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const issued = issuePlaybackAccessToken({
    originStreamId,
    viewerPubkey: viewerAllowed,
    privateStream: true,
    ttlSec: 300
  });

  const refreshed = refreshPlaybackAccessToken({
    token: issued.token,
    announceEvent: signed
  });

  assert.equal(refreshed.ok, true);
  if (!refreshed.ok) return;
  assert.equal(refreshed.originStreamId, originStreamId);
  assert.equal(refreshed.privateStream, true);
  assert.equal(typeof refreshed.token, "string");
  assert.ok(refreshed.token.length > 0);
});

test("playback access: refresh denies when viewer removed from private allowlist", () => {
  const viewerAllowed = "e".repeat(64);
  const streamId = "playback-refresh-deny";
  const createdAt = Math.floor(Date.now() / 1000);
  const initial = buildSignedAnnounce({
    streamId,
    viewerAllowPubkeys: [viewerAllowed],
    createdAt
  });
  const registeredInitial = registerPlaybackPolicyFromAnnounceEvent(initial.signed);
  assert.equal(registeredInitial.ok, true);
  if (!registeredInitial.ok) return;

  const originStreamId = makeOriginStreamId(initial.pubkey, streamId);
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const issued = issuePlaybackAccessToken({
    originStreamId,
    viewerPubkey: viewerAllowed,
    privateStream: true,
    ttlSec: 300
  });

  const updatedUnsigned = buildStreamAnnounceEvent({
    pubkey: initial.pubkey,
    createdAt: createdAt + 20,
    streamId,
    title: "test",
    status: "live",
    viewerAllowPubkeys: ["f".repeat(64)]
  });
  const updatedSigned = finalizeEvent(updatedUnsigned as any, initial.secret);

  const refreshed = refreshPlaybackAccessToken({
    token: issued.token,
    announceEvent: updatedSigned as any
  });

  assert.equal(refreshed.ok, false);
  if (refreshed.ok) return;
  assert.equal(refreshed.status, 403);
});

test("playback access: refresh allows private-vod tokens without stream-wide entitlement", () => {
  const viewerPubkey = "f".repeat(64);
  const streamId = "playback-refresh-private-vod";
  const { pubkey, signed } = buildSignedAnnounce({
    streamId,
    viewerAllowPubkeys: [],
    vodArchiveEnabled: true,
    vodVisibility: "private"
  });
  const registration = registerPlaybackPolicyFromAnnounceEvent(signed);
  assert.equal(registration.ok, true);
  if (!registration.ok) return;

  const originStreamId = makeOriginStreamId(pubkey, streamId);
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const issued = issuePlaybackAccessToken({
    originStreamId,
    viewerPubkey,
    privateStream: false,
    ttlSec: 300
  });

  const refreshed = refreshPlaybackAccessToken({
    token: issued.token,
    announceEvent: signed
  });
  assert.equal(refreshed.ok, true);
  if (!refreshed.ok) return;
  assert.equal(refreshed.privateVod, true);
});

test("playback access: refresh still denies anonymous token for private-vod scopes", () => {
  const streamId = "playback-refresh-private-vod-anon";
  const { pubkey, signed } = buildSignedAnnounce({
    streamId,
    viewerAllowPubkeys: [],
    vodArchiveEnabled: true,
    vodVisibility: "private"
  });
  const registration = registerPlaybackPolicyFromAnnounceEvent(signed);
  assert.equal(registration.ok, true);
  if (!registration.ok) return;

  const originStreamId = makeOriginStreamId(pubkey, streamId);
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const issued = issuePlaybackAccessToken({
    originStreamId,
    privateStream: false,
    ttlSec: 300
  });

  const refreshed = refreshPlaybackAccessToken({
    token: issued.token,
    announceEvent: signed
  });
  assert.equal(refreshed.ok, false);
  if (refreshed.ok) return;
  assert.equal(refreshed.status, 403);
});

test("playback access: VOD file path deny can target playlist-like folder scope", () => {
  const viewerAllowed = "f".repeat(64);
  const streamId = "playback-vod-scope-deny";
  const { pubkey, signed } = buildSignedAnnounce({
    streamId,
    viewerAllowPubkeys: [viewerAllowed],
    vodArchiveEnabled: true,
    vodVisibility: "private"
  });
  const registration = registerPlaybackPolicyFromAnnounceEvent(signed);
  assert.equal(registration.ok, true);
  if (!registration.ok) return;

  const originStreamId = makeOriginStreamId(pubkey, streamId);
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const deniedPlaylistResource = `stream:${pubkey}:${streamId}:vod:paid_only:*`;
  upsertAccessDenyRule({
    hostPubkey: pubkey,
    subjectPubkey: viewerAllowed,
    resourceId: deniedPlaylistResource,
    actions: ["watch_vod"],
    reason: "test playlist deny"
  });

  const token = issuePlaybackAccessToken({
    originStreamId,
    viewerPubkey: viewerAllowed,
    privateStream: true,
    ttlSec: 300
  });

  const deniedFile = authorizeVodProxyRequest(originStreamId, token.token, ["paid_only", "episode01.mp4"]);
  assert.equal(deniedFile.ok, false);
  if (deniedFile.ok) return;
  assert.equal(deniedFile.status, 403);

  const allowedFile = authorizeVodProxyRequest(originStreamId, token.token, ["free", "episode01.mp4"]);
  assert.equal(allowedFile.ok, true);
});

test("playback access: file-scoped VOD entitlement authorizes only that file", async () => {
  const viewerPubkey = "9".repeat(64);
  const streamId = "playback-vod-file-scope";
  const { pubkey, signed } = buildSignedAnnounce({
    streamId,
    viewerAllowPubkeys: [],
    vodArchiveEnabled: true,
    vodVisibility: "private"
  });
  const registration = registerPlaybackPolicyFromAnnounceEvent(signed);
  assert.equal(registration.ok, true);
  if (!registration.ok) return;

  const originStreamId = makeOriginStreamId(pubkey, streamId);
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const { grantVodPackagePurchaseAccess, upsertVodAccessPackage } = await import("./access/packages");
  const scopedPackage = upsertVodAccessPackage({
    hostPubkey: pubkey,
    streamId,
    relativePath: "season1/episode01.mp4",
    title: "Episode unlock",
    paymentAsset: "xmr",
    paymentAmount: "0.05",
    durationHours: 24
  });
  const granted = grantVodPackagePurchaseAccess({
    packageId: scopedPackage.id,
    viewerPubkey,
    source: "purchase_verified",
    sourceRef: "tx:file-scope-1"
  });
  assert.equal(granted.granted, true);

  const token = issuePlaybackAccessToken({
    originStreamId,
    viewerPubkey,
    privateStream: true,
    ttlSec: 300
  });
  const allowed = authorizeVodProxyRequest(originStreamId, token.token, ["season1", "episode01.mp4"]);
  assert.equal(allowed.ok, true);

  const denied = authorizeVodProxyRequest(originStreamId, token.token, ["season1", "episode02.mp4"]);
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.status, 403);
});

test("playback access: parse origin stream id from path", () => {
  const originStreamId = makeOriginStreamId("a".repeat(64), "parse-check");
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const parsedRoot = parseOriginStreamIdFromPath([originStreamId, "index.m3u8"]);
  assert.equal(parsedRoot, originStreamId);

  const parsedRendition = parseOriginStreamIdFromPath([`${originStreamId}__r720p`, "index.m3u8"]);
  assert.equal(parsedRendition, `${originStreamId}__r720p`);

  const parsedEncoded = parseOriginStreamIdFromPath([encodeURIComponent(`${originStreamId}__r360p`)]);
  assert.equal(parsedEncoded, `${originStreamId}__r360p`);

  const parsedInvalid = parseOriginStreamIdFromPath(["invalid-origin-value"]);
  assert.equal(parsedInvalid, null);
});

test("playback access: get policy returns registered entry", () => {
  const { pubkey, signed } = buildSignedAnnounce({
    streamId: "policy-lookup-test",
    viewerAllowPubkeys: ["a".repeat(64)]
  });
  const registration = registerPlaybackPolicyFromAnnounceEvent(signed);
  assert.equal(registration.ok, true);
  if (!registration.ok) return;

  const originStreamId = makeOriginStreamId(pubkey, "policy-lookup-test");
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const policy = getPlaybackPolicy(originStreamId);
  assert.ok(policy);
  if (!policy) return;
  assert.equal(policy.originStreamId, originStreamId);
  assert.equal(policy.privateStream, true);
  assert.equal(policy.viewerAllowPubkeys.includes("a".repeat(64)), true);
});

test("playback access: verify token rejects signature/scope issues", () => {
  const originStreamId = makeOriginStreamId("b".repeat(64), "verify-token-test");
  assert.ok(originStreamId);
  if (!originStreamId) return;

  const issued = issuePlaybackAccessToken({
    originStreamId,
    viewerPubkey: "c".repeat(64),
    privateStream: true,
    ttlSec: 300
  });

  const ok = verifyPlaybackAccessToken(issued.token, originStreamId);
  assert.equal(ok.ok, true);

  const wrongScope = verifyPlaybackAccessToken(issued.token, makeOriginStreamId("d".repeat(64), "other") ?? "bad");
  assert.equal(wrongScope.ok, false);
  if (!wrongScope.ok) assert.equal(wrongScope.error, "token scope does not match stream");

  const tampered = issued.token.slice(0, -1) + (issued.token.endsWith("a") ? "b" : "a");
  const tamperedResult = verifyPlaybackAccessToken(tampered, originStreamId);
  assert.equal(tamperedResult.ok, false);
  if (!tamperedResult.ok) assert.equal(tamperedResult.error, "invalid access token signature");
});

test("playback access: verify viewer proof event", () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const originStreamId = makeOriginStreamId("e".repeat(64), "viewer-proof");
  assert.ok(originStreamId);
  if (!originStreamId) return;
  const now = Math.floor(Date.now() / 1000);

  const validEvent = finalizeEvent(
    {
      kind: 27235,
      created_at: now,
      tags: [
        ["dstream", "watch_access"],
        ["stream", originStreamId],
        ["exp", String(now + 120)]
      ],
      content: "",
      pubkey
    } as any,
    secret
  );

  const validResult = verifyViewerProofEvent(validEvent, { originStreamId });
  assert.equal(validResult.ok, true);
  if (!validResult.ok) return;
  assert.equal(validResult.viewerPubkey, pubkey);

  const staleEvent = finalizeEvent(
    {
      kind: 27235,
      created_at: now - 5000,
      tags: [
        ["dstream", "watch_access"],
        ["stream", originStreamId],
        ["exp", String(now + 120)]
      ],
      content: "",
      pubkey
    } as any,
    secret
  );
  const staleResult = verifyViewerProofEvent(staleEvent, { originStreamId });
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.error, "viewerProofEvent timestamp is stale.");
});
