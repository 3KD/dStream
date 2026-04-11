import test from "node:test";
import assert from "node:assert/strict";
import type { StreamAnnounce } from "@dstream/protocol";
import { isLikelyLivePlayableMediaUrl, isLikelyLivePlaybackUrl, isLikelyPlayableMediaUrl, isLikelyVideoPlaybackUrl } from "./mediaUrl";
import { isReplayEligibleStream } from "./videoPolicy";

function buildAnnounce(overrides: Partial<StreamAnnounce>): StreamAnnounce {
  return {
    pubkey: "f".repeat(64),
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
    raw: { pubkey: "f".repeat(64), created_at: 1_700_000_000, kind: 30311, tags: [], content: "" },
    ...overrides
  };
}

test("stream path m3u8 is treated as live playback URL", () => {
  const url = "https://dstream.stream/stream/abcd-1234/index.m3u8";
  assert.equal(isLikelyLivePlaybackUrl(url), true);
  assert.equal(isLikelyVideoPlaybackUrl(url), false);
});

test("generic /stream page URL is not treated as media playback", () => {
  const url = "https://dstream.stream/stream/synthdragon-chill";
  assert.equal(isLikelyPlayableMediaUrl(url), false);
  assert.equal(isLikelyLivePlaybackUrl(url), false);
  assert.equal(isLikelyLivePlayableMediaUrl(url), false);
});

test("video endpoint URL is excluded from live-playable classification", () => {
  const url = "https://dstream.stream/api/video/file/abcd/index.m3u8";
  assert.equal(isLikelyVideoPlaybackUrl(url), true);
  assert.equal(isLikelyLivePlayableMediaUrl(url), false);
});

test("ended live-path stream is not replay-eligible", () => {
  const stream = buildAnnounce({
    videoArchiveEnabled: true,
    video: { mode: "public" },
    streaming: "https://dstream.stream/stream/abcd-1234/index.m3u8"
  });
  assert.equal(isReplayEligibleStream(stream), false);
});

test("explicit Video endpoint stream is replay-eligible", () => {
  const stream = buildAnnounce({
    videoArchiveEnabled: true,
    video: { mode: "public" },
    streaming: "https://dstream.stream/api/video/file/abcd/index.m3u8"
  });
  assert.equal(isReplayEligibleStream(stream), true);
});

test("private Video visibility is not replay-eligible for public browse", () => {
  const stream = buildAnnounce({
    videoArchiveEnabled: true,
    videoVisibility: "private",
    video: { mode: "public" },
    streaming: "https://dstream.stream/api/video/file/abcd/index.m3u8"
  });
  assert.equal(isReplayEligibleStream(stream), false);
});

test("direct media file requires explicit Video policy to be replay-eligible", () => {
  const directMp4 = "https://cdn.example.com/media/episode-1.mp4";
  const withPolicy = buildAnnounce({
    videoArchiveEnabled: true,
    video: { mode: "paid" },
    streaming: directMp4
  });
  assert.equal(isReplayEligibleStream(withPolicy), true);

  const withoutPolicy = buildAnnounce({
    videoArchiveEnabled: true,
    streaming: directMp4
  });
  assert.equal(isReplayEligibleStream(withoutPolicy), false);
});
