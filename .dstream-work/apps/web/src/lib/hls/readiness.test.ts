import assert from "node:assert/strict";
import test from "node:test";
import { inspectHlsPlaylist } from "./readiness";

test("rejects empty and malformed HLS responses", () => {
  assert.deepEqual(inspectHlsPlaylist(""), { playable: false, kind: "empty" });
  assert.deepEqual(inspectHlsPlaylist("upstream error"), { playable: false, kind: "malformed" });
  assert.deepEqual(inspectHlsPlaylist("#EXTM3U\n#EXT-X-VERSION:3"), { playable: false, kind: "empty" });
  assert.deepEqual(inspectHlsPlaylist("#EXTM3U\n#EXTINF:2.0,"), { playable: false, kind: "empty" });
  assert.deepEqual(inspectHlsPlaylist("#EXTM3U\n#EXT-X-PART:DURATION=0.2"), { playable: false, kind: "empty" });
  assert.deepEqual(inspectHlsPlaylist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000"), {
    playable: false,
    kind: "empty"
  });
});

test("accepts media, low-latency, and master playlists", () => {
  assert.deepEqual(inspectHlsPlaylist("#EXTM3U\n#EXTINF:2.0,\nsegment.ts"), { playable: true, kind: "media" });
  assert.deepEqual(inspectHlsPlaylist("  #EXTM3U\n#EXT-X-PART:DURATION=0.2,URI=part.mp4"), {
    playable: true,
    kind: "low_latency_media"
  });
  assert.deepEqual(inspectHlsPlaylist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nindex.m3u8"), {
    playable: true,
    kind: "master"
  });
});
