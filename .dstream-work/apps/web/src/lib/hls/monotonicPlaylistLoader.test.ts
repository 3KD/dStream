import assert from "node:assert/strict";
import test from "node:test";
import { inspectPlaylistWindow, isStalePlaylistWindow } from "./monotonicPlaylistLoader";

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
