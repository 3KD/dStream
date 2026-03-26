"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Hls from "hls.js";
import { P2PFragmentLoader } from "@/lib/p2p/hlsFragmentLoader";
import type { P2PSwarm } from "@/lib/p2p/swarm";
import type { IntegritySession } from "@/lib/integrity/session";
import { WhepClient } from "@/lib/whep";
import { pickPlaybackMode } from "@/lib/whep-fallback";
import { inferMediaUrlKind } from "@/lib/mediaUrl";

interface PlayerProps {
  src: string;
  fallbackSrc?: string | null;
  whepSrc?: string | null;
  p2pSwarm?: P2PSwarm | null;
  p2pOnly?: boolean;
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
  captionTracks?: Array<{
    src: string;
    lang: string;
    label: string;
    isDefault?: boolean;
  }>;
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
  p2pOnly,
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
  captionTracks
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const whepRef = useRef<WhepClient | null>(null);
  const playbackModeRef = useRef<PlaybackMode>("hls");
  const onReadyRef = useRef(onReady);
  const selectedQualityRef = useRef(-1);
  const [status, setStatus] = useState<string>("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [needsClick, setNeedsClick] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("hls");
  const [note, setNote] = useState<string | null>(null);
  const isMobilePlayback = useMemo(() => isLikelyMobilePlaybackDevice(), []);
  const preferNativeHls = useMemo(() => isLikelySafariBrowser(), []);
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
  const LIVE_EDGE_PIN_TOLERANCE_SEC = 1.5;
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
    const persisted = readPersistedPlaybackState(playbackStateKey);
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
    const persistedPlayback = readPersistedPlaybackState(playbackStateKey);
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
        fLoader: P2PFragmentLoader,
        lowLatencyMode: lowLatencyEnabled,
        dstreamP2PSwarm: p2pSwarm ?? null,
        dstreamP2POnly: !!p2pOnly,
        dstreamIntegritySession: integrity ?? null,
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
            try {
              hls.recoverMediaError();
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
    };
  }, [
    effectiveAutoplayMuted,
    fallbackSrc,
    integrity,
    isMobilePlayback,
    lowLatencyEnabled,
    p2pSwarm,
    playbackStateKey,
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
  const canJumpToLive = isLiveStream && playbackMode === "hls" && showTimeline && liveLagSeconds > 1.5;
  const isAtLiveEdge = !isLiveStream || !showTimeline || liveLagSeconds <= 1.5;
  const showTapForSound = !error && !needsClick && (volume === 0 || videoRef.current?.muted === true);
  const timelineDuration = Math.max(0, timelineEnd - timelineStart);
  const visibleTimelinePosition = Math.max(0, clampedTimelinePosition - timelineStart);
  const overlayTitleLabel = (overlayTitle ?? "").trim();
  const statusLabel = error ? "Error" : playbackMode === "whep" ? `${status} • Low latency` : status;
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

  const handleVideoSurfaceInteraction = () => {
    revealMobileControls();
    const video = videoRef.current;
    if (!video) return;

    const currentlyMuted = video.muted || volume === 0;
    const currentlyPaused = video.paused || video.ended;

    if (needsClick || currentlyMuted || currentlyPaused) {
      unmuteFromGesture();
      setNeedsClick(false);
      void video.play().catch(() => {
        setStatus("Click to play");
        setNeedsClick(true);
      });
      return;
    }

    setUnmuteHintPhase("hidden");
    setVolume(0);
    setStatus("Paused");
    try {
      video.muted = true;
      video.volume = 0;
      video.pause();
    } catch {
      video.pause();
    }
  };

  return (
    <div className={`relative w-full ${layoutMode === "fill" ? "flex h-full min-h-[24rem] flex-col" : ""}`}>
      <div
        className={`group/player relative w-full bg-black rounded-2xl overflow-hidden border border-neutral-800 ${
          layoutMode === "fill" ? "min-h-[16rem] flex-1" : "aspect-video"
        }`}
      >
        <video
          ref={videoRef}
          className="w-full h-full"
          playsInline
          controls={effectiveNativeControls}
          autoPlay
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

        {showAuxControls && !error && !needsClick && (
          <div
            className={`pointer-events-none absolute inset-x-3 top-3 bottom-3 z-20 flex items-end transition-opacity duration-150 ${
              isMobilePlayback
                ? mobileControlsVisible
                  ? "opacity-100"
                  : "opacity-0"
                : "opacity-0 group-hover/player:opacity-100"
            }`}
          >
            <div className="pointer-events-auto max-h-full w-full overflow-y-auto rounded-xl border border-neutral-700/80 bg-black/75 backdrop-blur px-3 py-2 text-xs text-neutral-200">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={togglePlayPause}
                  className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 min-w-[4.25rem]"
                >
                  {isPlaying ? "Pause" : "Play"}
                </button>

                {hasSeekWindow && (
                  <label className="inline-flex items-center gap-2 min-w-[13rem]">
                    <input
                      type="range"
                      min={timelineStart}
                      max={timelineEnd}
                      step={0.01}
                      value={clampedTimelinePosition}
                      onChange={(e) => {
                        const video = videoRef.current;
                        if (!video) return;
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        try {
                          video.currentTime = next;
                          setTimelinePosition(next);
                        } catch {
                          // ignore
                        }
                      }}
                      className="accent-blue-500 w-32"
                      aria-label="Seek"
                    />
                    <span className="font-mono text-neutral-300 text-[11px] tabular-nums whitespace-nowrap">
                      {formatPlaybackTime(visibleTimelinePosition)} / {formatPlaybackTime(timelineDuration)}
                    </span>
                  </label>
                )}

                {overlayTitleLabel && (
                  <span className="inline-flex max-w-[15rem] items-center truncate rounded-md border border-neutral-700/80 bg-black/70 px-2 py-1 text-[11px] text-neutral-200">
                    {overlayTitleLabel}
                  </span>
                )}

                <span
                  data-testid="player-status"
                  className="inline-flex items-center rounded-md border border-neutral-700/80 bg-black/70 px-2 py-1 font-mono text-[11px] text-neutral-200"
                >
                  {statusLabel}
                </span>

                {showTapForSound && (
                  <button
                    type="button"
                    onClick={() => {
                      unmuteFromGesture();
                      const video = videoRef.current;
                      if (!video) return;
                      void video.play().catch(() => {
                        // ignore
                      });
                    }}
                    className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700"
                  >
                    Tap for sound
                  </button>
                )}

                <label className="inline-flex items-center gap-2">
                  <span className="text-neutral-400">Volume</span>
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="px-2 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-[11px]"
                  >
                    {volume === 0 ? "Unmute" : "Mute"}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="accent-blue-500"
                    aria-label="Volume"
                  />
                  <span className="font-mono text-neutral-300 w-8 text-right">{Math.round(volume * 100)}%</span>
                </label>

                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={lowLatencyEnabled}
                    onChange={(e) => setLowLatencyEnabled(e.target.checked)}
                    className="accent-blue-500"
                    disabled={playbackMode !== "hls"}
                  />
                  <span>Low-latency mode</span>
                </label>

                <button
                  type="button"
                  onClick={() => setBackgroundPlayEnabled((current) => !current)}
                  className={`px-2.5 py-1 rounded-lg border ${
                    effectiveBackgroundPlayEnabled
                      ? "bg-blue-600/20 border-blue-500/50 text-blue-100"
                      : "bg-neutral-900 hover:bg-neutral-800 border-neutral-700 text-neutral-200"
                  }`}
                  title="Keep audio playing when the app is backgrounded (browser support varies)."
                >
                  Background play {effectiveBackgroundPlayEnabled ? "On" : "Off"}
                </button>

                <button
                  type="button"
                  onClick={() => void togglePip()}
                  disabled={!canTogglePip}
                  className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 disabled:opacity-50"
                >
                  {isPip ? "Exit PiP" : "PiP"}
                </button>

                <button
                  type="button"
                  onClick={() => void toggleFullscreen()}
                  className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700"
                >
                  {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                </button>

                {isLiveStream && showTimeline && (
                  <button
                    type="button"
                    onClick={jumpToLive}
                    disabled={!canJumpToLive}
                    className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 disabled:opacity-50"
                  >
                    Back to Live
                  </button>
                )}

                <label className="inline-flex items-center gap-2">
                  <span className="text-neutral-400">Quality</span>
                  <select
                    value={String(selectedQuality)}
                    onChange={(e) => setSelectedQuality(Number(e.target.value))}
                    className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-1 text-xs"
                    disabled={playbackMode !== "hls"}
                    title={qualityIndicator}
                  >
                    <option value="-1">Auto</option>
                    {qualityOptions.map((q) => (
                      <option key={q.value} value={q.value}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                </label>

                {captionTrackList.length > 0 && <span className="font-mono text-neutral-400">Captions: {captionTrackList.length}</span>}
                {auxMetaSlot ? <span className="ml-1 pl-2 border-l border-neutral-700">{auxMetaSlot}</span> : null}
              </div>
            </div>
          </div>
        )}

        {showTapForSound && unmuteHintPhase !== "hidden" && (
          <div
            className={`pointer-events-none absolute right-4 bottom-4 z-10 inline-flex items-center gap-2 rounded-full border border-neutral-500/40 bg-neutral-800/45 px-3 py-1.5 text-xs text-neutral-100 shadow-sm backdrop-blur-md transition-opacity duration-500 ${
              unmuteHintPhase === "fading" ? "opacity-0" : "opacity-100"
            }`}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-700/40 text-neutral-100/90">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path d="m17 9 4 6" />
                <path d="m21 9-4 6" />
              </svg>
            </span>
            <span>click to unmute</span>
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
