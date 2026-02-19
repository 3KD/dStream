"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  captionTracks
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const whepRef = useRef<WhepClient | null>(null);
  const onReadyRef = useRef(onReady);
  const selectedQualityRef = useRef(-1);
  const [status, setStatus] = useState<string>("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [needsClick, setNeedsClick] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<"hls" | "whep">("hls");
  const [note, setNote] = useState<string | null>(null);
  const isMobilePlayback = useMemo(() => isLikelyMobilePlaybackDevice(), []);
  const effectiveAutoplayMuted = isMobilePlayback ? true : (autoplayMuted ?? true);
  const [lowLatencyEnabled, setLowLatencyEnabled] = useState(() => !isLikelyMobilePlaybackDevice());
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
    setVolume(effectiveAutoplayMuted ? 0 : 1);
  }, [effectiveAutoplayMuted]);

  useEffect(() => {
    selectedQualityRef.current = selectedQuality;
  }, [selectedQuality]);

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
    const onPlaying = () => {
      setNeedsClick(false);
      setStatus("Playing");
    };
    const onWaiting = () => {
      setStatus((prev) => (prev === "Click to play" ? prev : "Buffering…"));
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);

    const integrityEnabled = !!integrity?.enabled;

    const startHls = (hlsSource: string): boolean => {
      setPlaybackMode("hls");

      // Prefer native HLS (Safari is typically more reliable without hls.js),
      // unless integrity verification is enabled (we need byte access).
      if (!integrityEnabled && video.canPlayType("application/vnd.apple.mpegurl")) {
        const onLoaded = () => {
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
        const { mode, attemptedWhep } = await pickPlaybackMode({ whepSrc: endpoint, rtcSupported, tryWhep });
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
      } catch {
        // ignore
      }
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
  }, [effectiveAutoplayMuted, fallbackSrc, integrity, isMobilePlayback, lowLatencyEnabled, p2pSwarm, src, whepSrc]);

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
    <div className="relative w-full">
      <div
        data-testid="player-status"
        className="pointer-events-none absolute -top-4 right-2 px-2 py-1 rounded bg-black/60 text-xs text-neutral-200 border border-white/10"
      >
        {error ? "Error" : playbackMode === "whep" ? `${status} • Low latency` : status}
      </div>

      <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-neutral-800">
        <video ref={videoRef} className="w-full h-full" playsInline controls autoPlay muted={volume === 0}>
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

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-300">
        <label className="inline-flex items-center gap-2">
          <span className="text-neutral-500">Volume</span>
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
          <span className="font-mono text-neutral-400 w-8 text-right">{Math.round(volume * 100)}%</span>
        </label>

        <label className="inline-flex items-center gap-2">
          <span className="text-neutral-500">Quality</span>
          <select
            value={String(selectedQuality)}
            onChange={(e) => setSelectedQuality(Number(e.target.value))}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-xs"
            disabled={playbackMode !== "hls"}
          >
            <option value="-1">Auto</option>
            {qualityOptions.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
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
          onClick={() => void togglePip()}
          disabled={!canTogglePip}
          className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-50"
        >
          {isPip ? "Exit PiP" : "PiP"}
        </button>

        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800"
        >
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </button>

        {isLiveStream && showTimeline && (
          <button
            type="button"
            onClick={jumpToLive}
            disabled={!canJumpToLive}
            className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-50"
          >
            Back to Live
          </button>
        )}

        <span className="font-mono text-neutral-500">Quality: {qualityIndicator}</span>
        {captionTrackList.length > 0 && <span className="font-mono text-neutral-500">Captions: {captionTrackList.length}</span>}
      </div>
    </div>
  );
}
