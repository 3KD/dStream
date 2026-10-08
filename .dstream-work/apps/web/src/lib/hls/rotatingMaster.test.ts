import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRotatingMasterSnapshot,
  isRotatingHlsProviderUrl,
  isZapStreamHlsUrl,
  parseRotatingMasterPlaylist,
  resolveHlsStartupBufferTarget,
  resolveHlsPlaybackCompatibilityPolicy,
  selectBufferedLiveStartupPosition,
  selectRotatingStartupLevel,
  shouldFallbackToAudioForMissingVideoFragment,
  shouldRefreshRotatingMasterOnHlsError,
} from "./rotatingMaster";

function master(audioId: string, video360Id: string, video720Id: string): string {
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="main",DEFAULT=YES,AUTOSELECT=YES,URI="${audioId}/live.m3u8?vt=test"`,
    "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,FRAME-RATE=62.5,AUDIO=\"audio\"",
    `${video360Id}/live.m3u8`,
    "#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=62.5,AUDIO=\"audio\"",
    `${video720Id}/live.m3u8`
  ].join("\n");
}

async function loadMasterParser() {
  const hls = await import("hls.js/dist/hls.mjs");
  return hls.M3U8Parser;
}

test("identifies supported rotating HLS providers without suffix confusion", () => {
  assert.equal(isZapStreamHlsUrl("https://zap.stream/live.m3u8"), true);
  assert.equal(isRotatingHlsProviderUrl("https://s1.letsfo.com/id/hls/live.m3u8"), true);
  assert.equal(isRotatingHlsProviderUrl("https://api.streamroad.money/id/hls/live.m3u8"), true);
  assert.equal(isRotatingHlsProviderUrl("https://evilletsfo.com/live.m3u8"), false);
  assert.equal(isRotatingHlsProviderUrl("/api/hls/local/index.m3u8"), false);
});

test("sizes startup reserves by provider and external segment cadence", () => {
  assert.equal(
    resolveHlsStartupBufferTarget({
      defaultTargetSeconds: 3,
      rotatingProvider: true,
      thirdParty: true,
      classicExternal: false,
      backgroundPlayback: false,
      targetDurationSeconds: 2
    }),
    6
  );
  assert.equal(
    resolveHlsStartupBufferTarget({
      defaultTargetSeconds: 3,
      rotatingProvider: false,
      thirdParty: true,
      classicExternal: false,
      backgroundPlayback: false,
      targetDurationSeconds: 4
    }),
    4
  );
  assert.equal(
    resolveHlsStartupBufferTarget({
      defaultTargetSeconds: 1,
      rotatingProvider: false,
      thirdParty: false,
      classicExternal: false,
      backgroundPlayback: false,
      targetDurationSeconds: 4
    }),
    1
  );
  assert.equal(
    resolveHlsStartupBufferTarget({
      defaultTargetSeconds: 4,
      rotatingProvider: false,
      thirdParty: true,
      classicExternal: false,
      backgroundPlayback: true,
      targetDurationSeconds: 4
    }),
    6
  );
  assert.equal(
    resolveHlsStartupBufferTarget({
      defaultTargetSeconds: 2,
      rotatingProvider: false,
      thirdParty: true,
      classicExternal: true,
      backgroundPlayback: false,
      targetDurationSeconds: 4
    }),
    8
  );
});

test("starts inside an existing buffer with the requested live reserve", () => {
  assert.equal(
    selectBufferedLiveStartupPosition({
      currentTime: 46,
      rangeStart: 28,
      rangeEnd: 48,
      targetBufferSeconds: 10
    }),
    38
  );
  assert.equal(
    selectBufferedLiveStartupPosition({
      currentTime: 30,
      rangeStart: 28,
      rangeEnd: 48,
      targetBufferSeconds: 10
    }),
    null
  );
  assert.equal(
    selectBufferedLiveStartupPosition({
      currentTime: 50,
      rangeStart: 28,
      rangeEnd: 34,
      targetBufferSeconds: 10
    }),
    28.1
  );
});

test("selects the lowest bitrate only for rotating-provider startup", () => {
  assert.equal(
    selectRotatingStartupLevel([{ bitrate: 8_000_000 }, { bitrate: 1_500_000 }, { bitrate: 4_000_000 }]),
    1
  );
  assert.equal(selectRotatingStartupLevel([]), -1);
});

test("only a missing main video fragment selects the stable audio rendition", () => {
  assert.equal(
    shouldFallbackToAudioForMissingVideoFragment({
      fatal: false,
      details: "fragLoadError",
      status: 404,
      fragmentType: "main"
    }),
    true
  );
  assert.equal(
    shouldFallbackToAudioForMissingVideoFragment({
      fatal: false,
      details: "fragLoadError",
      status: 404,
      fragmentType: "audio"
    }),
    false
  );
  assert.equal(
    shouldFallbackToAudioForMissingVideoFragment({
      fatal: false,
      details: "fragLoadTimeout",
      status: null,
      fragmentType: "main"
    }),
    false
  );
});

test("rotating master refresh ignores transient timeouts but handles hard or fatal failures", () => {
  assert.equal(shouldRefreshRotatingMasterOnHlsError({ fatal: false, details: "levelLoadTimeOut" }), false);
  assert.equal(shouldRefreshRotatingMasterOnHlsError({ fatal: false, details: "audioTrackLoadTimeOut" }), false);
  assert.equal(shouldRefreshRotatingMasterOnHlsError({ fatal: false, details: "fragLoadTimeOut" }), false);
  assert.equal(shouldRefreshRotatingMasterOnHlsError({ fatal: false, details: "levelLoadError" }), true);
  assert.equal(shouldRefreshRotatingMasterOnHlsError({ fatal: false, details: "audioTrackLoadError" }), true);
  assert.equal(shouldRefreshRotatingMasterOnHlsError({ fatal: false, details: "fragLoadError" }), true);
  assert.equal(shouldRefreshRotatingMasterOnHlsError({ fatal: true, details: "levelLoadTimeOut" }), true);
});

test("uses a three-segment completed-media position for rotating providers", () => {
  assert.deepEqual(
    resolveHlsPlaybackCompatibilityPolicy({
      sourceUrl: "https://api-uk.zap.stream/id/hls/live.m3u8",
      isFirefox: false,
      lowLatencyEnabled: true
    }),
    {
      stableMode: false,
      bridgeLiveGaps: false,
      lowLatencyEnabled: false,
      preferCompleteSegments: true,
      completeSegmentLiveSyncCount: 3,
      liveSyncDurationSeconds: null
    }
  );
  assert.deepEqual(
    resolveHlsPlaybackCompatibilityPolicy({
      sourceUrl: "https://s1.letsfo.com/id/hls/live.m3u8",
      isFirefox: false,
      lowLatencyEnabled: true
    }),
    {
      stableMode: false,
      bridgeLiveGaps: false,
      lowLatencyEnabled: false,
      preferCompleteSegments: true,
      completeSegmentLiveSyncCount: 3,
      liveSyncDurationSeconds: null
    }
  );
});

test("keeps Firefox compatibility mode for rotating providers", () => {
  assert.deepEqual(
    resolveHlsPlaybackCompatibilityPolicy({
      sourceUrl: "https://api-uk.zap.stream/id/hls/live.m3u8",
      isFirefox: true,
      lowLatencyEnabled: true
    }),
    {
      stableMode: true,
      bridgeLiveGaps: true,
      lowLatencyEnabled: false,
      preferCompleteSegments: true,
      completeSegmentLiveSyncCount: 3,
      liveSyncDurationSeconds: null
    }
  );
});

test("limits generic stable compatibility mode to Firefox", () => {
  assert.deepEqual(
    resolveHlsPlaybackCompatibilityPolicy({
      sourceUrl: "https://cdn.example.com/live.m3u8",
      isFirefox: true,
      lowLatencyEnabled: true
    }),
    {
      stableMode: true,
      bridgeLiveGaps: true,
      lowLatencyEnabled: false,
      preferCompleteSegments: false,
      completeSegmentLiveSyncCount: null,
      liveSyncDurationSeconds: null
    }
  );
  assert.deepEqual(
    resolveHlsPlaybackCompatibilityPolicy({
      sourceUrl: "https://cdn.example.com/live.m3u8",
      isFirefox: false,
      lowLatencyEnabled: true
    }),
    {
      stableMode: false,
      bridgeLiveGaps: false,
      lowLatencyEnabled: true,
      preferCompleteSegments: false,
      completeSegmentLiveSyncCount: null,
      liveSyncDurationSeconds: null
    }
  );
});

test("keeps a three-segment live reserve for Streamroad", () => {
  const policy = resolveHlsPlaybackCompatibilityPolicy({
    sourceUrl: "https://api.streamroad.money/id/hls/live.m3u8",
    isFirefox: false,
    lowLatencyEnabled: true
  });
  assert.equal(policy.preferCompleteSegments, true);
  assert.equal(policy.completeSegmentLiveSyncCount, 3);
});

test("parses rotating master renditions and resolves their relative URLs", async () => {
  const parser = await loadMasterParser();
  const snapshot = parseRotatingMasterPlaylist(
    master("audio-a", "video-360-a", "video-720-a"),
    "https://s1.letsfo.com/stream/hls/live.m3u8",
    parser
  );
  assert.ok(snapshot);
  assert.deepEqual(
    snapshot.levels.map((level) => [level.height, level.url]),
    [
      [360, "https://s1.letsfo.com/stream/hls/video-360-a/live.m3u8"],
      [720, "https://s1.letsfo.com/stream/hls/video-720-a/live.m3u8"]
    ]
  );
  assert.equal(snapshot.audioTracks[0]?.url, "https://s1.letsfo.com/stream/hls/audio-a/live.m3u8?vt=test");
});

test("updates rotated rendition URLs in place while retaining quality identity", async () => {
  const parser = await loadMasterParser();
  const snapshot = parseRotatingMasterPlaylist(
    master("audio-b", "video-360-b", "video-720-b"),
    "https://s1.letsfo.com/stream/hls/live.m3u8",
    parser
  );
  assert.ok(snapshot);

  const target = {
    levels: [
      {
        url: ["https://s1.letsfo.com/stream/hls/video-720-a/live.m3u8"],
        width: 1280,
        height: 720,
        bitrate: 3_000_000,
        name: "",
        details: { live: true },
        loadError: 3,
        fragmentError: 2
      },
      {
        url: ["https://s1.letsfo.com/stream/hls/video-360-a/live.m3u8"],
        width: 640,
        height: 360,
        bitrate: 800_000,
        name: "",
        details: { live: true },
        loadError: 1,
        fragmentError: 1
      }
    ],
    audioTracks: [
      {
        url: "https://s1.letsfo.com/stream/hls/audio-a/live.m3u8?vt=test",
        groupId: "audio",
        name: "main",
        lang: "",
        details: { live: true }
      }
    ]
  };
  const levelDetails = target.levels[0]?.details;
  const audioDetails = target.audioTracks[0]?.details;

  const update = applyRotatingMasterSnapshot(target, snapshot);
  assert.deepEqual(update, { changed: true, levelsChanged: 2, audioTracksChanged: 1 });
  assert.match(target.levels[0]?.url[0] ?? "", /video-720-b/);
  assert.match(target.levels[1]?.url[0] ?? "", /video-360-b/);
  assert.match(target.audioTracks[0]?.url ?? "", /audio-b/);
  assert.strictEqual(target.levels[0]?.details, levelDetails);
  assert.strictEqual(target.audioTracks[0]?.details, audioDetails);
  assert.equal(target.levels[0]?.loadError, 0);
  assert.equal(target.levels[0]?.fragmentError, 0);
  assert.deepEqual(applyRotatingMasterSnapshot(target, snapshot), {
    changed: false,
    levelsChanged: 0,
    audioTracksChanged: 0
  });
});
