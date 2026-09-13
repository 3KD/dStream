import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPlaybackStartupElapsed,
  isEvidenceBackedZapAudioFallbackReason,
  playbackRecoveryOverlayDelayMs,
  resolvePlaybackStartupPresentation
} from "./playbackStartup";

test("Zap startup delay alone does not justify dropping source video", () => {
  assert.equal(isEvidenceBackedZapAudioFallbackReason("video-startup-timeout"), false);
  assert.equal(isEvidenceBackedZapAudioFallbackReason("repeated-video-buffer-gap"), true);
  assert.equal(isEvidenceBackedZapAudioFallbackReason("video-fragment-invalid"), true);
  assert.equal(isEvidenceBackedZapAudioFallbackReason("video-decoder-recovery-exhausted"), true);
});

test("startup presentation reports an indeterminate source connection", () => {
  assert.deepEqual(
    resolvePlaybackStartupPresentation({
      status: "Loading...",
      isLiveStream: true,
      hasPlaybackStarted: false,
      bufferedSeconds: 0,
      targetSeconds: 0,
      elapsedMs: 2_400
    }),
    {
      stage: "connecting",
      title: "Connecting to the live stream",
      detail: "Locating the current media window.",
      elapsedLabel: "2s elapsed",
      progressPercent: null,
      slowMessage: null
    }
  );
});

test("startup presentation exposes real buffer progress", () => {
  assert.deepEqual(
    resolvePlaybackStartupPresentation({
      status: "Buffering...",
      isLiveStream: true,
      hasPlaybackStarted: false,
      bufferedSeconds: 2,
      targetSeconds: 4,
      elapsedMs: 9_100
    }),
    {
      stage: "buffering",
      title: "Preparing smooth playback",
      detail: "2.0 of 4.0 seconds ready",
      elapsedLabel: "9s elapsed",
      progressPercent: 50,
      slowMessage: "The source is responding slowly. Retrying automatically."
    }
  );
});

test("a full startup buffer advances the presentation to starting", () => {
  const presentation = resolvePlaybackStartupPresentation({
    status: "Buffering...",
    isLiveStream: true,
    hasPlaybackStarted: false,
    bufferedSeconds: 7.5,
    targetSeconds: 4,
    elapsedMs: 1_000
  });
  assert.equal(presentation?.stage, "starting");
  assert.equal(presentation?.title, "Starting playback");
  assert.equal(presentation?.progressPercent, 100);
  assert.equal(presentation?.detail, "7.5 seconds buffered and ready.");
});

test("a post-start wait is presented as recovery rather than startup", () => {
  assert.deepEqual(
    resolvePlaybackStartupPresentation({
      status: "Buffering...",
      isLiveStream: true,
      hasPlaybackStarted: true,
      bufferedSeconds: 8,
      targetSeconds: 4,
      elapsedMs: 20_000
    }),
    {
      stage: "recovering",
      title: "Restoring live playback",
      detail: "Waiting for fresh media from the source.",
      elapsedLabel: "20s elapsed",
      progressPercent: null,
      slowMessage: null
    }
  );
});

test("audio fallback describes the transition without blaming the source", () => {
  const presentation = resolvePlaybackStartupPresentation({
    status: "Switching to audio...",
    isLiveStream: true,
    hasPlaybackStarted: false,
    bufferedSeconds: 0,
    targetSeconds: 0,
    elapsedMs: 4_000
  });
  assert.equal(presentation?.stage, "switching");
  assert.equal(presentation?.title, "Continuing with audio");
  assert.equal(presentation?.detail, "Video playback could not continue. Loading the source audio track.");
});

test("terminal and user-controlled states do not produce a loading overlay", () => {
  for (const status of ["Playing", "Paused", "Click to play", "Error"]) {
    assert.equal(
      resolvePlaybackStartupPresentation({
        status,
        isLiveStream: true,
        hasPlaybackStarted: false,
        bufferedSeconds: 0,
        targetSeconds: 0,
        elapsedMs: 0
      }),
      null
    );
  }
});

test("brief playback waits are delayed while explicit recovery is immediate", () => {
  assert.equal(playbackRecoveryOverlayDelayMs("Buffering..."), 700);
  assert.equal(playbackRecoveryOverlayDelayMs("Reconnecting..."), 0);
  assert.equal(playbackRecoveryOverlayDelayMs("Playing"), null);
  assert.equal(formatPlaybackStartupElapsed(Number.NaN), "0s elapsed");
});
