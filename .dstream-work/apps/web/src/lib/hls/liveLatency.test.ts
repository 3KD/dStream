import assert from "node:assert/strict";
import test from "node:test";
import {
  findBufferedLiveSyncTarget,
  getLiveLatencyRecoveryLimit,
  hasRepeatedMediaGaps
} from "./liveLatency";

test("derives a recovery limit from the source latency and segment duration", () => {
  assert.equal(getLiveLatencyRecoveryLimit(1.75, 2), 3.75);
  assert.equal(getLiveLatencyRecoveryLimit(6, 2), 8);
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

test("requires recurring media gaps inside the recovery window", () => {
  assert.equal(hasRepeatedMediaGaps([1_000], 20_000), false);
  assert.equal(hasRepeatedMediaGaps([1_000, 20_000], 20_000), true);
  assert.equal(hasRepeatedMediaGaps([1_000, 20_000], 40_001), false);
});
