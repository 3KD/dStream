"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Hls from "hls.js";
import { P2PFragmentLoader } from "@/lib/p2p/hlsFragmentLoader";
import { MonotonicPlaylistLoader } from "@/lib/hls/monotonicPlaylistLoader";
import {
  readBackgroundPlayPreference,
  subscribeBackgroundPlayPreference,
  writeBackgroundPlayPreference
} from "@/lib/backgroundPlayback";
import type { P2PSwarm } from "@/lib/p2p/swarm";
import type { IntegritySession } from "@/lib/integrity/session";
import { WhepClient } from "@/lib/whep";
import { pickPlaybackMode } from "@/lib/whep-fallback";
import { inferMediaUrlKind } from "@/lib/mediaUrl";
import { Gauge, Headphones, Maximize, Minimize, Pause, PictureInPicture2, Play, Users, Volume2, VolumeX } from "lucide-react";

interface PlayerProps {
  src: string;
  fallbackSrc?: string | null;
  whepSrc?: string | null;
  p2pSwarm?: P2PSwarm | null;
  integrity?: IntegritySession | null;
  onReady?: () => void;
  autoplayMuted?: boolean;
  isLiveStream?: boolean;
  showTimelineControls?: boolean;
  showAuxControls?: boolean;
  showNativeControls?: boolean;
  playbackStateKey?: string;
  layoutMode?: "aspect" | "fill";
  overlayTitle?: string | null;
  backgroundPlayEnabledOverride?: boolean;
  auxMetaSlot?: ReactNode;
  contentWarningReason?: string | null;
  captionTracks?: Array<{
    src: string;
    lang: string;
    label: string;
    isDefault?: boolean;
  }>;
  viewerCount?: number;
  p2pPeers?: number;
}

interface QualityOption {
  value: number;
  label: string;
}

interface PersistedPlaybackState {
  volume?: number;
  muted?: boolean;
  currentTime?: number;
  updatedAt?: number;
}

interface LiveHlsActivity {
  lastFragBufferedAt: number;
  lastFragChangedAt: number;
  lastLevelUpdatedAt: number;
}

type PlaybackMode = "hls" | "whep" | "direct";
type WebKitPresentationMode = "inline" | "picture-in-picture" | "fullscreen";
type PictureInPictureVideo = HTMLVideoElement & {
  disablePictureInPicture?: boolean;
  requestPictureInPicture?: () => Promise<void>;
  webkitSetPresentationMode?: (mode: WebKitPresentationMode) => void;
  webkitPresentationMode?: WebKitPresentationMode;
};
type PictureInPictureDocument = Document & {
  pictureInPictureElement?: Element | null;
  pictureInPictureEnabled?: boolean;
  exitPictureInPicture?: () => Promise<void>;
};
type AudioSessionLike = {
  type?: string;
};

const MOBILE_CONTROLS_HIDE_MS = 5_000;
const LIVE_EDGE_SCRUB_TOLERANCE_SEC = 2;

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function readPersistedPlaybackState(storageKey: string | undefined): PersistedPlaybackState | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPlaybackState | null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedPlaybackState(storageKey: string | undefined, next: PersistedPlaybackState): void {
  if (!storageKey || typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function readBufferedAheadSeconds(video: HTMLVideoElement): number {
  try {
    const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    for (let index = 0; index < video.buffered.length; index++) {
      const start = video.buffered.start(index);
      const end = video.buffered.end(index);
      if (current >= start - 0.05 && current <= end + 0.05) return Math.max(0, end - current);
    }
  } catch {
    // ignore
  }
  return 0;
}

function readVideoFrameCount(video: HTMLVideoElement): number | null {
  try {
    const quality = video.getVideoPlaybackQuality?.();
    const frames = quality?.totalVideoFrames;
    return typeof frames === "number" && Number.isFinite(frames) ? frames : null;
  } catch {
    return null;
  }
}

function isLikelyMobilePlaybackDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) return true;
  if (typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 0) return true;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(pointer: coarse)").matches) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

function isLikelyIosPlaybackDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS can identify as desktop Safari while still using iOS media APIs.
  if (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1) return true;
  return false;
}

function isLikelySafariBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  if (!/Safari/i.test(ua)) return false;
  if (/Chrome|Chromium|CriOS|FxiOS|Firefox|Edg|OPR|SamsungBrowser|Android/i.test(ua)) return false;
  return true;
}

function isLikelyFirefoxBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Firefox\//i.test(navigator.userAgent ?? "");
}

function shouldPreferNativeHlsPlayback(): boolean {
  return isLikelySafariBrowser() || isLikelyIosPlaybackDevice();
}

function configureAudioSessionForPlayback(): void {
  if (typeof navigator === "undefined") return;
  const audioSession = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
  if (!audioSession) return;
  try {
    audioSession.type = "playback";
  } catch {
    // ignore unsupported or read-only implementations
  }
}

function isExternalPlaybackUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isZapStreamHlsUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "zap.stream" || hostname.endsWith(".zap.stream");
  } catch {
    return false;
  }
}

function formatQualityLabel(level: { width?: number; height?: number; bitrate?: number }): string {
  const height = typeof level.height === "number" && level.height > 0 ? `${level.height}p` : null;
  const bitrate =
    typeof level.bitrate === "number" && level.bitrate > 0 ? `${Math.max(1, Math.round(level.bitrate / 1000))} kbps` : null;
  if (height && bitrate) return `${height} (${bitrate})`;
  if (height) return height;
  if (bitrate) return bitrate;
  return "Unknown";
}

function formatPlaybackTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

type HlsPlaybackTuningOptions = {
  lowLatencyEnabled: boolean;
  backgroundPlayEnabled: boolean;
  bridgeLiveGaps?: boolean;
};

function getHlsPlaybackTuning(options: HlsPlaybackTuningOptions) {
  const lowLatencyMode = options.lowLatencyEnabled;
  const stableLiveSyncDuration = options.backgroundPlayEnabled ? 30 : 24;
  return {
    lowLatencyMode,
    maxBufferLength: options.backgroundPlayEnabled ? 180 : lowLatencyMode ? 45 : 90,
    maxMaxBufferLength: options.backgroundPlayEnabled ? 240 : lowLatencyMode ? 90 : 120,
    backBufferLength: 60,
    liveSyncDurationCount: lowLatencyMode ? 4 : undefined,
    liveSyncDuration: lowLatencyMode ? undefined : stableLiveSyncDuration,
    liveMaxLatencyDurationCount: lowLatencyMode ? Number.POSITIVE_INFINITY : undefined,
    liveMaxLatencyDuration: lowLatencyMode ? undefined : Number.POSITIVE_INFINITY,
    liveSyncOnStallIncrease: 1,
    maxBufferHole: options.bridgeLiveGaps ? 2.5 : 0.1,
    detectStallWithCurrentTimeMs: options.bridgeLiveGaps ? 250 : 1_250,
    highBufferWatchdogPeriod: options.bridgeLiveGaps ? 0.25 : 2
  };
}

function applyHlsPlaybackTuning(hls: Hls, options: HlsPlaybackTuningOptions): void {
  const config = hls.config as any;
  Object.assign(config, getHlsPlaybackTuning(options));

  const backgroundCappingState = hls as Hls & {
    dstreamCappingBeforeBackground?: { autoLevel: number; capToPlayerSize: boolean };
  };
  if (options.backgroundPlayEnabled && hls.levels.length > 0) {
    if (backgroundCappingState.dstreamCappingBeforeBackground === undefined) {
      backgroundCappingState.dstreamCappingBeforeBackground = {
        autoLevel: hls.autoLevelCapping,
        capToPlayerSize: hls.capLevelToPlayerSize
      };
    }
    if (hls.capLevelToPlayerSize) hls.capLevelToPlayerSize = false;
    const lowestBitrateLevel = hls.levels.reduce(
      (lowest, level, index, levels) => (level.bitrate < levels[lowest].bitrate ? index : lowest),
      0
    );
    hls.autoLevelCapping = lowestBitrateLevel;
    if (hls.manualLevel === -1) hls.nextLoadLevel = lowestBitrateLevel;
    return;
  }
  if (backgroundCappingState.dstreamCappingBeforeBackground !== undefined) {
    const previous = backgroundCappingState.dstreamCappingBeforeBackground;
    hls.autoLevelCapping = previous.autoLevel;
    hls.capLevelToPlayerSize = previous.capToPlayerSize;
    delete backgroundCappingState.dstreamCappingBeforeBackground;
  }
}

export function Player({
  src,
  fallbackSrc,
  whepSrc,
  p2pSwarm,
  integrity,
  onReady,
  autoplayMuted,
  isLiveStream = true,
  showTimelineControls = true,
  showAuxControls = true,
  showNativeControls = true,
  playbackStateKey,
  layoutMode = "aspect",
  overlayTitle,
  backgroundPlayEnabledOverride,
  auxMetaSlot,
  captionTracks,
  contentWarningReason,
  viewerCount,
  p2pPeers
}: PlayerProps) {
  const normalizedSrc = (src ?? "").trim();
  const normalizedWhepSrc = (whepSrc ?? "").trim();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const whepRef = useRef<WhepClient | null>(null);
  const playbackModeRef = useRef<PlaybackMode>("hls");
  const onReadyRef = useRef(onReady);
  const selectedQualityRef = useRef(-1);
  const liveHlsActivityRef = useRef<LiveHlsActivity>({
    lastFragBufferedAt: 0,
    lastFragChangedAt: 0,
    lastLevelUpdatedAt: 0
  });
  const lastLivePlaybackRecoveryAtRef = useRef(0);

  const fallbackSrcRef = useRef(fallbackSrc);
  const playbackStateKeyRef = useRef(playbackStateKey);

  useEffect(() => {
    fallbackSrcRef.current = fallbackSrc;
  }, [fallbackSrc]);

  const dstreamRefs = useRef({ p2pSwarm, integrity });

  useEffect(() => {
    dstreamRefs.current = { p2pSwarm, integrity };
  }, [p2pSwarm, integrity]);

  useEffect(() => {
    playbackStateKeyRef.current = playbackStateKey;
  }, [playbackStateKey]);
  const [status, setStatus] = useState<string>("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [nsfwConsented, setNsfwConsented] = useState<boolean>(!contentWarningReason);
  const [needsClick, setNeedsClick] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("hls");
  const [note, setNote] = useState<string | null>(null);
  const [isMobilePlayback, setIsMobilePlayback] = useState(false);
  const [isFirefoxPlayback, setIsFirefoxPlayback] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [preferNativeHls, setPreferNativeHls] = useState(false);
  const [playbackEnvironmentReady, setPlaybackEnvironmentReady] = useState(false);
  const [playbackReloadNonce, setPlaybackReloadNonce] = useState(0);
  const playbackSessionGenerationRef = useRef(0);
  const requestLivePlaybackReload = useCallback((reason: string) => {
    const now = Date.now();
    if (now - lastLivePlaybackRecoveryAtRef.current < 8_000) return false;
    lastLivePlaybackRecoveryAtRef.current = now;
    setError(null);
    setNeedsClick(false);
    setStatus("Recovering…");
    setNote(reason);
    if (videoRef.current) videoRef.current.dataset.dstreamPlaybackRecoveryReason = reason;
    setPlaybackReloadNonce((value) => value + 1);
    return true;
  }, []);

  useEffect(() => {
    const firefox = isLikelyFirefoxBrowser();
    setIsMobilePlayback(isLikelyMobilePlaybackDevice());
    setIsFirefoxPlayback(firefox);
    setPreferNativeHls(shouldPreferNativeHlsPlayback());
    setLowLatencyEnabled(!firefox);
    setPlaybackEnvironmentReady(true);
  }, []);

  const [backgroundPlayEnabled, setBackgroundPlayEnabled] = useState(false);
  const [backgroundPlayPreferenceLoaded, setBackgroundPlayPreferenceLoaded] = useState(false);
  const effectiveBackgroundPlayEnabled = backgroundPlayEnabledOverride ?? backgroundPlayEnabled;
  const effectiveAutoplayMuted = effectiveBackgroundPlayEnabled ? false : isMobilePlayback ? true : (autoplayMuted ?? true);
  const playbackStartupPolicyReady =
    playbackEnvironmentReady && (backgroundPlayEnabledOverride !== undefined || backgroundPlayPreferenceLoaded);
  const [lowLatencyEnabled, setLowLatencyEnabled] = useState(true);
  const zapStreamCompatibilityMode = isZapStreamHlsUrl(normalizedSrc);
  const stableHlsCompatibilityMode = isFirefoxPlayback || zapStreamCompatibilityMode;
  const effectiveLowLatencyEnabled = lowLatencyEnabled && !stableHlsCompatibilityMode;
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([]);
  const [selectedQuality, setSelectedQuality] = useState(-1);
  const [qualityIndicator, setQualityIndicator] = useState("Auto");
  const [volume, setVolume] = useState(() => (effectiveAutoplayMuted ? 0 : 1));
  const desiredVolumeRef = useRef(volume);
  const lastAudibleVolumeRef = useRef(1);
  const userPausedPlaybackRef = useRef(false);
  const startupGatePendingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mobileControlsVisible, setMobileControlsVisible] = useState(false);
  const mobileControlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unmuteHintPhase, setUnmuteHintPhase] = useState<"hidden" | "visible" | "fading">("hidden");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [timelineStart, setTimelineStart] = useState(0);
  const [timelineEnd, setTimelineEnd] = useState(0);
  const [timelinePosition, setTimelinePosition] = useState(0);
  const [liveEdgePinned, setLiveEdgePinned] = useState(Boolean(isLiveStream));
  const captionTrackList = useMemo(() => {
    return (captionTracks ?? [])
      .map((track) => ({
        src: (track.src ?? "").trim(),
        lang: (track.lang ?? "").trim().toLowerCase(),
        label: (track.label ?? "").trim(),
        isDefault: !!track.isDefault
      }))
      .filter((track) => track.src && track.lang && track.label);
  }, [captionTracks]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const persisted = readPersistedPlaybackState(playbackStateKeyRef.current);
    if (persisted) {
      const persistedMuted = persisted.muted === true;
      const persistedVolume = clampUnit(typeof persisted.volume === "number" ? persisted.volume : 1);
      if (!effectiveBackgroundPlayEnabled && effectiveAutoplayMuted) {
        if (!persistedMuted && persistedVolume > 0) lastAudibleVolumeRef.current = persistedVolume;
        setVolume(0);
        return;
      }
      if (effectiveBackgroundPlayEnabled) {
        setVolume(persistedMuted ? 0 : Math.max(0.05, persistedVolume || 1));
        return;
      }
      setVolume(persistedMuted ? 0 : persistedVolume);
      return;
    }
    setVolume(effectiveAutoplayMuted ? 0 : 1);
  }, [effectiveAutoplayMuted, effectiveBackgroundPlayEnabled, playbackStateKey]);

  useEffect(() => {
    setBackgroundPlayEnabled(readBackgroundPlayPreference());
    setBackgroundPlayPreferenceLoaded(true);
    return subscribeBackgroundPlayPreference(setBackgroundPlayEnabled);
  }, []);

  useEffect(() => {
    selectedQualityRef.current = selectedQuality;
  }, [selectedQuality]);

  useEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);

  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    applyHlsPlaybackTuning(hls, {
      lowLatencyEnabled: effectiveLowLatencyEnabled,
      backgroundPlayEnabled: effectiveBackgroundPlayEnabled,
      bridgeLiveGaps: stableHlsCompatibilityMode
    });
  }, [effectiveBackgroundPlayEnabled, effectiveLowLatencyEnabled, stableHlsCompatibilityMode]);

  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    try {
      hls.currentLevel = selectedQuality;
      hls.nextLevel = selectedQuality;
      if (selectedQuality < 0) setQualityIndicator("Auto");
      else {
        const level = hls.levels[selectedQuality];
        setQualityIndicator(level ? formatQualityLabel(level) : "Manual");
      }
    } catch {
      // ignore
    }
  }, [selectedQuality]);

  useEffect(() => {
    const nextVolume = Math.min(1, Math.max(0, volume));
    desiredVolumeRef.current = nextVolume;
    const video = videoRef.current;
    if (!video) return;
    try {
      video.volume = nextVolume;
      video.muted = nextVolume === 0;
    } catch {
      // ignore
    }
  }, [volume]);

  useEffect(() => {
    if (volume > 0) {
      lastAudibleVolumeRef.current = volume;
    }
  }, [volume]);

  useEffect(() => {
    if (!isMobilePlayback) return;
    if (mobileControlsHideTimerRef.current) {
      clearTimeout(mobileControlsHideTimerRef.current);
      mobileControlsHideTimerRef.current = null;
    }
    if (error || needsClick) {
      setMobileControlsVisible(false);
      return;
    }
    if (mobileControlsVisible && isPlaying) {
      mobileControlsHideTimerRef.current = setTimeout(() => {
        setMobileControlsVisible(false);
      }, MOBILE_CONTROLS_HIDE_MS);
    }
    return () => {
      if (mobileControlsHideTimerRef.current) {
        clearTimeout(mobileControlsHideTimerRef.current);
        mobileControlsHideTimerRef.current = null;
      }
    };
  }, [error, isMobilePlayback, isPlaying, mobileControlsVisible, needsClick]);

  const scheduleMobileControlsHide = () => {
    if (!isMobilePlayback) return;
    if (mobileControlsHideTimerRef.current) {
      clearTimeout(mobileControlsHideTimerRef.current);
      mobileControlsHideTimerRef.current = null;
    }
    if (!isPlaying) return;
    mobileControlsHideTimerRef.current = setTimeout(() => {
      setMobileControlsVisible(false);
    }, MOBILE_CONTROLS_HIDE_MS);
  };

  const revealMobileControls = () => {
    if (!isMobilePlayback) return;
    setMobileControlsVisible(true);
    scheduleMobileControlsHide();
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof navigator === "undefined") return;
    const mediaSession = (navigator as { mediaSession?: MediaSession }).mediaSession;
    if (!mediaSession) return;

    try {
      if (typeof window !== "undefined" && "MediaMetadata" in window) {
        mediaSession.metadata = new window.MediaMetadata({
          title: isLiveStream ? "dStream Live" : "dStream Replay",
          artist: "dStream"
        });
      }
      mediaSession.setActionHandler("play", () => {
        userPausedPlaybackRef.current = false;
        void video.play().catch(() => {
          // ignore
        });
      });
      mediaSession.setActionHandler("pause", () => {
        userPausedPlaybackRef.current = true;
        video.pause();
      });
    } catch {
      // ignore unsupported environments
    }

    return () => {
      try {
        mediaSession.setActionHandler("play", null);
        mediaSession.setActionHandler("pause", null);
      } catch {
        // ignore
      }
    };
  }, [isLiveStream, normalizedSrc]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const mediaSession = (navigator as { mediaSession?: MediaSession }).mediaSession;
    if (!mediaSession) return;
    try {
      mediaSession.playbackState = error ? "none" : isPlaying ? "playing" : "paused";
    } catch {
      // ignore
    }
  }, [error, isPlaying]);

  useEffect(() => {
    if (!effectiveBackgroundPlayEnabled) return;
    configureAudioSessionForPlayback();
  }, [effectiveBackgroundPlayEnabled]);

  useEffect(() => {
    if (typeof document === "undefined" || !effectiveBackgroundPlayEnabled) return;
    const video = videoRef.current;
    if (!video) return;

    let backgroundPlaybackRequested = document.visibilityState === "hidden";
    let pageLifecycleHidden = document.visibilityState === "hidden";
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    let progressCheckTimer: ReturnType<typeof setTimeout> | null = null;
    let backgroundRecoveryAttempts = 0;

    const restorePreferredPlaybackVolume = () => {
      const nextVolume = Math.min(1, Math.max(0, desiredVolumeRef.current));
      try {
        video.muted = nextVolume === 0;
        if (video.volume !== nextVolume) video.volume = nextVolume;
      } catch {
        // ignore unsupported media writes
      }
    };

    const attemptBackgroundPlay = (allowVisibleResume = false) => {
      if (video.ended) return;
      if (!allowVisibleResume && document.visibilityState !== "hidden") return;
      backgroundPlaybackRequested = true;
      if (startupGatePendingRef.current) return;
      configureAudioSessionForPlayback();
      restorePreferredPlaybackVolume();
      void video.play().catch(() => {
        // ignore browser policy failures
      });
    };

    const scheduleBestEffortRetry = () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        if (backgroundPlaybackRequested || document.visibilityState === "hidden") {
          attemptBackgroundPlay(true);
        }
      }, 250);
    };

    const onHiddenLifecycle = () => {
      pageLifecycleHidden = true;
      attemptBackgroundPlay(true);
      scheduleBestEffortRetry();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        onHiddenLifecycle();
        return;
      }
      pageLifecycleHidden = false;
      if (backgroundPlaybackRequested && video.paused && !video.ended) {
        attemptBackgroundPlay(true);
      }
      backgroundPlaybackRequested = false;
    };

    const onPause = () => {
      if (document.visibilityState !== "hidden" && !pageLifecycleHidden) return;
      if (userPausedPlaybackRef.current) return;
      const pausedAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      attemptBackgroundPlay(true);
      scheduleBestEffortRetry();
      if (progressCheckTimer) clearTimeout(progressCheckTimer);
      const checkBackgroundProgress = () => {
        progressCheckTimer = null;
        if (document.visibilityState !== "hidden" || userPausedPlaybackRef.current || video.ended) return;
        const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        if (currentTime > pausedAt + 0.25) {
          backgroundRecoveryAttempts = 0;
          return;
        }

        attemptBackgroundPlay(true);
        scheduleBestEffortRetry();
        backgroundRecoveryAttempts += 1;
        if (readBufferedAheadSeconds(video) < 0.25 && video.readyState <= 2) {
          const reason = "Background playback ran out of buffered media. Retrying the current position.";
          setError(null);
          setStatus("Reconnecting…");
          setNote(reason);
          video.dataset.dstreamPlaybackRecoveryReason = reason;
          const hls = hlsRef.current;
          if (playbackModeRef.current === "hls" && hls) {
            try {
              hls.stopLoad();
              hls.startLoad(currentTime, true);
            } catch {
              // The next bounded retry can resume the existing session.
            }
          }
        }
        if (backgroundRecoveryAttempts < 3) {
          progressCheckTimer = setTimeout(checkBackgroundProgress, 6_000);
        }
      };
      progressCheckTimer = setTimeout(checkBackgroundProgress, 6_000);
    };

    const onVisibleLifecycle = () => {
      pageLifecycleHidden = false;
      if (backgroundPlaybackRequested && video.paused && !video.ended) {
        attemptBackgroundPlay(true);
      }
      backgroundPlaybackRequested = false;
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onHiddenLifecycle);
    window.addEventListener("pageshow", onVisibleLifecycle);
    window.addEventListener("focus", onVisibleLifecycle);
    document.addEventListener("freeze", onHiddenLifecycle as EventListener);
    document.addEventListener("resume", onVisibleLifecycle as EventListener);
    video.addEventListener("pause", onPause);
    return () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      if (progressCheckTimer) clearTimeout(progressCheckTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onHiddenLifecycle);
      window.removeEventListener("pageshow", onVisibleLifecycle);
      window.removeEventListener("focus", onVisibleLifecycle);
      document.removeEventListener("freeze", onHiddenLifecycle as EventListener);
      document.removeEventListener("resume", onVisibleLifecycle as EventListener);
      video.removeEventListener("pause", onPause);
    };
  }, [effectiveBackgroundPlayEnabled]);

  useEffect(() => {
    if (!isLiveStream || !playbackStartupPolicyReady) return;
    const video = videoRef.current;
    if (!video) return;

    let lastObservedTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    let lastObservedFrames = readVideoFrameCount(video);
    let lastProgressAt = Date.now();
    let hasObservedPlaybackProgress = lastObservedTime > 0.25 || (lastObservedFrames ?? 0) > 0;
    let inSessionRecoveryAttempts = 0;
    let lastInSessionRecoveryAt = 0;

    const markHealthy = (now: number, currentTime: number, frameCount: number | null) => {
      lastObservedTime = currentTime;
      lastObservedFrames = frameCount;
      lastProgressAt = now;
    };

    const checkLiveProgress = () => {
      const now = Date.now();
      const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const frameCount = readVideoFrameCount(video);

      if (needsClick || userPausedPlaybackRef.current) {
        markHealthy(now, currentTime, frameCount);
        return;
      }

      const bufferAhead = readBufferedAheadSeconds(video);
      const hasPlayableMedia = video.readyState >= 3 || bufferAhead > 0.25;
      const timeAdvanced = currentTime > lastObservedTime + 0.35 && hasPlayableMedia;
      const framesAdvanced =
        frameCount !== null && lastObservedFrames !== null && frameCount > lastObservedFrames + 2;
      const timelineChanged = lastObservedTime > 5 && currentTime + 1.25 < lastObservedTime;

      if (timeAdvanced || framesAdvanced || timelineChanged) {
        hasObservedPlaybackProgress = true;
        inSessionRecoveryAttempts = 0;
        lastInSessionRecoveryAt = 0;
        markHealthy(now, currentTime, frameCount);
        return;
      }

      if (video.ended) {
        requestLivePlaybackReload("Live media ended unexpectedly. Reconnected to the current live window.");
        markHealthy(now, currentTime, frameCount);
        return;
      }

      if (video.paused && !startupGatePendingRef.current) {
        void video.play().catch(() => {
          setStatus("Click to play");
          setNeedsClick(true);
        });
      }

      const stalledForMs = now - lastProgressAt;
      const hls = hlsRef.current;
      const tryInSessionRecovery = (reason: string) => {
        if (playbackModeRef.current !== "hls" || !hls || inSessionRecoveryAttempts >= 3) return false;
        if (lastInSessionRecoveryAt > 0 && now - lastInSessionRecoveryAt < 5_000) return true;
        inSessionRecoveryAttempts += 1;
        lastInSessionRecoveryAt = now;
        setError(null);
        setStatus("Reconnecting…");
        setNote(reason);
        video.dataset.dstreamPlaybackRecoveryReason = reason;
        try {
          if (selectedQualityRef.current < 0 && hls.levels.length > 1) {
            const activeLevel = Math.max(hls.currentLevel, hls.loadLevel, hls.nextLoadLevel);
            if (activeLevel > 0) {
              const stableLevel = activeLevel - 1;
              hls.autoLevelCapping =
                hls.autoLevelCapping >= 0 ? Math.min(hls.autoLevelCapping, stableLevel) : stableLevel;
              hls.nextLoadLevel = stableLevel;
            }
          }
          hls.stopLoad();
          hls.startLoad(currentTime, true);
        } catch {
          // The next watchdog pass can escalate if the HLS instance cannot restart.
        }
        void video.play().catch(() => {
          setStatus("Click to play");
          setNeedsClick(true);
        });
        return true;
      };
      const starvationRecoveryThresholdMs = 6_000;
      if (
        hasObservedPlaybackProgress &&
        stalledForMs >= starvationRecoveryThresholdMs &&
        bufferAhead < 0.25 &&
        video.readyState <= 2 &&
        tryInSessionRecovery("The live buffer ran dry. Retrying a more stable rendition without resetting playback.")
      ) {
        return;
      }

      const hlsActivity = liveHlsActivityRef.current;
      const lastHlsActivityAt = Math.max(
        hlsActivity.lastFragBufferedAt,
        hlsActivity.lastFragChangedAt,
        hlsActivity.lastLevelUpdatedAt
      );
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      const stallThresholdMs = hasObservedPlaybackProgress ? (hidden ? 30_000 : 20_000) : hidden ? 45_000 : 35_000;
      const mediaFeedStale = lastHlsActivityAt === 0 || now - lastHlsActivityAt >= stallThresholdMs;
      const bufferedDecoderFrozen = hasObservedPlaybackProgress && bufferAhead >= 0.5 && video.readyState >= 3;
      if (stalledForMs >= stallThresholdMs && (mediaFeedStale || bufferedDecoderFrozen)) {
        if (tryInSessionRecovery("Live playback stopped advancing. Retrying without resetting the player.")) return;
        if (hidden) return;
        requestLivePlaybackReload("Live playback stopped advancing. Reconnected to the current live window.");
        markHealthy(now, currentTime, frameCount);
      }
    };

    const interval = setInterval(checkLiveProgress, 1000);
    video.addEventListener("playing", checkLiveProgress);
    video.addEventListener("waiting", checkLiveProgress);
    video.addEventListener("stalled", checkLiveProgress);
    return () => {
      clearInterval(interval);
      video.removeEventListener("playing", checkLiveProgress);
      video.removeEventListener("waiting", checkLiveProgress);
      video.removeEventListener("stalled", checkLiveProgress);
    };
  }, [
    effectiveBackgroundPlayEnabled,
    isLiveStream,
    lowLatencyEnabled,
    needsClick,
    playbackReloadNonce,
    playbackStartupPolicyReady,
    normalizedSrc,
    normalizedWhepSrc,
    requestLivePlaybackReload
  ]);

  useEffect(() => {
    if (error || needsClick || volume !== 0) {
      setUnmuteHintPhase("hidden");
      return;
    }
    setUnmuteHintPhase("visible");
    const fadeTimer = setTimeout(() => setUnmuteHintPhase("fading"), 1300);
    const hideTimer = setTimeout(() => setUnmuteHintPhase("hidden"), 1900);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [error, needsClick, volume, normalizedSrc, normalizedWhepSrc]);

  useEffect(() => {
    setLiveEdgePinned(Boolean(isLiveStream));
  }, [isLiveStream, normalizedSrc, normalizedWhepSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncPlaying = () => setIsPlaying(!video.paused && !video.ended);
    syncPlaying();
    video.addEventListener("play", syncPlaying);
    video.addEventListener("pause", syncPlaying);
    video.addEventListener("ended", syncPlaying);
    return () => {
      video.removeEventListener("play", syncPlaying);
      video.removeEventListener("pause", syncPlaying);
      video.removeEventListener("ended", syncPlaying);
    };
  }, [normalizedSrc, normalizedWhepSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onVolumeChange = () => {
      try {
        const nextVolume = video.muted ? 0 : Math.min(1, Math.max(0, video.volume));
        setVolume((prev) => (Math.abs(prev - nextVolume) < 0.001 ? prev : nextVolume));
      } catch {
        // ignore
      }
    };
    video.addEventListener("volumechange", onVolumeChange);
    return () => {
      video.removeEventListener("volumechange", onVolumeChange);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackStateKey) return;

    let lastWriteAt = 0;
    const persist = () => {
      const currentTime = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
      const volumeLevel = Number.isFinite(video.volume) ? clampUnit(video.volume) : 0;
      writePersistedPlaybackState(playbackStateKey, {
        volume: volumeLevel,
        muted: video.muted || volumeLevel === 0,
        currentTime,
        updatedAt: Date.now()
      });
    };
    const onTimeUpdate = () => {
      const now = Date.now();
      if (now - lastWriteAt < 800) return;
      lastWriteAt = now;
      persist();
    };
    const onVolumePersist = () => persist();

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("volumechange", onVolumePersist);
    persist();
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("volumechange", onVolumePersist);
      persist();
    };
  }, [playbackStateKey, normalizedSrc, normalizedWhepSrc]);

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const pipVideo = video as PictureInPictureVideo;
    const syncWebkitPip = () => {
      setIsPip(pipVideo.webkitPresentationMode === "picture-in-picture");
    };
    const onEnter = () => setIsPip(true);
    const onLeave = () => setIsPip(false);
    video.addEventListener("enterpictureinpicture", onEnter as any);
    video.addEventListener("leavepictureinpicture", onLeave as any);
    video.addEventListener("webkitpresentationmodechanged", syncWebkitPip as any);
    syncWebkitPip();
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter as any);
      video.removeEventListener("leavepictureinpicture", onLeave as any);
      video.removeEventListener("webkitpresentationmodechanged", syncWebkitPip as any);
    };
  }, []);

  useEffect(() => {
    if (!playbackStartupPolicyReady) return;

    setError(null);
    setStatus("Loading…");
    setNeedsClick(false);
    setPlaybackMode("hls");
    setNote(null);
    setQualityOptions([]);
    setQualityIndicator("Auto");
    setTimelineStart(0);
    setTimelineEnd(0);
    setTimelinePosition(0);

    const primarySrc = normalizedSrc;
    const primaryKind = inferMediaUrlKind(primarySrc);
    const getBackupSrc = () => (fallbackSrcRef.current ?? "").trim();
    const canUseBackupSource = (candidate: string) =>
      candidate.length > 0 && candidate !== primarySrc && !isExternalPlaybackUrl(primarySrc);
    let backupTried = false;
    let zapAudioFallbackActive = false;

    if (!primarySrc || !videoRef.current) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (whepRef.current) {
      void whepRef.current.close();
      whepRef.current = null;
    }

    const video = videoRef.current;
    liveHlsActivityRef.current = {
      lastFragBufferedAt: 0,
      lastFragChangedAt: 0,
      lastLevelUpdatedAt: 0
    };
    playbackSessionGenerationRef.current += 1;
    video.dataset.dstreamPlaybackSession = String(playbackSessionGenerationRef.current);
    video.dataset.dstreamSourceMode = "primary";
    video.dataset.dstreamPlaybackSignature = JSON.stringify({
      isMobilePlayback,
      isFirefoxPlayback,
      isLiveStream,
      lowLatencyEnabled: effectiveLowLatencyEnabled,
      playbackStartupPolicyReady,
      preferNativeHls,
      src: normalizedSrc,
      whepSrc: normalizedWhepSrc
    });
    startupGatePendingRef.current = false;
    video.dataset.dstreamStartupGate = "released";
    let cancelled = false;
    const persistedPlayback = readPersistedPlaybackState(playbackStateKeyRef.current);
    const persistedResumeTime =
      !isLiveStream &&
      persistedPlayback &&
      typeof persistedPlayback.currentTime === "number" &&
      Number.isFinite(persistedPlayback.currentTime)
        ? Math.max(0, persistedPlayback.currentTime)
        : null;
    const applyPersistedSeek = () => {
      if (persistedResumeTime === null) return;
      try {
        const targetTime = Math.max(0, persistedResumeTime);
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = Math.min(Math.max(0, video.duration - 0.35), targetTime);
          return;
        }
        video.currentTime = targetTime;
      } catch {
        // ignore
      }
    };
    try {
      (video as any).srcObject = null;
    } catch {
      // ignore
    }
    try {
      video.src = "";
    } catch {
      // ignore
    }
    try {
      // Default to muted so autoplay works across browsers; users can unmute via controls.
      video.muted = effectiveAutoplayMuted;
      if (effectiveAutoplayMuted) {
        setVolume((current) => (current === 0 ? current : 0));
      }
    } catch {
      // ignore
    }
    let readySent = false;
    const sendReady = () => {
      if (readySent) return;
      readySent = true;
      try {
        onReadyRef.current?.();
      } catch {
        // ignore
      }
    };
    let removeNativeListener: (() => void) | null = null;
    let removeHlsStartupListener: (() => void) | null = null;
    const clearHlsStartupListener = () => {
      try {
        removeHlsStartupListener?.();
      } catch {
        // ignore
      }
      removeHlsStartupListener = null;
    };
    const getBufferedAheadSeconds = () => {
      try {
        const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        for (let index = 0; index < video.buffered.length; index++) {
          const start = video.buffered.start(index);
          const end = video.buffered.end(index);
          if (current >= start - 0.05 && current <= end + 0.05) return Math.max(0, end - current);
        }
      } catch {
        // ignore
      }
      return 0;
    };
    const getBestStartupRange = () => {
      let best: { start: number; end: number; duration: number } | null = null;
      try {
        for (let index = 0; index < video.buffered.length; index++) {
          const start = video.buffered.start(index);
          const end = video.buffered.end(index);
          const duration = Math.max(0, end - start);
          if (
            !best ||
            duration > best.duration + 0.05 ||
            (Math.abs(duration - best.duration) <= 0.05 && end > best.end)
          ) {
            best = { start, end, duration };
          }
        }
      } catch {
        // ignore
      }
      return best;
    };
    const setStartupGatePending = (pending: boolean) => {
      startupGatePendingRef.current = pending;
      video.dataset.dstreamStartupGate = pending ? "pending" : "released";
      if (!pending) video.dataset.dstreamStartupBuffer = getBufferedAheadSeconds().toFixed(3);
    };
    const beginHlsPlayback = () => {
      setStartupGatePending(false);
      setStatus("Ready");
      sendReady();
      void video.play().catch(() => {
        setStatus("Click to play");
        setNeedsClick(true);
      });
    };
    const waitForHlsStartupBuffer = (hls: Hls) => {
      clearHlsStartupListener();
      if (!isLiveStream) {
        beginHlsPlayback();
        return;
      }
      const targetBufferSeconds =
        effectiveBackgroundPlayEnabled || zapStreamCompatibilityMode ? 8 : effectiveLowLatencyEnabled ? 3 : 5;
      const maxWaitMs = zapStreamCompatibilityMode
        ? 20_000
        : effectiveBackgroundPlayEnabled
          ? 12_000
          : effectiveLowLatencyEnabled
            ? 5_000
            : 8_000;
      const startedAt = Date.now();
      let started = false;
      let startupTimer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (startupTimer) {
          clearTimeout(startupTimer);
          startupTimer = null;
        }
        try {
          hls.off(Hls.Events.FRAG_BUFFERED, maybeStart);
        } catch {
          // ignore
        }
        video.removeEventListener("canplay", maybeStart);
        video.removeEventListener("progress", maybeStart);
      };
      const startNow = () => {
        if (started || cancelled) return;
        started = true;
        cleanup();
        removeHlsStartupListener = null;
        beginHlsPlayback();
      };
      function maybeStart() {
        if (started || cancelled) return;
        const waitedMs = Date.now() - startedAt;
        const bufferedAhead = getBufferedAheadSeconds();
        const startupRange = bufferedAhead > 0 ? null : getBestStartupRange();
        if (
          bufferedAhead >= targetBufferSeconds ||
          (startupRange?.duration ?? 0) >= targetBufferSeconds ||
          waitedMs >= maxWaitMs
        ) {
          if (bufferedAhead === 0 && startupRange && startupRange.duration > 0.25) {
            try {
              video.currentTime = startupRange.start + Math.min(0.1, startupRange.duration / 4);
            } catch {
              // ignore
            }
          }
          startNow();
        }
      }
      setStatus("Buffering…");
      hls.on(Hls.Events.FRAG_BUFFERED, maybeStart);
      video.addEventListener("canplay", maybeStart);
      video.addEventListener("progress", maybeStart);
      startupTimer = setTimeout(maybeStart, maxWaitMs);
      removeHlsStartupListener = cleanup;
      maybeStart();
    };
    let whepFallbackInProgress = false;
    let whepStallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearWhepStallTimer = () => {
      if (!whepStallTimer) return;
      clearTimeout(whepStallTimer);
      whepStallTimer = null;
    };
    const tryHlsBackup = (reason: string, beforeStart?: () => void): boolean => {
      const backupSrc = getBackupSrc();
      if (!canUseBackupSource(backupSrc) || backupTried || cancelled) return false;
      backupTried = true;
      setError(null);
      setStatus("Loading…");
      setNeedsClick(false);
      setQualityOptions([]);
      setQualityIndicator("Auto");
      setNote(reason);
      try {
        beforeStart?.();
      } catch {
        // ignore
      }
      return startBestEffort(backupSrc);
    };
    const fallbackFromWhepToHls = (reason: string) => {
      if (cancelled) return;
      if (playbackModeRef.current !== "whep") return;
      if (whepFallbackInProgress) return;
      whepFallbackInProgress = true;
      clearWhepStallTimer();
      setNote(reason);
      setError(null);
      setStatus("Switching to HLS…");
      try {
        (video as any).srcObject = null;
      } catch {
        // ignore
      }
      if (whepRef.current) {
        void whepRef.current.close();
        whepRef.current = null;
      }
      startHls(primarySrc);
    };
    const onPlaying = () => {
      clearWhepStallTimer();
      setNeedsClick(false);
      setStatus("Playing");
    };
    const onWaiting = () => {
      setStatus((prev) => (prev === "Click to play" ? prev : "Buffering…"));
      if (playbackModeRef.current !== "whep") return;
      clearWhepStallTimer();
      whepStallTimer = setTimeout(() => {
        fallbackFromWhepToHls("Low-latency stream became unstable. Switched to HLS for stability.");
      }, 3500);
    };
    const onStalled = () => {
      if (playbackModeRef.current !== "whep") return;
      clearWhepStallTimer();
      whepStallTimer = setTimeout(() => {
        fallbackFromWhepToHls("Low-latency stream stalled. Switched to HLS for stability.");
      }, 1200);
    };
    const onErrorFallback = () => {
      if (playbackModeRef.current !== "whep") return;
      fallbackFromWhepToHls("Low-latency stream error. Switched to HLS for stability.");
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("error", onErrorFallback);

    const integrityEnabled = !!integrity?.enabled;

    const startDirect = (mediaSource: string): boolean => {
      setStartupGatePending(false);
      setPlaybackMode("direct");
      setQualityOptions([]);
      setQualityIndicator("Source");
      const onLoaded = () => {
        applyPersistedSeek();
        setStatus("Ready");
        sendReady();
      };
      const onDirectError = () => {
        if (
          tryHlsBackup("Primary stream unavailable (trying backup stream path).", () => {
            try {
              video.pause();
              video.removeEventListener("loadedmetadata", onLoaded);
              video.removeEventListener("error", onDirectError);
              video.removeAttribute("src");
            } catch {
              // ignore
            }
          })
        ) {
          return;
        }
        setError("Unable to load stream.");
      };
      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("error", onDirectError);
      video.src = mediaSource;
      void video.play().catch(() => {
        setStatus("Click to play");
        setNeedsClick(true);
      });
      removeNativeListener = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onDirectError);
      };
      return true;
    };

    const startHls = (hlsSource: string, options: { skipNative?: boolean } = {}): boolean => {
      let mediaRecoveryAttempts = 0;
      let networkRecoveryAttempts = 0;
      let networkRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
      let hasBufferedHlsFragment = false;
      setStartupGatePending(true);
      setPlaybackMode("hls");
      liveHlsActivityRef.current = {
        lastFragBufferedAt: Date.now(),
        lastFragChangedAt: Date.now(),
        lastLevelUpdatedAt: Date.now()
      };
      const markLiveHlsActivity = (key: keyof LiveHlsActivity) => {
        liveHlsActivityRef.current[key] = Date.now();
      };
      // Prefer native HLS (Safari is typically more reliable without hls.js),
      // unless integrity verification is enabled (we need byte access).
      if (!integrityEnabled && preferNativeHls && !options.skipNative && video.canPlayType("application/vnd.apple.mpegurl")) {
        setStartupGatePending(false);
        let nativeStartTimer: ReturnType<typeof setTimeout> | null = null;
        let nativeSettled = false;
        const cleanupNativeListeners = () => {
          if (nativeStartTimer) {
            clearTimeout(nativeStartTimer);
            nativeStartTimer = null;
          }
          video.removeEventListener("loadedmetadata", onNativeReady);
          video.removeEventListener("canplay", onNativeReady);
          video.removeEventListener("playing", onNativeReady);
          video.removeEventListener("error", onNativeError);
        };
        const switchNativeToCompatibility = (reason: string): boolean => {
          if (cancelled || nativeSettled || !Hls.isSupported()) return false;
          nativeSettled = true;
          cleanupNativeListeners();
          setNote(reason);
          setError(null);
          setStatus("Loading…");
          setNeedsClick(false);
          try {
            video.pause();
            video.removeAttribute("src");
            video.load();
          } catch {
            // ignore
          }
          startHls(hlsSource, { skipNative: true });
          return true;
        };
        const onNativeReady = () => {
          if (nativeSettled) return;
          nativeSettled = true;
          if (nativeStartTimer) {
            clearTimeout(nativeStartTimer);
            nativeStartTimer = null;
          }
          applyPersistedSeek();
          setStatus("Ready");
          setNeedsClick(false);
          sendReady();
        };
        const onNativeError = () => {
          if (switchNativeToCompatibility("Native HLS unavailable. Switched to compatibility playback.")) return;
          if (!nativeSettled) nativeSettled = true;
          cleanupNativeListeners();
          if (
            tryHlsBackup("Primary stream unavailable (trying backup stream path).", () => {
              try {
                video.pause();
                video.removeAttribute("src");
              } catch {
                // ignore
              }
            })
          ) {
            return;
          }
          setError("Unable to load stream.");
        };
        video.addEventListener("loadedmetadata", onNativeReady);
        video.addEventListener("canplay", onNativeReady);
        video.addEventListener("playing", onNativeReady);
        video.addEventListener("error", onNativeError);
        nativeStartTimer = setTimeout(() => {
          if (cancelled || nativeSettled) return;
          if (video.readyState >= 2 || video.currentTime > 0 || !video.paused) {
            onNativeReady();
            return;
          }
          if (switchNativeToCompatibility("Native HLS did not start. Switched to compatibility playback.")) return;
          if (
            tryHlsBackup("Primary stream did not start (trying backup stream path).", () => {
              cleanupNativeListeners();
              nativeSettled = true;
              try {
                video.pause();
                video.removeAttribute("src");
              } catch {
                // ignore
              }
            })
          ) {
            return;
          }
          nativeSettled = true;
          cleanupNativeListeners();
          setStatus("Click to play");
          setNeedsClick(true);
        }, 6500);
        video.src = hlsSource;
        void video.play().catch(() => {
          if (cancelled || nativeSettled) return;
          if (Hls.isSupported()) {
            setStatus("Loading…");
            return;
          }
          setStatus("Click to play");
          setNeedsClick(true);
        });
        removeNativeListener = () => {
          cleanupNativeListeners();
        };
        return true;
      }

      if (!Hls.isSupported()) {
        setStartupGatePending(false);
        setError("HLS not supported in this browser.");
        return false;
      }

      const integrityRewrite =
        integrityEnabled && hlsSource.includes("/api/dev/tamper-hls/")
          ? { from: "/api/dev/tamper-hls/", to: "/api/hls/" }
          : null;
      const hlsPlaybackTuning = getHlsPlaybackTuning({
        lowLatencyEnabled: effectiveLowLatencyEnabled,
        backgroundPlayEnabled: effectiveBackgroundPlayEnabled,
        bridgeLiveGaps: stableHlsCompatibilityMode
      });
      const needsDstreamFragmentLoader = integrityEnabled || hlsSource.includes("/api/hls/");
      const useMonotonicPlaylistGuard = !isFirefoxPlayback && !isZapStreamHlsUrl(hlsSource);
      let malformedZapTimingDetected = false;
      let switchMalformedZapSourceToAudio = () => false;
      const hls = new Hls({
        startPosition: persistedResumeTime !== null ? Math.max(0, persistedResumeTime) : -1,
        enableWorker: true,
        capLevelToPlayerSize: true,
        manifestLoadingTimeOut: 6_000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 250,
        manifestLoadingMaxRetryTimeout: 2_000,
        levelLoadingTimeOut: 6_000,
        levelLoadingMaxRetry: 8,
        levelLoadingRetryDelay: 250,
        levelLoadingMaxRetryTimeout: 2_000,
        fragLoadingTimeOut: 10_000,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 250,
        fragLoadingMaxRetryTimeout: 2_000,
        pLoader: MonotonicPlaylistLoader,
        ...(needsDstreamFragmentLoader ? { fLoader: P2PFragmentLoader } : {}),
        ...hlsPlaybackTuning,
        dstreamRefs: dstreamRefs,
        dstreamMonotonicPlaylistGuard: useMonotonicPlaylistGuard,
        dstreamInvalidPlaylistTiming: false,
        dstreamOnInvalidPlaylistTiming: () => {
          malformedZapTimingDetected = true;
          setTimeout(() => switchMalformedZapSourceToAudio(), 0);
        },
        dstreamIntegrityHttpRewrite: integrityRewrite
      } as any);
      applyHlsPlaybackTuning(hls, {
        lowLatencyEnabled: effectiveLowLatencyEnabled,
        backgroundPlayEnabled: effectiveBackgroundPlayEnabled,
        bridgeLiveGaps: stableHlsCompatibilityMode
      });
      hlsRef.current = hls;

      hls.loadSource(hlsSource);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        applyHlsPlaybackTuning(hls, {
          lowLatencyEnabled: effectiveLowLatencyEnabled,
          backgroundPlayEnabled: effectiveBackgroundPlayEnabled,
          bridgeLiveGaps: stableHlsCompatibilityMode
        });
        applyPersistedSeek();
        const options = hls.levels.map((level, index) => ({ value: index, label: formatQualityLabel(level) }));
        setQualityOptions(options);
        try {
          hls.currentLevel = selectedQualityRef.current;
          hls.nextLevel = selectedQualityRef.current;
        } catch {
          // ignore
        }
        setQualityIndicator(
          selectedQualityRef.current < 0
            ? "Auto"
            : options.find((o) => o.value === selectedQualityRef.current)?.label ?? "Manual"
        );
        waitForHlsStartupBuffer(hls);
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        hasBufferedHlsFragment = true;
        networkRecoveryAttempts = 0;
        if (networkRecoveryTimer) {
          clearTimeout(networkRecoveryTimer);
          networkRecoveryTimer = null;
        }
        markLiveHlsActivity("lastFragBufferedAt");
      });
      hls.on(Hls.Events.FRAG_CHANGED, (_event, data) => {
        markLiveHlsActivity("lastFragChangedAt");
        const programDateTime = data.frag?.programDateTime;
        if (typeof programDateTime === "number" && Number.isFinite(programDateTime)) {
          video.dataset.dstreamProgramDateTime = String(programDateTime);
        }
        if (data.frag?.sn !== undefined) video.dataset.dstreamHlsFragment = String(data.frag.sn);
      });
      switchMalformedZapSourceToAudio = () => {
        if (zapAudioFallbackActive || !isZapStreamHlsUrl(hlsSource)) return false;
        if (!malformedZapTimingDetected && !(hls.config as any).dstreamInvalidPlaylistTiming) return false;
        const audioTrackUrl = hls.audioTracks.find(
          (track) => typeof track.url === "string" && track.url.length > 0
        )?.url;
        if (!audioTrackUrl) return false;

        zapAudioFallbackActive = true;
        clearHlsStartupListener();
        setError(null);
        setStatus("Switching to stable audio…");
        setNote("The source video timeline is malformed. Playing its stable audio rendition.");
        setQualityOptions([]);
        setQualityIndicator("Audio");
        video.dataset.dstreamSourceMode = "zap-audio-fallback";
        setTimeout(() => {
          if (cancelled || hlsRef.current !== hls) return;
          try {
            hls.destroy();
          } catch {
            // ignore
          }
          hlsRef.current = null;
          try {
            video.pause();
            video.removeAttribute("src");
            video.load();
          } catch {
            // ignore
          }
          startHls(audioTrackUrl);
        }, 0);
        return true;
      };
      hls.on(Hls.Events.LEVEL_LOADED, () => {
        markLiveHlsActivity("lastLevelUpdatedAt");
        switchMalformedZapSourceToAudio();
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => switchMalformedZapSourceToAudio());
      hls.on(Hls.Events.LEVEL_UPDATED, () => markLiveHlsActivity("lastLevelUpdatedAt"));

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const idx = typeof data?.level === "number" ? data.level : -1;
        if (idx < 0) return;
        video.dataset.dstreamHlsLevel = String(idx);
        const level = hls.levels[idx];
        const current = level ? formatQualityLabel(level) : "Unknown";
        setQualityIndicator(selectedQualityRef.current < 0 ? `Auto · ${current}` : current);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (
              (!isLiveStream || !hasBufferedHlsFragment) &&
              (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) &&
              tryHlsBackup("Primary stream unavailable (trying backup stream path).", () => {
                try {
                  hls.destroy();
                } catch {
                  // ignore
                }
                hlsRef.current = null;
              })
            ) {
              return;
            }
            if (isLiveStream) {
              setError(null);
              setStatus("Reconnecting…");
              setNote("The live source connection was interrupted. Retrying without resetting playback.");
              networkRecoveryAttempts += 1;
              if (!networkRecoveryTimer) {
                const retryDelayMs = Math.min(5_000, 500 * 2 ** Math.min(networkRecoveryAttempts - 1, 4));
                networkRecoveryTimer = setTimeout(() => {
                  networkRecoveryTimer = null;
                  if (cancelled || hlsRef.current !== hls) return;
                  try {
                    hls.startLoad(Number.isFinite(video.currentTime) ? video.currentTime : -1, true);
                  } catch {
                    return;
                  }
                  void video.play().catch(() => {
                    setStatus("Click to play");
                    setNeedsClick(true);
                  });
                }, retryDelayMs);
              }
              break;
            }
            setError("Unable to continue playback because the media source is unavailable.");
            setStatus("Error");
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            setError(null);
            setStatus("Recovering…");
            mediaRecoveryAttempts++;
            try {
              if (mediaRecoveryAttempts === 1) {
                hls.recoverMediaError();
              } else if (mediaRecoveryAttempts === 2) {
                hls.swapAudioCodec();
                hls.recoverMediaError();
              } else if (isLiveStream) {
                requestLivePlaybackReload("The media decoder failed repeatedly. Reconnected with a fresh player session.");
              } else {
                setError("Unable to decode this media source.");
                setStatus("Error");
              }
              void video.play().catch(() => {
                setStatus("Click to play");
                setNeedsClick(true);
              });
            } catch {
              if (isLiveStream) requestLivePlaybackReload("Media recovery failed. Reconnected with a fresh player session.");
            }
            break;
          default:
            if (isLiveStream) {
              requestLivePlaybackReload("The player encountered a fatal error. Reconnected with a fresh session.");
            } else {
              setError("Fatal player error.");
              hls.destroy();
            }
            break;
        }
      });
      return true;
    };

    const startBestEffort = (source: string): boolean => {
      const sourceKind = inferMediaUrlKind(source);
      if (sourceKind === "direct") return startDirect(source);
      return startHls(source);
    };

    const endpoint = normalizedWhepSrc;
    const rtcSupported = typeof RTCPeerConnection !== "undefined";
    const tryWhep = async () => {
      setStartupGatePending(true);
      setStatus("Loading…");
      try {
        const client = new WhepClient(endpoint);
        whepRef.current = client;
        const result = await client.start({ timeoutMs: 2500 });
        if (cancelled) {
          await client.close();
          if (whepRef.current === client) whepRef.current = null;
          return false;
        }
        setPlaybackMode("whep");
        setQualityIndicator("Low latency");
        setStatus("Ready");
        sendReady();

        try {
          (video as any).srcObject = result.stream;
        } catch {
          // ignore
        }
        applyPersistedSeek();

        setStartupGatePending(false);
        void video.play().catch(() => {
          setStatus("Click to play");
          setNeedsClick(true);
        });

        return true;
      } catch {
        if (cancelled) return false;
        try {
          await whepRef.current?.close();
        } catch {
          // ignore
        }
        whepRef.current = null;
        return false;
      }
    };

    if (integrityEnabled) {
      if (primaryKind === "direct") {
        setNote("Integrity verification unavailable for direct media source.");
        startDirect(primarySrc);
      } else {
        if (endpoint) setNote("Integrity verification enabled (using HLS path).");
        startHls(primarySrc);
      }
    } else if (isMobilePlayback) {
      const startedPrimary = startBestEffort(primarySrc);
      if (!startedPrimary && endpoint && rtcSupported && primaryKind !== "direct") {
        void (async () => {
          const ok = await tryWhep();
          if (!ok && !cancelled) {
            setError("Playback unavailable in this mobile browser.");
            setStatus("Error");
          }
        })();
      }
    } else if (primaryKind === "direct") {
      startDirect(primarySrc);
    } else {
      void (async () => {
        const { mode, attemptedWhep } = await pickPlaybackMode({
          whepSrc: endpoint,
          rtcSupported,
          preferLowLatency: effectiveLowLatencyEnabled,
          tryWhep
        });
        if (cancelled) return;
        if (mode === "whep") return;
        if (attemptedWhep) setNote(null);
        startBestEffort(primarySrc);
      })();
    }

    return () => {
      cancelled = true;
      startupGatePendingRef.current = false;
      try {
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("waiting", onWaiting);
        video.removeEventListener("stalled", onStalled);
        video.removeEventListener("error", onErrorFallback);
      } catch {
        // ignore
      }
      clearWhepStallTimer();
      clearHlsStartupListener();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      if (whepRef.current) {
        void whepRef.current.close();
        whepRef.current = null;
      }
      try {
        removeNativeListener?.();
      } catch {
        // ignore
      }
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMobilePlayback,
    isFirefoxPlayback,
    isLiveStream,
    effectiveLowLatencyEnabled,
    playbackReloadNonce,
    playbackStartupPolicyReady,
    preferNativeHls,
    normalizedSrc,
    normalizedWhepSrc,
    requestLivePlaybackReload
  ]);

  const currentPipVideo = videoRef.current as PictureInPictureVideo | null;
  const canTogglePip =
    typeof document !== "undefined" &&
    (!!(document as PictureInPictureDocument).pictureInPictureEnabled ||
      typeof currentPipVideo?.requestPictureInPicture === "function" ||
      typeof currentPipVideo?.webkitSetPresentationMode === "function");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncTimeline = () => {
      try {
        let start = 0;
        let end = 0;
        const seekable = video.seekable;
        if (seekable && seekable.length > 0) {
          start = seekable.start(0);
          end = seekable.end(seekable.length - 1);
        } else if (Number.isFinite(video.duration) && video.duration > 0) {
          end = video.duration;
        }
        const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        const normalizedStart = Math.max(0, start);
        const normalizedEnd = Math.max(0, end);
        const normalizedCurrent = Math.max(0, currentTime);

        setTimelineStart(normalizedStart);
        setTimelineEnd(normalizedEnd);
        setTimelinePosition(normalizedCurrent);
        if (
          isLiveStream &&
          !liveEdgePinned &&
          normalizedEnd > normalizedStart + 1 &&
          normalizedCurrent >= normalizedEnd - LIVE_EDGE_SCRUB_TOLERANCE_SEC
        ) {
          setLiveEdgePinned(true);
        }
      } catch {
        // ignore
      }
    };

    syncTimeline();
    video.addEventListener("loadedmetadata", syncTimeline);
    video.addEventListener("durationchange", syncTimeline);
    video.addEventListener("timeupdate", syncTimeline);
    video.addEventListener("progress", syncTimeline);
    video.addEventListener("seeking", syncTimeline);
    video.addEventListener("seeked", syncTimeline);

    return () => {
      video.removeEventListener("loadedmetadata", syncTimeline);
      video.removeEventListener("durationchange", syncTimeline);
      video.removeEventListener("timeupdate", syncTimeline);
      video.removeEventListener("progress", syncTimeline);
      video.removeEventListener("seeking", syncTimeline);
      video.removeEventListener("seeked", syncTimeline);
    };
  }, [isLiveStream, liveEdgePinned, normalizedSrc, playbackMode]);

  const hasSeekWindow = timelineEnd > timelineStart + 1;
  const showTimeline = showTimelineControls && hasSeekWindow;
  const clampedTimelinePosition = Math.min(Math.max(timelinePosition, timelineStart), timelineEnd || timelineStart);
  const canJumpToLive = isLiveStream && playbackMode === "hls" && showTimeline && !liveEdgePinned;
  const displayTimelineAtLiveEdge = isLiveStream && liveEdgePinned;
  const showTapForSound = !effectiveBackgroundPlayEnabled && !error && !needsClick && (volume === 0 || videoRef.current?.muted === true);
  const timelineDuration = Math.max(0, timelineEnd - timelineStart);
  const visibleTimelinePosition = Math.max(0, clampedTimelinePosition - timelineStart);
  const overlayTitleLabel = (overlayTitle ?? "").trim();
  const effectiveNativeControls = showNativeControls && !showAuxControls;
  const visibleNote = useMemo(() => {
    if (!note) return null;
    const normalized = note.toLowerCase();
    if (normalized.includes("low-latency")) return null;
    return note;
  }, [note]);

  const requestPictureInPictureFromGesture = async () => {
    const video = videoRef.current as PictureInPictureVideo | null;
    if (!video || typeof document === "undefined") return false;
    const pipDoc = document as PictureInPictureDocument;
    try {
      if (pipDoc.pictureInPictureElement === video || video.webkitPresentationMode === "picture-in-picture") {
        setIsPip(true);
        return true;
      }
      if (
        pipDoc.pictureInPictureEnabled &&
        !video.disablePictureInPicture &&
        typeof video.requestPictureInPicture === "function"
      ) {
        await video.requestPictureInPicture();
        setIsPip(true);
        return true;
      }
      if (typeof video.webkitSetPresentationMode === "function") {
        video.webkitSetPresentationMode("picture-in-picture");
        const active = (video as { webkitPresentationMode?: string }).webkitPresentationMode === "picture-in-picture";
        setIsPip(active);
        return active;
      }
    } catch {
      // ignore unsupported or policy-blocked PiP requests
    }
    return false;
  };

  const exitPictureInPictureMode = async () => {
    const video = videoRef.current as PictureInPictureVideo | null;
    if (!video || typeof document === "undefined") return false;
    const pipDoc = document as PictureInPictureDocument;
    try {
      if (pipDoc.pictureInPictureElement && typeof pipDoc.exitPictureInPicture === "function") {
        await pipDoc.exitPictureInPicture();
        setIsPip(false);
        return true;
      }
      if (video.webkitPresentationMode === "picture-in-picture" && typeof video.webkitSetPresentationMode === "function") {
        video.webkitSetPresentationMode("inline");
        setIsPip(false);
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  };

  const togglePip = async () => {
    if (isPip) {
      await exitPictureInPictureMode();
      return;
    }
    await requestPictureInPictureFromGesture();
  };

  const toggleFullscreen = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (!document.fullscreenElement) {
        await video.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  };

  const jumpToLive = () => {
    const video = videoRef.current;
    if (!video || !hasSeekWindow) return;
    const hlsLiveSyncPosition = hlsRef.current?.liveSyncPosition;
    const target =
      typeof hlsLiveSyncPosition === "number" && Number.isFinite(hlsLiveSyncPosition)
        ? Math.min(timelineEnd, Math.max(timelineStart, hlsLiveSyncPosition))
        : Math.max(timelineStart, timelineEnd - 0.35);
    try {
      video.currentTime = target;
      setTimelinePosition(target);
      setLiveEdgePinned(true);
      void video.play().catch(() => {
        // ignore autoplay restrictions
      });
    } catch {
      // ignore
    }
  };

  const unmuteFromGesture = () => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.max(0.05, Math.min(1, lastAudibleVolumeRef.current || 1));
    setVolume(next);
    setUnmuteHintPhase("hidden");
    try {
      video.muted = false;
      video.volume = next;
    } catch {
      // ignore
    }
  };

    const enableBackgroundPlayFromGesture = () => {
      const video = videoRef.current;
      setBackgroundPlayEnabled(true);
      if (backgroundPlayEnabledOverride === undefined) writeBackgroundPlayPreference(true);
      userPausedPlaybackRef.current = false;
      configureAudioSessionForPlayback();
      if (!video) return;

    setNeedsClick(false);
    unmuteFromGesture();
    void video.play().catch(() => {
      setStatus("Click to play");
      setNeedsClick(true);
    });
    if (isMobilePlayback) {
      void requestPictureInPictureFromGesture();
    }
  };

  const toggleBackgroundPlay = () => {
    if (effectiveBackgroundPlayEnabled) {
      setBackgroundPlayEnabled(false);
      if (backgroundPlayEnabledOverride === undefined) writeBackgroundPlayPreference(false);
      return;
    }
    enableBackgroundPlayFromGesture();
  };

    const togglePlayPause = () => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused || video.ended) {
        userPausedPlaybackRef.current = false;
        void video.play().catch(() => {
          // ignore autoplay restrictions
        });
        return;
      }
      userPausedPlaybackRef.current = true;
      video.pause();
    };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (volume === 0) {
      unmuteFromGesture();
      return;
    }
    setVolume(0);
    try {
      video.muted = true;
      video.volume = 0;
    } catch {
      // ignore
    }
  };

  const handleKeyDownRef = useRef<((e: KeyboardEvent) => void) | undefined>(undefined);
  handleKeyDownRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }
    const key = e.key.toLowerCase();
    if (key === "f") {
      e.preventDefault();
      void toggleFullscreen();
    } else if (key === "k" || key === " ") {
      if (key === " ") e.preventDefault();
      togglePlayPause();
    } else if (key === "m") {
      e.preventDefault();
      toggleMute();
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => handleKeyDownRef.current?.(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleVideoSurfaceInteraction = () => {
    const video = videoRef.current;
    if (!video) return;

    const currentlyMuted = video.muted || volume === 0;
    const currentlyPaused = video.paused || video.ended;

    if (needsClick || currentlyMuted || currentlyPaused) {
      const shouldUnmuteAfterPlay = currentlyMuted || needsClick;
      setNeedsClick(false);
      if (shouldUnmuteAfterPlay) unmuteFromGesture();
      if (currentlyPaused || needsClick) userPausedPlaybackRef.current = false;
      const playPromise = currentlyPaused || needsClick ? video.play() : Promise.resolve();
      void playPromise.catch(() => {
        if (shouldUnmuteAfterPlay) {
          setVolume(0);
          try {
            video.muted = true;
            video.volume = 0;
          } catch {
            // ignore
          }
          void video.play().catch(() => {
            setStatus("Click to play");
            setNeedsClick(true);
          });
          return;
        }
        setStatus("Click to play");
        setNeedsClick(true);
      });
      if (isMobilePlayback) {
        revealMobileControls();
      }
      return;
    }

    // 2. The video is actively playing and unmuted
    if (isMobilePlayback) {
      // Mobile: Tap toggles the overlay controls
      if (mobileControlsVisible) {
        setMobileControlsVisible(false);
        if (mobileControlsHideTimerRef.current) {
          clearTimeout(mobileControlsHideTimerRef.current);
          mobileControlsHideTimerRef.current = null;
        }
      } else {
        revealMobileControls();
      }
    } else {
      // Desktop: Clicking the video surface pauses it
      userPausedPlaybackRef.current = true;
      video.pause();
      setStatus("Paused");
    }
  };

  return (
    <div className={`relative w-full ${layoutMode === "fill" ? "flex h-full min-h-[24rem] flex-col" : ""}`}>
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`group/player relative w-full bg-black rounded-2xl overflow-hidden border border-neutral-800 ${
          layoutMode === "fill" ? "min-h-[16rem] flex-1" : "aspect-video"
        }`}
      >
        {!nsfwConsented && contentWarningReason && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-3xl text-center px-4">
            <span className="bg-red-900 border border-red-500 text-red-100 text-sm px-3 py-1 uppercase rounded-lg font-bold mb-3 shadow-[0_0_20px_rgba(220,38,38,0.4)]">18+ Explicit Content</span>
            <p className="text-sm text-neutral-300 max-w-[80%] mb-5 !leading-relaxed">
              This broadcast contains mature material restricted by the broadcaster:<br />
              <strong className="text-white">&ldquo;{contentWarningReason}&rdquo;</strong>
            </p>
            <button
              onClick={() => {
                setNsfwConsented(true);
                if (videoRef.current) {
                  videoRef.current.play().catch(() => {});
                }
              }}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition"
            >
              I Agree, Reveal Content
            </button>
          </div>
        )}
        <video
          ref={videoRef}
          className={`relative z-0 block h-full w-full cursor-pointer object-contain ${!nsfwConsented ? 'opacity-0' : 'opacity-100'}`}
          playsInline
          controls={effectiveNativeControls && nsfwConsented}
          muted={volume === 0}
          onClick={handleVideoSurfaceInteraction}
        >
          {captionTrackList.map((track, index) => (
            <track
              key={`${track.src}-${track.lang}-${index}`}
              kind="subtitles"
              src={track.src}
              srcLang={track.lang}
              label={track.label}
              default={track.isDefault}
            />
          ))}
        </video>

        {needsClick && !error && (
          <button
            type="button"
            onClick={handleVideoSurfaceInteraction}
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
          >
            <div className="px-4 py-2 rounded-xl bg-neutral-950/70 border border-neutral-700 text-sm text-neutral-200">
              Click to play
            </div>
          </button>
        )}

                {showAuxControls && !error && !needsClick && (viewerCount !== undefined || p2pPeers !== undefined) && (
          <div
            className={`absolute inset-x-0 top-0 z-20 flex flex-row items-start justify-end bg-gradient-to-b from-black/80 via-black/30 to-transparent pt-4 pb-12 px-4 pointer-events-none transition-opacity duration-200 ${
              isMobilePlayback
                ? mobileControlsVisible
                  ? "opacity-100"
                  : "opacity-0"
                : "opacity-0 group-hover/player:opacity-100"
            }`}
          >
            <div className="flex bg-neutral-900/60 backdrop-blur border border-white/10 rounded-xl overflow-hidden text-[11px] font-mono font-medium tracking-wide">
              {viewerCount !== undefined && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 border-r border-white/10 text-neutral-300">
                  <Users className="w-3.5 h-3.5" />
                  {viewerCount} Live
                </div>
              )}
              {p2pPeers !== undefined && (
                <div className="flex items-center px-3 py-1.5 text-neutral-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-2 animate-pulse" />
                  {p2pPeers} P2P
                </div>
              )}
            </div>
          </div>
        )}

        {showAuxControls && !error && !needsClick && (
          <div
            data-testid="player-controls"
            className={`absolute inset-x-0 bottom-0 z-30 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/40 to-transparent pt-12 pb-3 px-4 transition-opacity duration-200 ${
              isMobilePlayback
                ? mobileControlsVisible
                  ? "opacity-100 pointer-events-auto"
                  : "opacity-0 pointer-events-none"
                : "opacity-0 group-hover/player:opacity-100 pointer-events-auto"
            }`}
          >
            {hasSeekWindow && (
              <div
                className="w-full flex items-center mb-1 relative group/scrubber h-5 cursor-pointer"
                data-testid="playback-timeline"
                data-live-edge-pinned={displayTimelineAtLiveEdge ? "true" : "false"}
                onClick={(e) => {
                  const video = videoRef.current;
                  if (!video) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const nextTime = timelineStart + ratio * timelineDuration;
                  const nextPinned = isLiveStream && timelineEnd - nextTime <= LIVE_EDGE_SCRUB_TOLERANCE_SEC;
                  video.currentTime = nextTime;
                  setTimelinePosition(nextTime);
                  setLiveEdgePinned(nextPinned);
                }}
              >
                <div className="absolute inset-y-0 tracking-area flex items-center w-full">
                  <input
                    type="range"
                    min={timelineStart}
                    max={timelineEnd}
                    step={0.01}
                    value={displayTimelineAtLiveEdge ? timelineEnd : clampedTimelinePosition}
                    onChange={(e) => {
                      const video = videoRef.current;
                      if (!video) return;
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next)) return;
                      try {
                        const nextPinned = isLiveStream && timelineEnd - next <= LIVE_EDGE_SCRUB_TOLERANCE_SEC;
                        video.currentTime = next;
                        setTimelinePosition(next);
                        setLiveEdgePinned(nextPinned);
                      } catch {}
                    }}
                    className="absolute z-10 w-full h-full opacity-0 cursor-pointer touch-none"
                    aria-label="Seek"
                  />
                  <div className="w-full h-1 bg-white/30 rounded-full overflow-hidden relative transition-all duration-200 group-hover/scrubber:h-1.5">
                    <div 
                      className="absolute top-0 bottom-0 left-0 bg-blue-500 rounded-full" 
                      style={{ width: `${displayTimelineAtLiveEdge ? 100 : (visibleTimelinePosition / timelineDuration) * 100}%` }}
                    />
                  </div>
                  {/* Playhead thumb */}
                  <div 
                    data-testid="playback-playhead"
                    className="absolute w-3 h-3 bg-blue-500 rounded-full transform -translate-x-1/2 scale-0 group-hover/scrubber:scale-100 transition-transform duration-100 pointer-events-none"
                    style={{ left: `${displayTimelineAtLiveEdge ? 100 : (visibleTimelinePosition / timelineDuration) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex w-full items-center justify-between gap-2 mt-1 text-xs text-neutral-200">
              <div className="flex shrink-0 items-center gap-1 sm:gap-3">
                <button
                  type="button"
                  onClick={togglePlayPause}
                  className="w-8 h-8 flex items-center justify-center hover:bg-neutral-800 rounded-xl transition"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-white text-white" />
                  ) : (
                    <Play className="w-4 h-4 fill-white text-white" />
                  )}
                </button>

                <div className="group/vol relative flex items-center h-8">
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="w-8 h-8 flex items-center justify-center hover:bg-neutral-800 rounded-xl transition"
                    aria-label={volume === 0 ? "Unmute" : "Mute"}
                  >
                    {volume === 0 ? <VolumeX className="w-4 h-4 text-white" /> : <Volume2 className="w-4 h-4 text-white" />}
                  </button>
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full pb-2 opacity-0 pointer-events-none group-hover/vol:opacity-100 group-hover/vol:pointer-events-auto transition-all duration-[140ms] delay-[140ms] group-hover/vol:delay-0 z-30 touch-none flex flex-col items-center justify-center">
                    <div className="bg-black/90 border border-neutral-700 rounded-xl py-3 px-2 flex flex-col items-center justify-center shadow-xl">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        className="accent-blue-500 rounded-full cursor-pointer touch-none"
                        aria-label="Volume"
                        style={{ 
                          writingMode: 'vertical-lr', 
                          direction: 'rtl', 
                          height: '80px', 
                          WebkitAppearance: 'slider-vertical' as any,
                          appearance: 'slider-vertical' as any
                        }}
                      />
                      <span className="font-mono text-[10px] text-neutral-400 mt-2">{Math.round(volume * 100)}%</span>
                    </div>
                  </div>
                </div>

                <div className="font-mono text-[11px] text-neutral-200 tabular-nums">
                  {displayTimelineAtLiveEdge ? (
                    "Live"
                  ) : (
                    <>
                      {formatPlaybackTime(visibleTimelinePosition)}
                      {hasSeekWindow && <span className="opacity-60 text-neutral-400"> / {formatPlaybackTime(timelineDuration)}</span>}
                    </>
                  )}
                </div>
              </div>

              <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-3">
                {isLiveStream && showTimeline && (
                  <button
                    type="button"
                    onClick={jumpToLive}
                    disabled={!canJumpToLive}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] uppercase font-bold tracking-wider transition ${
                      canJumpToLive ? "text-neutral-500 hover:text-white cursor-pointer" : "text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]"
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${canJumpToLive ? "bg-neutral-600" : "bg-white"}`} />
                    Live
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setLowLatencyEnabled((cur) => !cur)}
                  disabled={playbackMode !== "hls" || stableHlsCompatibilityMode}
                  title={
                    stableHlsCompatibilityMode
                      ? "Stable playback is required for this source or browser"
                      : "Toggle low-latency playback"
                  }
                  className={`flex shrink-0 items-center gap-1.5 px-1.5 sm:px-2 py-1 rounded-md text-[11px] font-bold transition ${
                    effectiveLowLatencyEnabled ? "text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]" : "text-neutral-500 hover:text-white cursor-pointer"
                  } disabled:opacity-50`}
                >
                  <Gauge className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Low-Latency</span>
                </button>

                <button
                  type="button"
                  onClick={toggleBackgroundPlay}
                  className={`flex shrink-0 items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg border text-[11px] font-semibold transition ${
                    effectiveBackgroundPlayEnabled
                      ? "bg-white/10 border-white/20 text-white"
                      : "hover:bg-neutral-800 border-transparent text-neutral-400 hover:text-neutral-200"
                  }`}
                  title="Keep audio playing when the app is backgrounded"
                >
                  <Headphones className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">BG Audio</span>
                  <span>{effectiveBackgroundPlayEnabled ? "On" : "Off"}</span>
                </button>

                <select
                  value={String(selectedQuality)}
                  onChange={(e) => setSelectedQuality(Number(e.target.value))}
                  className="min-w-0 max-w-20 bg-transparent hover:bg-neutral-800 border border-transparent hover:border-neutral-700 rounded-lg px-1 sm:px-2 py-1 text-[11px] font-semibold text-neutral-300 cursor-pointer focus:outline-none transition-colors"
                  disabled={playbackMode !== "hls"}
                  title="Quality"
                >
                  <option className="bg-neutral-900" value="-1">Auto {qualityIndicator !== "Auto" && selectedQuality < 0 ? `(${qualityIndicator})` : ""}</option>
                  {qualityOptions.map((q) => (
                    <option className="bg-neutral-900" key={q.value} value={q.value}>
                      {q.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => void togglePip()}
                  disabled={!canTogglePip}
                  className="shrink-0 p-1.5 rounded-lg hover:bg-neutral-800 transition disabled:opacity-50 text-neutral-300"
                  title="Picture in Picture"
                  aria-label="Picture in Picture"
                >
                  <PictureInPicture2 className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => void toggleFullscreen()}
                  className="p-1.5 -mr-1 rounded-lg hover:bg-neutral-800 transition text-neutral-300 hover:text-white"
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {showTapForSound && unmuteHintPhase !== "hidden" && (
          <div
            className={`pointer-events-none absolute inset-0 m-auto w-fit h-fit z-10 inline-flex flex-col items-center justify-center gap-3 rounded-2xl border border-neutral-500/40 bg-neutral-800/70 p-6 text-sm font-semibold text-neutral-100 shadow-2xl backdrop-blur-md transition-opacity duration-500 ${
              unmuteHintPhase === "fading" ? "opacity-0" : "opacity-100"
            }`}
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-neutral-700/60 text-white shadow-inner">
              <svg viewBox="0 0 24 24" className="h-6 w-6 ml-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path d="m17 9 4 6" />
                <path d="m21 9-4 6" />
              </svg>
            </span>
            <span className="tracking-wide">Tap to play sound</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6 text-center">
            <div className="space-y-3">
              <p className="text-white font-semibold">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-sm"
              >
                Reload
              </button>
            </div>
          </div>
        )}
      </div>

      {visibleNote && !error && <div className="mt-2 text-xs text-neutral-400">{visibleNote}</div>}

    </div>
  );
}
