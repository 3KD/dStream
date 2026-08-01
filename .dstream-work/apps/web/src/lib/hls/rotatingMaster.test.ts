import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRotatingMasterSnapshot,
  isRotatingHlsProviderUrl,
  isZapStreamHlsUrl,
  parseRotatingMasterPlaylist
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

test("identifies Zap and letsfo rotating HLS providers without suffix confusion", () => {
  assert.equal(isZapStreamHlsUrl("https://zap.stream/live.m3u8"), true);
  assert.equal(isRotatingHlsProviderUrl("https://s1.letsfo.com/id/hls/live.m3u8"), true);
  assert.equal(isRotatingHlsProviderUrl("https://evilletsfo.com/live.m3u8"), false);
  assert.equal(isRotatingHlsProviderUrl("/api/hls/local/index.m3u8"), false);
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

  const update = applyRotatingMasterSnapshot(target, snapshot);
  assert.deepEqual(update, { changed: true, levelsChanged: 2, audioTracksChanged: 1 });
  assert.match(target.levels[0]?.url[0] ?? "", /video-720-b/);
  assert.match(target.levels[1]?.url[0] ?? "", /video-360-b/);
  assert.match(target.audioTracks[0]?.url ?? "", /audio-b/);
  assert.equal(target.levels[0]?.details, undefined);
  assert.equal(target.levels[0]?.loadError, 0);
  assert.equal(target.levels[0]?.fragmentError, 0);
  assert.deepEqual(applyRotatingMasterSnapshot(target, snapshot), {
    changed: false,
    levelsChanged: 0,
    audioTracksChanged: 0
  });
});
