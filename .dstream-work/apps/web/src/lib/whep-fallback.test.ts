import assert from "node:assert/strict";
import { test } from "node:test";
import { pickPlaybackMode } from "./whep-fallback";

test("pickPlaybackMode: skips WHEP when no endpoint", async () => {
  let called = 0;
  const res = await pickPlaybackMode({
    whepSrc: "",
    rtcSupported: true,
    preferLowLatency: true,
    tryWhep: async () => {
      called++;
      return true;
    }
  });

  assert.equal(called, 0);
  assert.deepEqual(res, { mode: "hls", attemptedWhep: false });
});

test("pickPlaybackMode: skips WHEP when RTC unsupported", async () => {
  let called = 0;
  const res = await pickPlaybackMode({
    whepSrc: "/api/whep/x/whep",
    rtcSupported: false,
    preferLowLatency: true,
    tryWhep: async () => {
      called++;
      return true;
    }
  });

  assert.equal(called, 0);
  assert.deepEqual(res, { mode: "hls", attemptedWhep: false });
});

test("pickPlaybackMode: uses WHEP when negotiation succeeds", async () => {
  const res = await pickPlaybackMode({
    whepSrc: "/api/whep/x/whep",
    rtcSupported: true,
    preferLowLatency: true,
    tryWhep: async () => true
  });

  assert.deepEqual(res, { mode: "whep", attemptedWhep: true });
});

test("pickPlaybackMode: falls back to HLS when negotiation fails", async () => {
  const res = await pickPlaybackMode({
    whepSrc: "/api/whep/x/whep",
    rtcSupported: true,
    preferLowLatency: true,
    tryWhep: async () => false
  });

  assert.deepEqual(res, { mode: "hls", attemptedWhep: true });
});

test("pickPlaybackMode: skips WHEP in stability mode", async () => {
  let called = 0;
  const res = await pickPlaybackMode({
    whepSrc: "/api/whep/x/whep",
    rtcSupported: true,
    preferLowLatency: false,
    tryWhep: async () => {
      called++;
      return true;
    }
  });

  assert.equal(called, 0);
  assert.deepEqual(res, { mode: "hls", attemptedWhep: false });
});
