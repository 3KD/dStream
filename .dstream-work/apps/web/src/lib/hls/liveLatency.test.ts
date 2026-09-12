import assert from "node:assert/strict";
import test from "node:test";
import {
  findBufferedLiveStartupTarget,
  findBufferedLiveSyncTarget,
  hasRepeatedMediaGaps
} from "./liveLatency";

test("selects the live position only when media is already buffered there", () => {
  const ranges = [
    { start: 10, end: 12 },
    { start: 20, end: 24 }
  ];

  assert.equal(findBufferedLiveSyncTarget(ranges, 22), 22);
  assert.equal(findBufferedLiveSyncTarget(ranges, 23.95), null);
  assert.equal(findBufferedLiveSyncTarget(ranges, 18), null);
});

test("starts live playback from the newest safe buffered position", () => {
  const ranges = [
    { start: 10, end: 40 },
    { start: 50, end: 54 }
  ];

  assert.equal(findBufferedLiveStartupTarget(ranges, 52, 0.5), 52);
  assert.equal(findBufferedLiveStartupTarget(ranges, 53.9, 0.5), 53.5);
  assert.equal(findBufferedLiveStartupTarget(ranges, 39, 0.5), 53.5);
  assert.equal(findBufferedLiveStartupTarget(ranges, Number.NaN, 0.5), 53.5);
  assert.equal(findBufferedLiveStartupTarget([{ start: 10, end: 10.4 }], null, 0.5), 10.2);
  assert.equal(findBufferedLiveStartupTarget([], 12, 0.5), null);
});

test("rejects a stale live sync point before low-latency playback starts", () => {
  const ranges = [{ start: 34.837, end: 43.178 }];

  assert.equal(findBufferedLiveStartupTarget(ranges, 35.067, 0.5, 2.5), 40.678);
  assert.equal(findBufferedLiveStartupTarget(ranges, 41.428, 0.5, 2.5), 41.428);
  assert.equal(findBufferedLiveStartupTarget(ranges, 42.95, 0.5, 2.5), 40.678);
});

test("requires recurring media gaps inside the recovery window", () => {
  assert.equal(hasRepeatedMediaGaps([1_000], 20_000), false);
  assert.equal(hasRepeatedMediaGaps([1_000, 20_000], 20_000), true);
  assert.equal(hasRepeatedMediaGaps([1_000, 20_000], 40_001), false);
});
