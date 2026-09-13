export interface BackgroundPlaybackDecisionInput {
  backgroundPlayEnabled: boolean;
  documentHidden: boolean;
  allowVisibleResume?: boolean;
  ended: boolean;
  startupGatePending: boolean;
  userPaused: boolean;
  mediaMarkedUserPaused: boolean;
}

export interface BackgroundPlaybackDecision {
  shouldRememberRequest: boolean;
  shouldCallPlay: boolean;
}

export function resolveBackgroundPlaybackDecision(input: BackgroundPlaybackDecisionInput): BackgroundPlaybackDecision {
  if (!input.backgroundPlayEnabled) return { shouldRememberRequest: false, shouldCallPlay: false };
  if (input.ended) return { shouldRememberRequest: false, shouldCallPlay: false };
  if (input.userPaused || input.mediaMarkedUserPaused) return { shouldRememberRequest: false, shouldCallPlay: false };
  if (!input.allowVisibleResume && !input.documentHidden) {
    return { shouldRememberRequest: false, shouldCallPlay: false };
  }
  if (input.startupGatePending) return { shouldRememberRequest: true, shouldCallPlay: false };
  return { shouldRememberRequest: true, shouldCallPlay: true };
}

export interface BackgroundProgressCheckInput {
  documentHidden: boolean;
  pageLifecycleHidden: boolean;
  ended: boolean;
  userPaused: boolean;
  mediaMarkedUserPaused: boolean;
}

export function shouldCheckBackgroundPlaybackProgress(input: BackgroundProgressCheckInput): boolean {
  if (!input.documentHidden && !input.pageLifecycleHidden) return false;
  if (input.ended) return false;
  return !input.userPaused && !input.mediaMarkedUserPaused;
}

export type LivePlaybackRecoveryReason = "buffer-starved" | "ended" | "stalled";
export type LivePlaybackRecoveryAction = "none" | "recover-in-session" | "reload-session";

export interface LivePlaybackRecoveryDecision {
  action: LivePlaybackRecoveryAction;
  reason: LivePlaybackRecoveryReason | null;
}

export interface LivePlaybackRecoveryInput {
  isLiveStream: boolean;
  needsClick: boolean;
  userPaused: boolean;
  mediaMarkedUserPaused: boolean;
  ended: boolean;
  hidden: boolean;
  hasObservedPlaybackProgress: boolean;
  stalledForMs: number;
  bufferAheadSeconds: number;
  readyState: number;
  mediaFeedStale: boolean;
  bufferedDecoderFrozen: boolean;
  canAttemptInSessionRecovery: boolean;
}

const BUFFER_STARVATION_RECOVERY_THRESHOLD_MS = 6_000;

function livePlaybackStallThresholdMs(hasObservedPlaybackProgress: boolean, hidden: boolean): number {
  if (!hasObservedPlaybackProgress) return hidden ? 45_000 : 35_000;
  return hidden ? 30_000 : 20_000;
}

export function resolveLivePlaybackRecoveryDecision(input: LivePlaybackRecoveryInput): LivePlaybackRecoveryDecision {
  if (!input.isLiveStream) return { action: "none", reason: null };
  if (input.needsClick || input.userPaused || input.mediaMarkedUserPaused) {
    return { action: "none", reason: null };
  }
  if (input.ended) return { action: "reload-session", reason: "ended" };

  const stalledForMs = Number.isFinite(input.stalledForMs) ? Math.max(0, input.stalledForMs) : 0;
  const bufferAheadSeconds = Number.isFinite(input.bufferAheadSeconds)
    ? Math.max(0, input.bufferAheadSeconds)
    : 0;

  const bufferStarved =
    input.hasObservedPlaybackProgress &&
    stalledForMs >= BUFFER_STARVATION_RECOVERY_THRESHOLD_MS &&
    bufferAheadSeconds < 0.25 &&
    input.readyState <= 2;
  if (bufferStarved && input.canAttemptInSessionRecovery) {
    return { action: "recover-in-session", reason: "buffer-starved" };
  }

  const stallThresholdMs = livePlaybackStallThresholdMs(input.hasObservedPlaybackProgress, input.hidden);
  if (stalledForMs < stallThresholdMs) return { action: "none", reason: null };
  if (!input.mediaFeedStale && !input.bufferedDecoderFrozen) return { action: "none", reason: null };
  if (input.canAttemptInSessionRecovery) return { action: "recover-in-session", reason: "stalled" };
  if (input.hidden) return { action: "none", reason: null };
  return { action: "reload-session", reason: "stalled" };
}

export interface QuickPlayHandoffInput {
  hasPlaybackStarted: boolean;
  streamPubkey: string | null | undefined;
  streamId: string | null | undefined;
  playbackUrl: string;
  urlIsPlayable: boolean;
  privateAccessRequired: boolean;
  accessToken: string | null | undefined;
  viewerPubkey: string | null | undefined;
}

export function shouldQueueQuickPlayHandoff(input: QuickPlayHandoffInput): boolean {
  if (!input.hasPlaybackStarted) return false;
  if (!input.streamPubkey || !input.streamId) return false;
  if (!input.playbackUrl.trim() || !input.urlIsPlayable) return false;
  if (input.privateAccessRequired && !input.accessToken) return false;
  return input.viewerPubkey !== input.streamPubkey;
}

export interface GlobalPlayerHostPlacementInput {
  active: boolean;
  slotId: string | null | undefined;
  targetConnected: boolean;
  targetRect: Pick<DOMRect, "left" | "top" | "width" | "height"> | null;
  targetPointerEvents: string | null | undefined;
}

export interface GlobalPlayerHostPlacement {
  left: string;
  top: string;
  width: string;
  height: string;
  zIndex: string;
  pointerEvents: string;
}

export function resolveGlobalPlayerHostPlacement(input: GlobalPlayerHostPlacementInput): GlobalPlayerHostPlacement {
  if (!input.active || !input.targetConnected || !input.targetRect) {
    return {
      left: "-10000px",
      top: "0px",
      width: "1px",
      height: "1px",
      zIndex: "1",
      pointerEvents: "none"
    };
  }

  return {
    left: `${input.targetRect.left}px`,
    top: `${input.targetRect.top}px`,
    width: `${Math.max(1, input.targetRect.width)}px`,
    height: `${Math.max(1, input.targetRect.height)}px`,
    zIndex: input.slotId === "quickplay-dock" ? "9999" : "1",
    pointerEvents: input.targetPointerEvents?.trim() || "auto"
  };
}

export interface InactivityResetInput {
  nowMs: number;
  lastVisitAtMs: number | null;
  inactivityMs: number;
  playbackActive: boolean;
  mediaPlaybackActive: boolean;
  redirecting: boolean;
}

export function shouldResetInactiveSession(input: InactivityResetInput): boolean {
  if (input.playbackActive || input.mediaPlaybackActive || input.redirecting) return false;
  if (typeof input.lastVisitAtMs !== "number" || !Number.isFinite(input.lastVisitAtMs)) return false;
  return input.nowMs - input.lastVisitAtMs >= input.inactivityMs;
}
