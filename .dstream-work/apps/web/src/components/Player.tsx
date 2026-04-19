"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Hls from "hls.js";
import { P2PFragmentLoader } from "@/lib/p2p/hlsFragmentLoader";
import type { P2PSwarm } from "@/lib/p2p/swarm";
import type { IntegritySession } from "@/lib/integrity/session";
import { WhepClient } from "@/lib/whep";
import { pickPlaybackMode } from "@/lib/whep-fallback";
import { inferMediaUrlKind } from "@/lib/mediaUrl";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Users } from "lucide-react";

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

type PlaybackMode = "hls" | "whep" | "direct";

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

const BACKGROUND_PLAY_PREF_KEY = "dstream_player_background_play_v1";

function readBackgroundPlayPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(BACKGROUND_PLAY_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function writeBackgroundPlayPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BACKGROUND_PLAY_PREF_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
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

function isLikelySafariBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  if (!/Safari/i.test(ua)) return false;
  if (/Chrome|Chromium|CriOS|FxiOS|Firefox|Edg|OPR|SamsungBrowser|Android/i.test(ua)) return false;
  return true;
}

function isExternalPlaybackUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const whepRef = useRef<WhepClient | null>(null);
  const playbackModeRef = useRef<PlaybackMode>("hls");
  const onReadyRef = useRef(onReady);
  const selectedQualityRef = useRef(-1);

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
  const [isHovered, setIsHovered] = useState(false);
  const [preferNativeHls, setPreferNativeHls] = useState(false);

  useEffect(() => {
    setIsMobilePlayback(isLikelyMobilePlaybackDevice());
    setPreferNativeHls(isLikelySafariBrowser());
  }, []);

  const effectiveAutoplayMuted = isMobilePlayback ? true : (autoplayMuted ?? true);
  const [lowLatencyEnabled, setLowLatencyEnabled] = useState(false);
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([]);
  const [selectedQuality, setSelectedQuality] = useState(-1);
  const [qualityIndicator, setQualityIndicator] = useState("Auto");
  const [volume, setVolume] = useState(() => (effectiveAutoplayMuted ? 0 : 1));
  const lastAudibleVolumeRef = useRef(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mobileControlsVisible, setMobileControlsVisible] = useState(false);
  const mobileControlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unmuteHintPhase, setUnmuteHintPhase] = useState<"hidden" | "visible" | "fading">("hidden");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [backgroundPlayEnabled, setBackgroundPlayEnabled] = useState(false);
  const [timelineStart, setTimelineStart] = useState(0);
  const [timelineEnd, setTimelineEnd] = useState(0);
  const [timelinePosition, setTimelinePosition] = useState(0);
  const LIVE_EDGE_PIN_TOLERANCE_SEC = 8.0;
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
      setVolume(persistedMuted ? 0 : persistedVolume);
      return;
    }
    setVolume(effectiveAutoplayMuted ? 0 : 1);
  }, [effectiveAutoplayMuted, playbackStateKey]);

  useEffect(() => {
    setBackgroundPlayEnabled(readBackgroundPlayPreference());
  }, []);

  useEffect(() => {
    writeBackgroundPlayPreference(backgroundPlayEnabled);
  }, [backgroundPlayEnabled]);

  const effectiveBackgroundPlayEnabled = backgroundPlayEnabledOverride ?? backgroundPlayEnabled;

  useEffect(() => {
    selectedQualityRef.current = selectedQuality;
  }, [selectedQuality]);

  useEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);

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
    const video = videoRef.current;
    if (!video) return;
    try {
      video.volume = Math.min(1, Math.max(0, volume));
      video.muted = volume === 0;
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
      }, 2300);
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
    }, 2300);
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
        void video.play().catch(() => {
          // ignore
        });
      });
      mediaSession.setActionHandler("pause", () => {
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
  }, [isLiveStream, src]);

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
    if (typeof document === "undefined" || !effectiveBackgroundPlayEnabled) return;
    const video = videoRef.current;
    if (!video) return;
    const keepPlaybackAlive = () => {
      if (document.visibilityState !== "hidden") return;
      if (video.ended) return;
      if (!video.paused) return;
      void video.play().catch(() => {
        // ignore browser policy failures
      });
    };
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const onPause = () => {
      if (document.visibilityState !== "hidden") return;
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(keepPlaybackAlive, 120);
    };
    document.addEventListener("visibilitychange", keepPlaybackAlive);
    video.addEventListener("pause", onPause);
    return () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      document.removeEventListener("visibilitychange", keepPlaybackAlive);
      video.removeEventListener("pause", onPause);
    };
  }, [effectiveBackgroundPlayEnabled]);

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
  }, [error, needsClick, volume, src, whepSrc]);

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
  }, [src, whepSrc]);

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
  }, [playbackStateKey, src, whepSrc]);

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setIsPip(true);
    const onLeave = () => setIsPip(false);
    video.addEventListener("enterpictureinpicture", onEnter as any);
    video.addEventListener("leavepictureinpicture", onLeave as any);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter as any);
      video.removeEventListener("leavepictureinpicture", onLeave as any);
    };
  }, []);

  useEffect(() => {
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

    const primarySrc = (src ?? "").trim();
    const primaryKind = inferMediaUrlKind(primarySrc);
    const backupSrc = (fallbackSrc ?? "").trim();
    const canUseBackup = backupSrc.length > 0 && backupSrc !== primarySrc && !isExternalPlaybackUrl(primarySrc);
    let backupTried = false;

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
    let cancelled = false;
    const persistedPlayback = readPersistedPlaybackState(playbackStateKeyRef.current);
    const persistedResumeTime =
      persistedPlayback && typeof persistedPlayback.currentTime === "number" && Number.isFinite(persistedPlayback.currentTime)
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
    let whepFallbackInProgress = false;
    let whepStallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearWhepStallTimer = () => {
      if (!whepStallTimer) return;
      clearTimeout(whepStallTimer);
      whepStallTimer = null;
    };
    const tryHlsBackup = (reason: string, beforeStart?: () => void): boolean => {
      if (!canUseBackup || backupTried || cancelled) return false;
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

    const startHls = (hlsSource: string): boolean => {
      let mediaRecoveryAttempts = 0;
      setPlaybackMode("hls");

      // Prefer native HLS (Safari is typically more reliable without hls.js),
      // unless integrity verification is enabled (we need byte access).
      if (!integrityEnabled && preferNativeHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        const onLoaded = () => {
          applyPersistedSeek();
          setStatus("Ready");
          sendReady();
        };
        const onNativeError = () => {
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
        video.addEventListener("loadedmetadata", onLoaded);
        video.addEventListener("error", onNativeError);
        video.src = hlsSource;
        void video.play().catch(() => {
          setStatus("Click to play");
          setNeedsClick(true);
        });
        removeNativeListener = () => {
          video.removeEventListener("loadedmetadata", onLoaded);
          video.removeEventListener("error", onNativeError);
        };
        return true;
      }

      if (!Hls.isSupported()) {
        setError("HLS not supported in this browser.");
        return false;
      }

      const integrityRewrite =
        integrityEnabled && hlsSource.includes("/api/dev/tamper-hls/")
          ? { from: "/api/dev/tamper-hls/", to: "/api/hls/" }
          : null;
      const hls = new Hls({
        startPosition: persistedResumeTime !== null ? Math.max(0, persistedResumeTime) : -1,
        enableWorker: true,
        manifestLoadingMaxRetry: 30,
        manifestLoadingRetryDelay: 500,
        manifestLoadingMaxRetryTimeout: 8000,
        levelLoadingMaxRetry: 30,
        levelLoadingRetryDelay: 500,
        levelLoadingMaxRetryTimeout: 8000,
        fragLoadingMaxRetry: 30,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 8000,
        maxBufferLength: lowLatencyEnabled ? 30 : 90,
        backBufferLength: lowLatencyEnabled ? 30 : 90,
        liveSyncDurationCount: lowLatencyEnabled ? 3 : 5,
        liveMaxLatencyDurationCount: lowLatencyEnabled ? 5 : 8,
        fLoader: P2PFragmentLoader,
        lowLatencyMode: lowLatencyEnabled,
        dstreamRefs: dstreamRefs,
        dstreamIntegrityHttpRewrite: integrityRewrite
      } as any);
      hlsRef.current = hls;

      hls.loadSource(hlsSource);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
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
        setStatus("Ready");
        sendReady();
        void video.play().catch(() => {
          setStatus("Click to play");
          setNeedsClick(true);
        });
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const idx = typeof data?.level === "number" ? data.level : -1;
        if (idx < 0) return;
        const level = hls.levels[idx];
        const current = level ? formatQualityLabel(level) : "Unknown";
        setQualityIndicator(selectedQualityRef.current < 0 ? `Auto · ${current}` : current);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (
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
            setError(null);
            setStatus("Retrying…");
            setTimeout(() => {
              try {
                hls.startLoad();
              } catch {
                // ignore
              }
            }, 350);
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            setError(null);
            setStatus("Recovering…");
            mediaRecoveryAttempts++;
            try {
              if (mediaRecoveryAttempts <= 1) {
                  hls.recoverMediaError();
              } else if (mediaRecoveryAttempts === 2) {
                  hls.swapAudioCodec();
                  hls.recoverMediaError();
              } else {
                  hls.destroy();
                  setTimeout(() => {
                      startBestEffort(hlsSource);
                  }, 1000);
              }
            } catch {
              // ignore
            }
            break;
          default:
            setError("Fatal player error.");
            hls.destroy();
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

    const endpoint = (whepSrc ?? "").trim();
    const rtcSupported = typeof RTCPeerConnection !== "undefined";
    const tryWhep = async () => {
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
          preferLowLatency: lowLatencyEnabled,
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
      try {
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("waiting", onWaiting);
        video.removeEventListener("stalled", onStalled);
        video.removeEventListener("error", onErrorFallback);
      } catch {
        // ignore
      }
      clearWhepStallTimer();
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
        const v = videoRef.current;
        if (v) {
          v.pause();
          v.removeAttribute("src");
          v.load();
        }
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMobilePlayback,
    lowLatencyEnabled,
    preferNativeHls,
    src,
    whepSrc
  ]);

  const canTogglePip = typeof document !== "undefined" && "pictureInPictureEnabled" in document;

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
        const nearLiveEdge =
          isLiveStream &&
          normalizedEnd > normalizedStart + 1 &&
          normalizedCurrent >= normalizedEnd - LIVE_EDGE_PIN_TOLERANCE_SEC;

        setTimelineStart(normalizedStart);
        setTimelineEnd(normalizedEnd);
        setTimelinePosition(nearLiveEdge ? normalizedEnd : normalizedCurrent);
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
  }, [isLiveStream, playbackMode, src]);

  const hasSeekWindow = timelineEnd > timelineStart + 1;
  const showTimeline = showTimelineControls && hasSeekWindow;
  const clampedTimelinePosition = Math.min(Math.max(timelinePosition, timelineStart), timelineEnd || timelineStart);
  const liveLagSeconds = Math.max(0, timelineEnd - clampedTimelinePosition);
  const canJumpToLive = isLiveStream && playbackMode === "hls" && showTimeline && liveLagSeconds > 8.0;
  const isAtLiveEdge = !isLiveStream || !showTimeline || liveLagSeconds <= 8.0;
  const showTapForSound = !error && !needsClick && (volume === 0 || videoRef.current?.muted === true);
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

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if ((document as any).pictureInPictureEnabled && !(video as any).disablePictureInPicture) {
        await (video as any).requestPictureInPicture();
      }
    } catch {
      // ignore
    }
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
    const target = Math.max(timelineStart, timelineEnd - 0.35);
    try {
      video.currentTime = target;
      setTimelinePosition(target);
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

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      void video.play().catch(() => {
        // ignore autoplay restrictions
      });
      return;
    }
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

    // 1. If the video needs intervention (muted, paused, or requires click)
    // Any interaction immediately unmutes and plays.
    if (needsClick || currentlyMuted || currentlyPaused) {
      unmuteFromGesture();
      setNeedsClick(false);
      void video.play().catch(() => {
        setStatus("Click to play");
        setNeedsClick(true);
      });
      // On mobile, keep the menu hidden during the initial unmute tap
      if (isMobilePlayback) {
        setMobileControlsVisible(false);
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
              <strong className="text-white">"{contentWarningReason}"</strong>
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
          className={`w-full h-full cursor-pointer ${!nsfwConsented ? 'opacity-0' : 'opacity-100'}`}
          playsInline
          controls={effectiveNativeControls && nsfwConsented}
          autoPlay={nsfwConsented}
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
            className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
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
            className={`absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/40 to-transparent pt-12 pb-3 px-4 transition-opacity duration-200 ${
              isMobilePlayback
                ? mobileControlsVisible
                  ? "opacity-100 pointer-events-auto"
                  : "opacity-0 pointer-events-none"
                : "opacity-0 group-hover/player:opacity-100 pointer-events-auto"
            }`}
          >
            {hasSeekWindow && (
              <div className="w-full flex items-center mb-1 relative group/scrubber h-5 cursor-pointer" onClick={(e) => {
                const video = videoRef.current;
                if (!video) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const nextTime = timelineStart + ratio * timelineDuration;
                video.currentTime = nextTime;
                setTimelinePosition(nextTime);
              }}>
                <div className="absolute inset-y-0 tracking-area flex items-center w-full">
                  <input
                    type="range"
                    min={timelineStart}
                    max={timelineEnd}
                    step={0.01}
                    value={isAtLiveEdge ? timelineEnd : clampedTimelinePosition}
                    onChange={(e) => {
                      const video = videoRef.current;
                      if (!video) return;
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next)) return;
                      try {
                        video.currentTime = next;
                        setTimelinePosition(next);
                      } catch {}
                    }}
                    className="absolute z-10 w-full h-full opacity-0 cursor-pointer touch-none"
                    aria-label="Seek"
                  />
                  <div className="w-full h-1 bg-white/30 rounded-full overflow-hidden relative transition-all duration-200 group-hover/scrubber:h-1.5">
                    <div 
                      className="absolute top-0 bottom-0 left-0 bg-blue-500 rounded-full" 
                      style={{ width: `${isAtLiveEdge ? 100 : (visibleTimelinePosition / timelineDuration) * 100}%` }}
                    />
                  </div>
                  {/* Playhead thumb */}
                  <div 
                    className="absolute w-3 h-3 bg-blue-500 rounded-full transform -translate-x-1/2 scale-0 group-hover/scrubber:scale-100 transition-transform duration-100 pointer-events-none"
                    style={{ left: `${isAtLiveEdge ? 100 : (visibleTimelinePosition / timelineDuration) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between w-full mt-1 text-xs text-neutral-200">
              <div className="flex items-center gap-3">
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
                  {formatPlaybackTime(visibleTimelinePosition)}
                  {hasSeekWindow && <span className="opacity-60 text-neutral-400"> / {formatPlaybackTime(timelineDuration)}</span>}
                </div>
              </div>

              <div className="flex items-center gap-3">
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
                  disabled={playbackMode !== "hls"}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-bold tracking-wider transition ${
                    lowLatencyEnabled ? "text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]" : "text-neutral-500 hover:text-white cursor-pointer"
                  } disabled:opacity-50`}
                >
                  <div className={`w-2 h-2 rounded-full ${lowLatencyEnabled ? "bg-white" : "bg-neutral-600"}`} />
                  Low-Latency
                </button>

                <button
                  type="button"
                  onClick={() => setBackgroundPlayEnabled((current) => !current)}
                  className={`flex px-2 py-1 rounded-lg border text-[11px] font-semibold transition ${
                    effectiveBackgroundPlayEnabled
                      ? "bg-white/10 border-white/20 text-white"
                      : "hover:bg-neutral-800 border-transparent text-neutral-400 hover:text-neutral-200"
                  }`}
                  title="Keep audio playing when the app is backgrounded"
                >
                  BG Audio {effectiveBackgroundPlayEnabled ? "On" : "Off"}
                </button>

                <select
                  value={String(selectedQuality)}
                  onChange={(e) => setSelectedQuality(Number(e.target.value))}
                  className="bg-transparent hover:bg-neutral-800 border border-transparent hover:border-neutral-700 rounded-lg px-2 py-1 text-[11px] font-semibold text-neutral-300 cursor-pointer focus:outline-none transition-colors"
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
                  className="px-2 py-1 rounded-lg hover:bg-neutral-800 transition disabled:opacity-50 text-[11px] font-semibold text-neutral-300"
                  title="Picture in Picture"
                >
                  PiP
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
