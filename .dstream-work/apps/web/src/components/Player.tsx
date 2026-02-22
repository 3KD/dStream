"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Hls from "hls.js";
import { P2PFragmentLoader } from "@/lib/p2p/hlsFragmentLoader";
import type { P2PSwarm } from "@/lib/p2p/swarm";
import type { IntegritySession } from "@/lib/integrity/session";
import { WhepClient } from "@/lib/whep";
import { pickPlaybackMode } from "@/lib/whep-fallback";

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

function formatQualityLabel(level: { width?: number; height?: number; bitrate?: number }): string {
  const height = typeof level.height === "number" && level.height > 0 ? `${level.height}p` : null;
  const bitrate =
    typeof level.bitrate === "number" && level.bitrate > 0 ? `${Math.max(1, Math.round(level.bitrate / 1000))} kbps` : null;
  if (height && bitrate) return `${height} (${bitrate})`;
  if (height) return height;
  if (bitrate) return bitrate;
  return "Unknown";
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
  auxMetaSlot,
  captionTracks
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const whepRef = useRef<WhepClient | null>(null);
  const playbackModeRef = useRef<"hls" | "whep">("hls");
  const onReadyRef = useRef(onReady);
  const selectedQualityRef = useRef(-1);
  const [status, setStatus] = useState<string>("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [needsClick, setNeedsClick] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<"hls" | "whep">("hls");
  const [note, setNote] = useState<string | null>(null);
  const isMobilePlayback = useMemo(() => isLikelyMobilePlaybackDevice(), []);
  const effectiveAutoplayMuted = isMobilePlayback ? true : (autoplayMuted ?? true);
  const [lowLatencyEnabled, setLowLatencyEnabled] = useState(false);
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([]);
  const [selectedQuality, setSelectedQuality] = useState(-1);
  const [qualityIndicator, setQualityIndicator] = useState("Auto");
  const [volume, setVolume] = useState(() => (effectiveAutoplayMuted ? 0 : 1));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [timelineStart, setTimelineStart] = useState(0);
  const [timelineEnd, setTimelineEnd] = useState(0);
  const [timelinePosition, setTimelinePosition] = useState(0);
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
    const backupSrc = (fallbackSrc ?? "").trim();
    const canUseBackup = backupSrc.length > 0 && backupSrc !== primarySrc;
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
      return startHls(backupSrc);
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

    const startHls = (hlsSource: string): boolean => {
      setPlaybackMode("hls");

      // Prefer native HLS (Safari is typically more reliable without hls.js),
      // unless integrity verification is enabled (we need byte access).
      if (!integrityEnabled && video.canPlayType("application/vnd.apple.mpegurl")) {
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
      if (endpoint) setNote("Integrity verification enabled (using HLS path).");
      startHls(primarySrc);
    } else if (isMobilePlayback) {
      if (endpoint) setNote("Mobile compatibility mode (HLS preferred).");
      const startedHls = startHls(primarySrc);
      if (!startedHls && endpoint && rtcSupported) {
        void (async () => {
          const ok = await tryWhep();
          if (!ok && !cancelled) {
            setError("Playback unavailable in this mobile browser.");
            setStatus("Error");
          }
        })();
      }
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
        if (attemptedWhep) setNote("Low-latency unavailable (falling back to HLS).");
        startHls(primarySrc);
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
  }, [effectiveAutoplayMuted, fallbackSrc, integrity, isMobilePlayback, lowLatencyEnabled, p2pSwarm, playbackStateKey, src, whepSrc]);

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
        setTimelineStart(Math.max(0, start));
        setTimelineEnd(Math.max(0, end));
        setTimelinePosition(Math.max(0, currentTime));
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
  }, [src, playbackMode]);

  const hasSeekWindow = timelineEnd > timelineStart + 1;
  const showTimeline = showTimelineControls && hasSeekWindow;
  const clampedTimelinePosition = Math.min(Math.max(timelinePosition, timelineStart), timelineEnd || timelineStart);
  const liveLagSeconds = Math.max(0, timelineEnd - clampedTimelinePosition);
  const canJumpToLive = isLiveStream && playbackMode === "hls" && showTimeline && liveLagSeconds > 1.5;
  const isAtLiveEdge = !isLiveStream || !showTimeline || liveLagSeconds <= 1.5;
  const showTapForSound = !error && volume === 0;
  const lowLatencyHint =
    (whepSrc ?? "").trim().length > 0 && playbackMode === "hls"
      ? "Stability mode (HLS preferred). Enable low-latency mode to try WHEP."
      : undefined;

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

  return (
    <div className={`relative w-full ${layoutMode === "fill" ? "flex h-full min-h-[24rem] flex-col" : ""}`}>
      <div
        data-testid="player-status"
        className="pointer-events-none absolute top-2 right-2 z-20 px-2 py-1 rounded bg-black/60 text-xs text-neutral-200 border border-white/10"
      >
        {error ? "Error" : playbackMode === "whep" ? `${status} • Low latency` : status}
      </div>

      <div
        className={`group/player relative w-full bg-black rounded-2xl overflow-hidden border border-neutral-800 ${
          layoutMode === "fill" ? "min-h-[16rem] flex-1" : "aspect-video"
        }`}
      >
        <video ref={videoRef} className="w-full h-full" playsInline controls={showNativeControls} autoPlay muted={volume === 0}>
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
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              void video.play().catch(() => {
                setStatus("Click to play");
                setNeedsClick(true);
              });
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
          >
            <div className="px-4 py-2 rounded-xl bg-neutral-950/70 border border-neutral-700 text-sm text-neutral-200">
              Click to play
            </div>
          </button>
        )}

        {showTapForSound && !needsClick && (
          <button
            type="button"
            onClick={() => {
              const video = videoRef.current;
              setVolume(1);
              if (!video) return;
              try {
                video.muted = false;
                video.volume = 1;
              } catch {
                // ignore
              }
              void video.play().catch(() => {
                // ignore
              });
            }}
            className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-neutral-950/80 border border-neutral-700 text-xs text-neutral-100 hover:bg-neutral-900/90"
          >
            Tap for sound
          </button>
        )}

        {showAuxControls && !error && !needsClick && (
          <div
            className={`absolute bottom-3 left-3 right-3 z-20 transition-opacity duration-150 ${
              isMobilePlayback
                ? "opacity-100 pointer-events-auto"
                : "opacity-0 pointer-events-none group-hover/player:opacity-100 group-hover/player:pointer-events-auto group-focus-within/player:opacity-100 group-focus-within/player:pointer-events-auto"
            }`}
          >
            <div className="rounded-xl border border-neutral-700/80 bg-black/75 backdrop-blur px-3 py-2 text-xs text-neutral-200">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2">
                  <span className="text-neutral-400">Volume</span>
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

                <label className="inline-flex items-center gap-2" title={lowLatencyHint}>
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

      {note && !error && <div className="mt-2 text-xs text-neutral-400">{note}</div>}

      {showTimeline && (
        <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="font-mono text-neutral-500">
              Window: {Math.max(0, Math.round(timelineEnd - timelineStart))}s
            </div>
            {isLiveStream && (
              <div
                className={`font-mono ${isAtLiveEdge ? "text-emerald-300" : "text-amber-300"}`}
                title={isAtLiveEdge ? "At live edge" : "Behind live"}
              >
                {isAtLiveEdge ? "LIVE" : `-${Math.round(liveLagSeconds)}s`}
              </div>
            )}
          </div>
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
            className="w-full accent-blue-500"
            aria-label="Playback timeline"
          />
          {isLiveStream && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={jumpToLive}
                disabled={!canJumpToLive}
                className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-50 text-xs"
              >
                Back to Live
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
