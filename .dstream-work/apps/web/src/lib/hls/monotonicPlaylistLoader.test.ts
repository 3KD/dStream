import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectPlaylistWindow,
  isStalePlaylistWindow,
  MonotonicPlaylistLoader,
  sanitizePlaylistTiming
} from "./monotonicPlaylistLoader";

function playlist(sequence: number, dates: string[]): string {
  return [
    "#EXTM3U",
    `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
    ...dates.flatMap((date, index) => [
      `#EXT-X-PROGRAM-DATE-TIME:${date}`,
      "#EXTINF:4.0,",
      `${sequence + index}.m4s`
    ])
  ].join("\n");
}

test("playlist windows include their complete segment range", () => {
  assert.deepEqual(inspectPlaylistWindow(playlist(4374, ["2026-07-19T06:52:02.584Z", "2026-07-19T06:52:06.584Z"])), {
    mediaSequence: 4374,
    endSequence: 4375,
    lastProgramDateTime: Date.parse("2026-07-19T06:52:06.584Z")
  });
});

test("older live playlist windows are rejected", () => {
  const current = inspectPlaylistWindow(
    playlist(4374, ["2026-07-19T06:52:02.584Z", "2026-07-19T06:52:06.584Z", "2026-07-19T06:52:10.584Z"])
  );
  const stale = inspectPlaylistWindow(
    playlist(4367, ["2026-07-19T06:51:35.027Z", "2026-07-19T06:51:39.027Z", "2026-07-19T06:51:43.027Z"])
  );
  assert.ok(current && stale);
  assert.equal(isStalePlaylistWindow(current, stale), true);
});

test("newer and expanding live playlist windows are accepted", () => {
  const current = inspectPlaylistWindow(playlist(100, ["2026-07-19T00:00:00.000Z"]));
  const expanded = inspectPlaylistWindow(
    playlist(100, ["2026-07-19T00:00:00.000Z", "2026-07-19T00:00:04.000Z"])
  );
  assert.ok(current && expanded);
  assert.equal(isStalePlaylistWindow(current, expanded), false);
});

test("invalid target durations are raised to the rounded maximum segment duration", () => {
  const malformed = [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:2",
    "#EXTINF:3.921,",
    "100.m4s",
    "#EXTINF:3.920,",
    "101.m4s"
  ].join("\n");

  assert.match(sanitizePlaylistTiming(malformed), /^#EXT-X-TARGETDURATION:4$/m);
});

test("valid target durations are not changed", () => {
  const valid = ["#EXTM3U", "#EXT-X-TARGETDURATION:2", "#EXTINF:2.005,", "100.m4s"].join("\n");
  assert.equal(sanitizePlaylistTiming(valid), valid);
});

test("loader reports corrected timing without classifying the rendition as unusable", async () => {
  const malformed = ["#EXTM3U", "#EXT-X-MEDIA-SEQUENCE:100", "#EXT-X-TARGETDURATION:2", "#EXTINF:3.92,", "100.m4s"].join("\n");
  const correctedUrls: string[] = [];
  class TestHttpLoader {
    destroy() {}
    abort() {}
    load(context: any, _config: any, callbacks: any) {
      callbacks.onSuccess({ data: malformed, url: context.url }, {}, context, null);
    }
  }
  const config: any = {
    loader: TestHttpLoader,
    dstreamPlaylistTimingCorrected: false,
    dstreamOnPlaylistTimingCorrected: (url: string) => correctedUrls.push(url)
  };
  const loader = new MonotonicPlaylistLoader(config);
  const response = await new Promise<string>((resolve, reject) => {
    loader.load(
      { type: "level", level: 0, url: "https://example.test/video.m3u8", responseType: "text" } as any,
      {} as any,
      {
        onSuccess: (result: any) => resolve(result.data),
        onError: (error: any) => reject(error),
        onTimeout: () => reject(new Error("playlist load timed out"))
      } as any
    );
  });

  assert.match(response, /^#EXT-X-TARGETDURATION:4$/m);
  assert.equal(config.dstreamPlaylistTimingCorrected, true);
  assert.deepEqual(correctedUrls, ["https://example.test/video.m3u8"]);
});
