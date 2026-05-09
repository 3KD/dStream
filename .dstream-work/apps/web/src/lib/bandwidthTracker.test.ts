import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addBandwidthUsageBytes,
  DEFAULT_BANDWIDTH_LIMIT_BYTES,
  DEFAULT_BANDWIDTH_WINDOW_MS,
  getBandwidthUsageBytes,
  ipBandwidthCache,
  shouldApplyHlsBandwidthLimit
} from "./bandwidthTracker";

test("HLS bandwidth wall applies only to direct non-app playback", () => {
  const previousLimit = process.env.DSTREAM_HLS_BANDWIDTH_LIMIT_BYTES;
  process.env.DSTREAM_HLS_BANDWIDTH_LIMIT_BYTES = String(DEFAULT_BANDWIDTH_LIMIT_BYTES);

  try {
    assert.equal(
      shouldApplyHlsBandwidthLimit({
        requestOrigin: "https://dstream.example",
        referer: "https://dstream.example/watch/npub/stream",
        origin: null,
        secFetchSite: "same-origin",
        accessToken: null
      }),
      false
    );

    assert.equal(
      shouldApplyHlsBandwidthLimit({
        requestOrigin: "https://dstream.example",
        referer: null,
        origin: null,
        secFetchSite: null,
        accessToken: null
      }),
      true
    );

    assert.equal(
      shouldApplyHlsBandwidthLimit({
        requestOrigin: "https://dstream.example",
        referer: null,
        origin: null,
        secFetchSite: null,
        accessToken: "signed-access-token"
      }),
      false
    );
  } finally {
    if (previousLimit === undefined) delete process.env.DSTREAM_HLS_BANDWIDTH_LIMIT_BYTES;
    else process.env.DSTREAM_HLS_BANDWIDTH_LIMIT_BYTES = previousLimit;
  }
});

test("HLS bandwidth usage resets after the rolling window", () => {
  const previousWindow = process.env.DSTREAM_HLS_BANDWIDTH_WINDOW_MS;
  process.env.DSTREAM_HLS_BANDWIDTH_WINDOW_MS = String(DEFAULT_BANDWIDTH_WINDOW_MS);

  try {
    ipBandwidthCache.clear();
    const clientKey = "test-client";
    const start = 1_000_000;
    addBandwidthUsageBytes(clientKey, 123, start);
    addBandwidthUsageBytes(clientKey, 77, start + 10);
    assert.equal(getBandwidthUsageBytes(clientKey, start + 20), 200);

    assert.equal(getBandwidthUsageBytes(clientKey, start + 60 * 60 * 1000 + 1), 0);
  } finally {
    if (previousWindow === undefined) delete process.env.DSTREAM_HLS_BANDWIDTH_WINDOW_MS;
    else process.env.DSTREAM_HLS_BANDWIDTH_WINDOW_MS = previousWindow;
  }
});
