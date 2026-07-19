import assert from "node:assert/strict";
import test from "node:test";
import { inspectHlsManifest } from "./streamHealth";

test("inspectHlsManifest selects a master variant", () => {
  assert.deepEqual(
    inspectHlsManifest("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow/live.m3u8\n"),
    { variant: "low/live.m3u8", segment: null }
  );
});

test("inspectHlsManifest selects the newest complete media segment", () => {
  assert.deepEqual(
    inspectHlsManifest("#EXTM3U\n#EXTINF:4,\n10.ts\n#EXTINF:4,\n11.ts\n"),
    { variant: null, segment: "11.ts" }
  );
});

test("inspectHlsManifest rejects HTML", () => {
  assert.equal(inspectHlsManifest("<html>not media</html>"), null);
});
