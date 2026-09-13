export type PlaybackStartupStage = "connecting" | "buffering" | "starting" | "switching" | "recovering";

export interface PlaybackStartupPresentation {
  stage: PlaybackStartupStage;
  title: string;
  detail: string;
  elapsedLabel: string;
  progressPercent: number | null;
  slowMessage: string | null;
}

export interface PlaybackStartupPresentationInput {
  status: string;
  isLiveStream: boolean;
  hasPlaybackStarted: boolean;
  bufferedSeconds: number;
  targetSeconds: number;
  elapsedMs: number;
}

export function isEvidenceBackedZapAudioFallbackReason(reason: string): boolean {
  return (
    reason === "playlist-timing-corrected" ||
    reason === "repeated-video-buffer-gap" ||
    reason === "video-fragment-invalid" ||
    reason === "remembered-video-instability" ||
    reason === "video-decoder-recovery-exhausted" ||
    reason === "video-decoder-recovery-failed"
  );
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function formatPlaybackStartupElapsed(elapsedMs: number): string {
  const seconds = Math.floor(finiteNonNegative(elapsedMs) / 1_000);
  return `${seconds}s elapsed`;
}

export function playbackRecoveryOverlayDelayMs(status: string): number | null {
  const normalized = status.trim().toLowerCase();
  if (normalized.includes("buffer")) return 700;
  if (
    normalized.includes("recover") ||
    normalized.includes("reconnect") ||
    normalized.includes("switch") ||
    normalized.includes("loading video")
  ) return 0;
  return null;
}

export function resolvePlaybackStartupPresentation({
  status,
  isLiveStream,
  hasPlaybackStarted,
  bufferedSeconds,
  targetSeconds,
  elapsedMs
}: PlaybackStartupPresentationInput): PlaybackStartupPresentation | null {
  const normalized = status.trim().toLowerCase();
  if (
    !normalized ||
    normalized.includes("playing") ||
    normalized.includes("paused") ||
    normalized.includes("click to play") ||
    normalized.includes("error")
  ) {
    return null;
  }

  const buffered = finiteNonNegative(bufferedSeconds);
  const target = finiteNonNegative(targetSeconds);
  const elapsed = finiteNonNegative(elapsedMs);
  const elapsedLabel = formatPlaybackStartupElapsed(elapsed);
  const slowMessage =
    elapsed >= 8_000 && !hasPlaybackStarted
      ? "The source is responding slowly. Retrying automatically."
      : null;

  if (normalized.includes("switching to audio")) {
    return {
      stage: "switching",
      title: "Continuing with audio",
      detail: "Video playback could not continue. Loading the source audio track.",
      elapsedLabel,
      progressPercent: null,
      slowMessage
    };
  }

  if (normalized.includes("switching to hls")) {
    return {
      stage: "switching",
      title: "Switching playback path",
      detail: "The low-latency connection was unstable. Loading the buffered stream.",
      elapsedLabel,
      progressPercent: null,
      slowMessage
    };
  }

  if (normalized.includes("recover") || normalized.includes("reconnect")) {
    return {
      stage: "recovering",
      title: isLiveStream ? "Reconnecting to the live stream" : "Restoring playback",
      detail: "Holding the current position while fresh media arrives.",
      elapsedLabel,
      progressPercent: null,
      slowMessage: null
    };
  }

  if (normalized.includes("buffer")) {
    if (hasPlaybackStarted) {
      return {
        stage: "recovering",
        title: isLiveStream ? "Restoring live playback" : "Restoring playback",
        detail: "Waiting for fresh media from the source.",
        elapsedLabel,
        progressPercent: null,
        slowMessage: null
      };
    }

    if (target > 0 && buffered >= target) {
      return {
        stage: "starting",
        title: "Starting playback",
        detail: `${buffered.toFixed(1)} seconds buffered and ready.`,
        elapsedLabel,
        progressPercent: 100,
        slowMessage
      };
    }

    const progressPercent = target > 0 ? Math.max(0, Math.min(100, (buffered / target) * 100)) : null;
    return {
      stage: "buffering",
      title: "Preparing smooth playback",
      detail:
        target > 0
          ? `${Math.min(buffered, target).toFixed(1)} of ${target.toFixed(1)} seconds ready`
          : "Receiving the first playable media.",
      elapsedLabel,
      progressPercent,
      slowMessage
    };
  }

  if (normalized.includes("ready") || normalized.includes("starting")) {
    return {
      stage: "starting",
      title: "Starting playback",
      detail: buffered > 0 ? `${buffered.toFixed(1)} seconds buffered and ready.` : "Playback will begin automatically.",
      elapsedLabel,
      progressPercent: 100,
      slowMessage
    };
  }

  return {
    stage: "connecting",
    title: normalized.includes("loading video")
      ? "Loading source video"
      : isLiveStream
        ? "Connecting to the live stream"
        : "Loading video",
    detail: isLiveStream ? "Locating the current media window." : "Opening the media source.",
    elapsedLabel,
    progressPercent: null,
    slowMessage
  };
}
