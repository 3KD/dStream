import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { buildStreamAnnounceEvent } from "@dstream/protocol";
import { makeOriginStreamId } from "./origin";
import {
  authorizePlaybackProxyRequest,
  authorizeVideoProxyRequest,
  issuePlaybackAccessToken,
  registerPlaybackPolicyFromAnnounceEvent
} from "./playback-access";

function buildSignedAnnounce(input: {
  streamId: string;
  status?: "live" | "ended";
  viewerAllowPubkeys?: string[];
  videoArchiveEnabled?: boolean;
  videoVisibility?: "public" | "private";
}) {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const unsigned = buildStreamAnnounceEvent({
    pubkey,
    createdAt: Math.floor(Date.now() / 1000),
    streamId: input.streamId,
    title: "test",
    status: input.status ?? "live",
    viewerAllowPubkeys: input.viewerAllowPubkeys ?? [],
    videoArchiveEnabled: input.videoArchiveEnabled,
    videoVisibility: input.videoVisibility
  });
  return { pubkey, signed: finalizeEvent(unsigned as any, secret) as any };
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

test("playback access: public archive allows anonymous video requests", () => {
  const { pubkey, signed } = buildSignedAnnounce({
    streamId: "video-public-1",
    status: "ended",
    videoArchiveEnabled: true,
    videoVisibility: "public"
  });
  assert.equal(registerPlaybackPolicyFromAnnounceEvent(signed).ok, true);
  const originStreamId = makeOriginStreamId(pubkey, "video-public-1");
  assert.ok(originStreamId);
  if (!originStreamId) return;
  assert.equal(authorizeVideoProxyRequest(originStreamId, null, ["index.m3u8"]).ok, true);
});

test("playback access: private archive rejects anonymous video requests", () => {
  const { pubkey, signed } = buildSignedAnnounce({
    streamId: "video-private-1",
    status: "ended",
    videoArchiveEnabled: true,
    videoVisibility: "private"
  });
  assert.equal(registerPlaybackPolicyFromAnnounceEvent(signed).ok, true);
  const originStreamId = makeOriginStreamId(pubkey, "video-private-1");
  assert.ok(originStreamId);
  if (!originStreamId) return;
  assert.equal(authorizeVideoProxyRequest(originStreamId, null, ["index.m3u8"]).ok, false);
});
