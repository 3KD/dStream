import test from "node:test";
import assert from "node:assert/strict";
import { makeStreamKey, type StreamAnnounce } from "@dstream/protocol";
import {
  normalizeSnapshotStreamAvailability,
  normalizeSnapshotStreamList,
  shouldIncludeSnapshotStream,
  sortSnapshotStreamsForResponse,
  streamSnapshotKey
} from "./discoverySnapshot";

function buildAnnounce(overrides: Partial<StreamAnnounce> = {}): StreamAnnounce {
  return {
    pubkey: "a".repeat(64),
    streamId: "stream-1",
    title: "Test Stream",
    status: "ended",
    discoverable: true,
    matureContent: false,
    viewerAllowPubkeys: [],
    videoVisibility: "public",
    feeWaiverGuilds: [],
    feeWaiverVipPubkeys: [],
    payments: [],
    captions: [],
    renditions: [],
    topics: [],
    createdAt: 1_700_000_000,
    raw: { pubkey: "a".repeat(64), created_at: 1_700_000_000, kind: 30311, tags: [], content: "" },
    ...overrides
  };
}

test("snapshot keeps ended public announcements even without playback URL", () => {
  const stream = buildAnnounce({ status: "ended", streaming: undefined });
  assert.equal(shouldIncludeSnapshotStream(stream), true);
  assert.equal(normalizeSnapshotStreamAvailability(stream), stream);
});

test("snapshot demotes live announcements with missing playback URL", () => {
  const stream = buildAnnounce({ status: "live", streaming: undefined });
  const normalized = normalizeSnapshotStreamAvailability(stream);
  assert.equal(normalized.status, "ended");
});

test("snapshot preserves definitely dead live signals with playback health instead of hiding them", () => {
  const stream = buildAnnounce({
    status: "live",
    streaming: "https://example.com/hls/live.m3u8"
  });
  const normalized = normalizeSnapshotStreamList([stream], new Set([streamSnapshotKey(stream)]));
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.status, "live");
  assert.equal(normalized[0]?.playbackHealth, "unavailable");
  assert.equal(normalized[0]?.playbackHealthReason, "playback_probe_failed");
});

test("snapshot promotes verifier-backed ended playback candidates to live", () => {
  const stream = buildAnnounce({
    status: "ended",
    streaming: "https://example.com/hls/live.m3u8"
  });
  const normalized = normalizeSnapshotStreamList([stream], new Set(), new Set([streamSnapshotKey(stream)]));
  assert.equal(normalized[0]?.status, "live");
});

test("snapshot excludes non-discoverable and moderated announcements", () => {
  const hiddenPubkeyStream = buildAnnounce({ pubkey: "b".repeat(64) });
  const hiddenStream = buildAnnounce({ pubkey: "c".repeat(64), streamId: "stream-2" });
  const hiddenPubkeys = new Map([[hiddenPubkeyStream.pubkey, { hidden: true, createdAt: 1 }]]);
  const hiddenStreams = new Map([[makeStreamKey(hiddenStream.pubkey, hiddenStream.streamId), { hidden: true, createdAt: 1 }]]);

  assert.equal(shouldIncludeSnapshotStream(buildAnnounce({ discoverable: false })), false);
  assert.equal(shouldIncludeSnapshotStream(hiddenPubkeyStream, hiddenPubkeys), false);
  assert.equal(shouldIncludeSnapshotStream(hiddenStream, new Map(), hiddenStreams), false);
});

test("snapshot response sort preserves older live streams ahead of newer offline entries", () => {
  const newerEnded = buildAnnounce({ streamId: "newer-ended", status: "ended", createdAt: 1_800_000_000 });
  const olderLive = buildAnnounce({
    streamId: "older-live",
    status: "live",
    createdAt: 1_700_000_000,
    streaming: "https://example.com/hls/live.m3u8"
  });

  const sorted = sortSnapshotStreamsForResponse([newerEnded, olderLive]);
  assert.equal(sorted[0]?.streamId, "older-live");
  assert.equal(sorted[1]?.streamId, "newer-ended");
});

test("snapshot response sort keeps potential live playback hints ahead of ordinary ended entries", () => {
  const newerEnded = buildAnnounce({ streamId: "newer-ended", status: "ended", createdAt: 1_800_000_000 });
  const olderPotentialLive = buildAnnounce({
    streamId: "older-potential-live",
    status: "ended",
    createdAt: 1_700_000_000,
    streaming: "https://example.com/stream/live/index.m3u8"
  });

  const sorted = sortSnapshotStreamsForResponse([newerEnded, olderPotentialLive]);
  assert.equal(sorted[0]?.streamId, "older-potential-live");
  assert.equal(sorted[1]?.streamId, "newer-ended");
});
