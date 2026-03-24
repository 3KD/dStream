import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { listVodAnalyticsSummary, recordVodAnalyticsHeartbeat } from "./vodAnalytics";

const hostPubkey = "c".repeat(64);
const streamId = "vod-analytics-test";
const originStreamId = `${hostPubkey}--${streamId}`;

function setup(): { cleanup: () => void } {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dstream-vod-analytics-"));
  process.env.DSTREAM_VOD_ANALYTICS_STORE_PATH = path.join(tmpDir, "vod-analytics.json");
  return {
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true })
  };
}

test("vod analytics: records heartbeat totals and unique viewers", () => {
  const { cleanup } = setup();
  try {
    const first = recordVodAnalyticsHeartbeat({
      originStreamId,
      relativePath: "season-1/episode-1.mp4",
      viewerId: "viewer-a",
      elapsedSec: 15,
      currentTimeSec: 20,
      playbackMode: "vod"
    });
    assert.equal(first.heartbeatCount, 1);
    assert.equal(first.totalWatchSec, 15);
    assert.equal(first.uniqueViewerCount, 1);

    const second = recordVodAnalyticsHeartbeat({
      originStreamId,
      relativePath: "season-1/episode-1.mp4",
      viewerId: "viewer-b",
      elapsedSec: 25,
      currentTimeSec: 45,
      playbackMode: "vod"
    });
    assert.equal(second.heartbeatCount, 2);
    assert.equal(second.totalWatchSec, 40);
    assert.equal(second.uniqueViewerCount, 2);

    const summary = listVodAnalyticsSummary({ originStreamId });
    assert.equal(summary.length, 1);
    assert.equal(summary[0]?.relativePath, "season-1/episode-1.mp4");
    assert.equal(summary[0]?.totalWatchSec, 40);
    assert.equal(summary[0]?.uniqueViewerCount, 2);
    assert.equal(summary[0]?.lastCurrentTimeSec, 45);
  } finally {
    cleanup();
  }
});

