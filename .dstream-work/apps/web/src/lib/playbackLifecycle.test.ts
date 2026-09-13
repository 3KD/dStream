import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveBackgroundPlaybackDecision,
  resolveGlobalPlayerHostPlacement,
  resolveLivePlaybackRecoveryDecision,
  shouldCheckBackgroundPlaybackProgress,
  shouldQueueQuickPlayHandoff,
  shouldResetInactiveSession
} from "./playbackLifecycle";

test("background lifecycle resumes hidden playback but never overrides an explicit pause", () => {
  assert.deepEqual(
    resolveBackgroundPlaybackDecision({
      backgroundPlayEnabled: true,
      documentHidden: true,
      ended: false,
      startupGatePending: false,
      userPaused: false,
      mediaMarkedUserPaused: false
    }),
    { shouldRememberRequest: true, shouldCallPlay: true }
  );

  assert.deepEqual(
    resolveBackgroundPlaybackDecision({
      backgroundPlayEnabled: true,
      documentHidden: true,
      allowVisibleResume: true,
      ended: false,
      startupGatePending: false,
      userPaused: true,
      mediaMarkedUserPaused: false
    }),
    { shouldRememberRequest: false, shouldCallPlay: false }
  );
});

test("background lifecycle defers while the live startup gate is pending", () => {
  assert.deepEqual(
    resolveBackgroundPlaybackDecision({
      backgroundPlayEnabled: true,
      documentHidden: true,
      ended: false,
      startupGatePending: true,
      userPaused: false,
      mediaMarkedUserPaused: false
    }),
    { shouldRememberRequest: true, shouldCallPlay: false }
  );

  assert.deepEqual(
    resolveBackgroundPlaybackDecision({
      backgroundPlayEnabled: true,
      documentHidden: false,
      allowVisibleResume: true,
      ended: false,
      startupGatePending: false,
      userPaused: false,
      mediaMarkedUserPaused: false
    }),
    { shouldRememberRequest: true, shouldCallPlay: true }
  );
});

test("background progress checks are scoped to lock and page lifecycle transitions", () => {
  assert.equal(
    shouldCheckBackgroundPlaybackProgress({
      documentHidden: false,
      pageLifecycleHidden: false,
      ended: false,
      userPaused: false,
      mediaMarkedUserPaused: false
    }),
    false
  );
  assert.equal(
    shouldCheckBackgroundPlaybackProgress({
      documentHidden: false,
      pageLifecycleHidden: true,
      ended: false,
      userPaused: false,
      mediaMarkedUserPaused: false
    }),
    true
  );
  assert.equal(
    shouldCheckBackgroundPlaybackProgress({
      documentHidden: true,
      pageLifecycleHidden: true,
      ended: false,
      userPaused: false,
      mediaMarkedUserPaused: true
    }),
    false
  );
});

test("live recovery restarts loading after background network starvation", () => {
  assert.deepEqual(
    resolveLivePlaybackRecoveryDecision({
      isLiveStream: true,
      needsClick: false,
      userPaused: false,
      mediaMarkedUserPaused: false,
      ended: false,
      hidden: true,
      hasObservedPlaybackProgress: true,
      stalledForMs: 7_000,
      bufferAheadSeconds: 0,
      readyState: 2,
      mediaFeedStale: false,
      bufferedDecoderFrozen: false,
      canAttemptInSessionRecovery: true
    }),
    { action: "recover-in-session", reason: "buffer-starved" }
  );
});

test("live recovery avoids hidden session rebuilds after in-session recovery is exhausted", () => {
  const hiddenDecision = resolveLivePlaybackRecoveryDecision({
    isLiveStream: true,
    needsClick: false,
    userPaused: false,
    mediaMarkedUserPaused: false,
    ended: false,
    hidden: true,
    hasObservedPlaybackProgress: true,
    stalledForMs: 35_000,
    bufferAheadSeconds: 1,
    readyState: 4,
    mediaFeedStale: true,
    bufferedDecoderFrozen: true,
    canAttemptInSessionRecovery: false
  });
  assert.deepEqual(hiddenDecision, { action: "none", reason: null });

  const visibleDecision = resolveLivePlaybackRecoveryDecision({
    ...hiddenDecisionInput(),
    hidden: false,
    stalledForMs: 25_000,
    canAttemptInSessionRecovery: false
  });
  assert.deepEqual(visibleDecision, { action: "reload-session", reason: "stalled" });
});

test("quickplay handoff can queue after first media start before full playback stability", () => {
  const input = {
    hasPlaybackStarted: true,
    streamPubkey: "streamer",
    streamId: "live-now",
    playbackUrl: "https://cdn.example/live.m3u8",
    urlIsPlayable: true,
    privateAccessRequired: false,
    accessToken: null,
    viewerPubkey: "viewer"
  };

  assert.equal(shouldQueueQuickPlayHandoff(input), true);
  assert.equal(shouldQueueQuickPlayHandoff({ ...input, hasPlaybackStarted: false }), false);
});

test("quickplay handoff rejects self-view, invalid URLs, and locked private streams", () => {
  const input = {
    hasPlaybackStarted: true,
    streamPubkey: "streamer",
    streamId: "live-now",
    playbackUrl: "https://cdn.example/live.m3u8",
    urlIsPlayable: true,
    privateAccessRequired: false,
    accessToken: null,
    viewerPubkey: "viewer"
  };

  assert.equal(shouldQueueQuickPlayHandoff({ ...input, viewerPubkey: "streamer" }), false);
  assert.equal(shouldQueueQuickPlayHandoff({ ...input, urlIsPlayable: false }), false);
  assert.equal(
    shouldQueueQuickPlayHandoff({ ...input, privateAccessRequired: true, accessToken: null }),
    false
  );
});

test("global player host follows the visible slot and parks offscreen otherwise", () => {
  assert.deepEqual(
    resolveGlobalPlayerHostPlacement({
      active: true,
      slotId: "quickplay-dock",
      targetConnected: true,
      targetRect: { left: 12, top: 34, width: 0, height: 180 },
      targetPointerEvents: "auto"
    }),
    {
      left: "12px",
      top: "34px",
      width: "1px",
      height: "180px",
      zIndex: "9999",
      pointerEvents: "auto"
    }
  );

  assert.deepEqual(
    resolveGlobalPlayerHostPlacement({
      active: false,
      slotId: "watch-player",
      targetConnected: false,
      targetRect: null,
      targetPointerEvents: null
    }),
    {
      left: "-10000px",
      top: "0px",
      width: "1px",
      height: "1px",
      zIndex: "1",
      pointerEvents: "none"
    }
  );
});

test("inactivity reset never fires while playback is active", () => {
  const base = {
    nowMs: 26 * 60 * 1000,
    lastVisitAtMs: 60 * 1000,
    inactivityMs: 20 * 60 * 1000,
    playbackActive: false,
    mediaPlaybackActive: false,
    redirecting: false
  };

  assert.equal(shouldResetInactiveSession(base), true);
  assert.equal(shouldResetInactiveSession({ ...base, playbackActive: true }), false);
  assert.equal(shouldResetInactiveSession({ ...base, mediaPlaybackActive: true }), false);
  assert.equal(shouldResetInactiveSession({ ...base, redirecting: true }), false);
});

function hiddenDecisionInput() {
  return {
    isLiveStream: true,
    needsClick: false,
    userPaused: false,
    mediaMarkedUserPaused: false,
    ended: false,
    hidden: true,
    hasObservedPlaybackProgress: true,
    stalledForMs: 35_000,
    bufferAheadSeconds: 1,
    readyState: 4,
    mediaFeedStale: true,
    bufferedDecoderFrozen: true,
    canAttemptInSessionRecovery: true
  };
}
