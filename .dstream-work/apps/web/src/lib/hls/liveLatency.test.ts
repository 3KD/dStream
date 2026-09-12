import assert from "node:assert/strict";
import test from "node:test";
import {
  findBufferedLiveStartupTarget,
  findBufferedLiveSyncTarget,
  getLiveLatencyRecoveryLimit,
  hasRepeatedMediaGaps
} from "./liveLatency";

test("derives a recovery limit from the source latency and segment duration", () => {
  assert.equal(getLiveLatencyRecoveryLimit(1.75, 2), 7.75);
  assert.equal(getLiveLatencyRecoveryLimit(6, 2), 12);
  assert.equal(getLiveLatencyRecoveryLimit(Number.NaN, 2), null);
  assert.equal(getLiveLatencyRecoveryLimit(2, 0), null);
});

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

test("requires recurring media gaps inside the recovery window", () => {
  assert.equal(hasRepeatedMediaGaps([1_000], 20_000), false);
  assert.equal(hasRepeatedMediaGaps([1_000, 20_000], 20_000), true);
  assert.equal(hasRepeatedMediaGaps([1_000, 20_000], 40_001), false);
});
