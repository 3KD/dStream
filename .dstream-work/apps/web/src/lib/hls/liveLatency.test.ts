import assert from "node:assert/strict";
import test from "node:test";
import {
  findBufferedLiveStartupTarget,
  findBufferedLiveSyncTarget,
  hasRepeatedMediaGaps,
  isBufferedLiveStartupRangeCurrent,
  resolveAdaptiveLiveStartupBufferSeconds
} from "./liveLatency";

test("adaptive startup keeps a deeper runway when quality can switch", () => {
  assert.equal(
    resolveAdaptiveLiveStartupBufferSeconds({
      backgroundPlayEnabled: false,
      variantCount: 5,
      configuredLiveSyncDuration: 12
    }),
    8
  );
  assert.equal(
    resolveAdaptiveLiveStartupBufferSeconds({
      backgroundPlayEnabled: false,
      variantCount: 1,
      configuredLiveSyncDuration: 12
    }),
    4
  );
  assert.equal(
    resolveAdaptiveLiveStartupBufferSeconds({
      backgroundPlayEnabled: true,
      variantCount: 1,
      configuredLiveSyncDuration: 3
    }),
    8
  );
});

test("a contiguous startup buffer is rejected when it trails the moving live point", () => {
  assert.equal(isBufferedLiveStartupRangeCurrent({ start: 0, end: 8 }, 28, 2), false);
  assert.equal(isBufferedLiveStartupRangeCurrent({ start: 20, end: 30 }, 28, 2), true);
  assert.equal(isBufferedLiveStartupRangeCurrent({ start: 20, end: 26.1 }, 28, 2), true);
  assert.equal(isBufferedLiveStartupRangeCurrent({ start: 20, end: 25.9 }, 28, 2), false);
  assert.equal(isBufferedLiveStartupRangeCurrent({ start: 0, end: 8 }, null, 2), true);
});

test("selects the live position only when media is already buffered there", () => {
  const ranges = [
    { start: 10, end: 12 },
    { start: 20, end: 24 }
  ];

  assert.equal(findBufferedLiveSyncTarget(ranges, 22), 22);
  assert.equal(findBufferedLiveSyncTarget(ranges, 22, 2), 22);
  assert.equal(findBufferedLiveSyncTarget(ranges, 22.5, 2), null);
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
  assert.equal(findBufferedLiveStartupTarget([{ start: 10, end: 10.4 }], null, 0.5), 10.1);
  assert.equal(findBufferedLiveStartupTarget([], 12, 0.5), null);
});

test("rejects a stale live sync point before low-latency playback starts", () => {
  const ranges = [{ start: 34.837, end: 43.178 }];

  assert.equal(findBufferedLiveStartupTarget(ranges, 35.067, 0.5, 2.5), 40.678);
  assert.equal(findBufferedLiveStartupTarget(ranges, 41.428, 0.5, 2.5), 41.428);
  assert.equal(findBufferedLiveStartupTarget(ranges, 42.95, 0.5, 2.5), 40.678);
});

test("uses the oldest safe point when the requested startup reserve fills the range", () => {
  const ranges = [{ start: 20, end: 32 }];

  assert.equal(findBufferedLiveStartupTarget(ranges, 30, 12, 12), 20.1);
  assert.equal(findBufferedLiveStartupTarget(ranges, null, 12, 12), 20.1);
});

test("requires recurring media gaps inside the recovery window", () => {
  assert.equal(hasRepeatedMediaGaps([1_000], 20_000), false);
  assert.equal(hasRepeatedMediaGaps([1_000, 20_000], 20_000), true);
  assert.equal(hasRepeatedMediaGaps([1_000, 20_000], 40_001), false);
});
