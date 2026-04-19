"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HandCoins, Maximize2, Move, PictureInPicture2, Volume2, VolumeX, X, Play, Pause, Users } from "lucide-react";
import { GlobalPlayerSlot, useGlobalPlayer } from "@/context/GlobalPlayerContext";
import { useQuickPlay } from "@/context/QuickPlayContext";
import { useStreamPresence } from "@/hooks/useStreamPresence";
import { useStreamAnnounce } from "@/hooks/useStreamAnnounce";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { makeOriginStreamId } from "@/lib/origin";
import { deriveQuickPlayPlaybackStateKey } from "@/lib/quickplay";
import { buildWatchHref } from "@/lib/watchHref";

const STORAGE_KEY = "dstream_mini_player_layout_v3";
const BACKGROUND_PLAY_PREF_KEY = "dstream_player_background_play_v1";
const MIN_WIDTH = 240;
const MAX_WIDTH = 960;
const DEFAULT_WIDTH = 320;
const DEFAULT_GAP = 24;
const AUTO_PIP_RETRY_MS = 1200;
const AUTO_PIP_MAX_ATTEMPTS = 8;
const AUTO_RESUME_RETRY_MS = 500;
const AUTO_RESUME_MAX_ATTEMPTS = 12;
const DRAG_BLOCK_SELECTOR = "video,button,a,input,select,textarea,label,[role='button'],[data-no-drag='true']";

type ResizeHandle = "top_left" | "top_right" | "bottom_right" | "bottom_left";

type LayoutState = {
  width: number;
  x: number;
  y: number;
  volume: number;
  muted: boolean;
};

type PipCapableVideo = HTMLVideoElement & {
  webkitSetPresentationMode?: (mode: "inline" | "picture-in-picture" | "fullscreen") => void;
  webkitPresentationMode?: string;
  disablePictureInPicture?: boolean;
  requestPictureInPicture?: () => Promise<void>;
};

function toHeight(width: number): number {
  return Math.round((width * 9) / 16);
}

function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function clampPosition(x: number, y: number, width: number, height: number) {
  if (typeof window === "undefined") return { x, y };
  const horizontalSpill = 24;
  const verticalSpill = 24;
  const minX = -width + horizontalSpill;
  const maxX = window.innerWidth - horizontalSpill;
  const minY = -height + verticalSpill;
  const maxY = window.innerHeight - verticalSpill;
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y))
  };
}

function readLayoutState(): LayoutState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    if (!parsed || typeof parsed !== "object") return null;
    const width = clampWidth(Number(parsed.width ?? DEFAULT_WIDTH));
    const height = toHeight(width);
    const position = clampPosition(Number(parsed.x ?? DEFAULT_GAP), Number(parsed.y ?? DEFAULT_GAP), width, height);
    return {
      width,
      x: position.x,
      y: position.y,
      volume: clampVolume(Number(parsed.volume ?? 1)),
      muted: parsed.muted === true
    };
  } catch {
    return null;
  }
}

function writeLayoutState(next: LayoutState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function isTouchDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
}

function isDragBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest(DRAG_BLOCK_SELECTOR);
}

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

export function GlobalQuickPlayDock() {
  const pathname = usePathname();
  const isWatchRoute = pathname?.startsWith("/watch/") ?? false;
  const { quickPlayStream, clearQuickPlayStream } = useQuickPlay();
  const { clearRequest } = useGlobalPlayer();

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [position, setPosition] = useState({
    x: DEFAULT_GAP,
    y: typeof window === "undefined" ? DEFAULT_GAP : window.innerHeight - toHeight(DEFAULT_WIDTH) - DEFAULT_GAP
  });
  const [ready, setReady] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [backgroundPlayEnabled, setBackgroundPlayEnabled] = useState(false);
  const [interactionMode, setInteractionMode] = useState<"idle" | "drag" | "resize">("idle");
  const [touchDevice, setTouchDevice] = useState(false);

  const { viewerCount } = useStreamPresence({
    streamPubkey: quickPlayStream?.streamPubkey ?? "",
    streamId: quickPlayStream?.streamId ?? ""
  });
  const { announce } = useStreamAnnounce({
    pubkey: quickPlayStream?.streamPubkey ?? "",
    streamId: quickPlayStream?.streamId ?? ""
  });
  const effectiveViewerCount = Math.max(viewerCount, announce?.currentParticipants ?? 0);

  // Timeline tracking
  const [timelinePosition, setTimelinePosition] = useState(0);
  const [timelineDuration, setTimelineDuration] = useState(0);
  const [isAtLiveEdge, setIsAtLiveEdge] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const resizeRef = useRef<{
    handle: ResizeHandle;
    startMouseX: number;
    startMouseY: number;
    startWidth: number;
    startHeight: number;
    startX: number;
    startY: number;
  } | null>(null);
  const pipActiveRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const autoPipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPipAttemptsRef = useRef(0);
  const autoPipAttemptKeyRef = useRef<string | null>(null);
  const autoResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoResumeAttemptsRef = useRef(0);
  const autoResumeAttemptKeyRef = useRef<string | null>(null);

  const height = useMemo(() => toHeight(width), [width]);
  const originStreamId = useMemo(() => {
    if (!quickPlayStream) return null;
    return makeOriginStreamId(quickPlayStream.streamPubkey, quickPlayStream.streamId);
  }, [quickPlayStream]);

  const hlsSrc = useMemo(() => {
    const explicit = quickPlayStream?.hlsUrl?.trim();
    if (explicit) return explicit;
    if (!originStreamId) return null;
    return `/api/hls/${encodeURIComponent(originStreamId)}/index.m3u8`;
  }, [originStreamId, quickPlayStream?.hlsUrl]);

  const whepSrc = useMemo(() => {
    const explicit = quickPlayStream?.whepUrl?.trim();
    if (explicit) return explicit;
    if (!originStreamId) return null;
    return `/api/whep/${encodeURIComponent(originStreamId)}/whep`;
  }, [originStreamId, quickPlayStream?.whepUrl]);

  const watchHref = quickPlayStream
    ? buildWatchHref(quickPlayStream.streamPubkey, quickPlayStream.streamId)
    : null;
  const tipHref = watchHref ? `${watchHref}?tip=1` : null;
  const playbackStateKey = useMemo(() => {
    if (!quickPlayStream) return undefined;
    return deriveQuickPlayPlaybackStateKey({
      pubkey: quickPlayStream.streamPubkey,
      streamId: quickPlayStream.streamId,
      hlsUrl: hlsSrc
    });
  }, [hlsSrc, quickPlayStream]);

  const clearAutoPipTimer = useCallback(() => {
    if (!autoPipTimerRef.current) return;
    clearTimeout(autoPipTimerRef.current);
    autoPipTimerRef.current = null;
  }, []);

  const clearAutoResumeTimer = useCallback(() => {
    if (!autoResumeTimerRef.current) return;
    clearTimeout(autoResumeTimerRef.current);
    autoResumeTimerRef.current = null;
  }, []);

  const requestSystemPip = useCallback(async () => {
    const video = videoRef.current as PipCapableVideo | null;
    if (!video) return false;

    try {
      const doc = document as Document & {
        pictureInPictureElement?: Element;
        pictureInPictureEnabled?: boolean;
        exitPictureInPicture?: () => Promise<void>;
      };
      if (doc.pictureInPictureElement === video) {
        setPipActive(true);
        return true;
      }
      if (
        doc.pictureInPictureEnabled &&
        !video.disablePictureInPicture &&
        typeof video.requestPictureInPicture === "function"
      ) {
        await video.requestPictureInPicture();
        setPipActive(true);
        return true;
      }
      if (typeof video.webkitSetPresentationMode === "function") {
        video.webkitSetPresentationMode("picture-in-picture");
        const active = video.webkitPresentationMode === "picture-in-picture";
        setPipActive(active);
        return active;
      }
    } catch {
      // ignore
    }

    return false;
  }, []);

  useEffect(() => {
    setTouchDevice(isTouchDevice());
    setBackgroundPlayEnabled(readBackgroundPlayPreference());
  }, []);

  useEffect(() => {
    writeBackgroundPlayPreference(backgroundPlayEnabled);
  }, [backgroundPlayEnabled]);

  useEffect(() => {
    if (ready || typeof window === "undefined") return;
    const saved = readLayoutState();
    if (saved) {
      setWidth(saved.width);
      setPosition({ x: saved.x, y: saved.y });
      setVolume(saved.volume);
      setMuted(saved.muted);
      setReady(true);
      return;
    }
    const defaultHeight = toHeight(DEFAULT_WIDTH);
    setWidth(DEFAULT_WIDTH);
    setPosition({
      x: DEFAULT_GAP,
      y: Math.max(DEFAULT_GAP, window.innerHeight - defaultHeight - DEFAULT_GAP)
    });
    setVolume(1);
    setMuted(false);
    setReady(true);
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    writeLayoutState({
      width,
      x: position.x,
      y: position.y,
      volume,
      muted
    });
  }, [ready, width, position.x, position.y, volume, muted]);

  useEffect(() => {
    if (!ready) return;
    const onResize = () => {
      setPosition((prev) => clampPosition(prev.x, prev.y, width, toHeight(width)));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ready, width]);

  useEffect(() => {
    const host = playerHostRef.current;
    if (!host) return;

    const attachVideo = () => {
      const found = host.querySelector("video");
      if (!(found instanceof HTMLVideoElement)) return;
      if (videoRef.current === found) return;
      videoRef.current = found;

      try {
        setVolume(found.muted ? 0 : found.volume);
        setMuted(found.muted || found.volume === 0);
      } catch {
        // ignore
      }

      const onVolumeChange = () => {
        try {
          const nextVolume = found.muted ? 0 : clampVolume(found.volume);
          setMuted(found.muted || nextVolume === 0);
          setVolume(nextVolume);
        } catch {
          // ignore
        }
      };
      const onEnterPip = () => setPipActive(true);
      const onLeavePip = () => setPipActive(false);
      const onWebkitPip = () => {
        const webkitMode = (found as HTMLVideoElement & { webkitPresentationMode?: string }).webkitPresentationMode;
        setPipActive(webkitMode === "picture-in-picture");
      };

      const onTimeUpdate = () => {
        try {
          const ct = found.currentTime;
          let newPos = ct;
          let dur = 0;
          let isLiveEdge = false;
          
          if (found.seekable.length > 0) {
            const end = found.seekable.end(found.seekable.length - 1);
            if (!Number.isNaN(end) && Number.isFinite(end)) {
               dur = end;
               const liveLag = Math.max(0, end - ct);
               if (liveLag <= 12.0) {
                   isLiveEdge = true;
                   newPos = dur;
               }
            }
          }
          
          if (found.duration && Number.isFinite(found.duration) && found.duration > dur) {
            dur = found.duration;
          }
          
          setIsAtLiveEdge(isLiveEdge);
          setTimelinePosition(newPos);
          setTimelineDuration(dur);
        } catch { }
      };

      const onPlayState = () => setIsPlaying(!found.paused);
      setIsPlaying(!found.paused);

      found.addEventListener("volumechange", onVolumeChange);
      found.addEventListener("enterpictureinpicture", onEnterPip as any);
      found.addEventListener("leavepictureinpicture", onLeavePip as any);
      found.addEventListener("webkitpresentationmodechanged", onWebkitPip as any);
      found.addEventListener("timeupdate", onTimeUpdate);
      found.addEventListener("progress", onTimeUpdate);
      found.addEventListener("play", onPlayState);
      found.addEventListener("pause", onPlayState);

      if (
        (document as Document & { pictureInPictureElement?: Element }).pictureInPictureElement === found ||
        (found as HTMLVideoElement & { webkitPresentationMode?: string }).webkitPresentationMode === "picture-in-picture"
      ) {
        setPipActive(true);
      }
    };

    attachVideo();
    const observer = new MutationObserver(attachVideo);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [hlsSrc, muted, volume, whepSrc]);

  useEffect(() => {
    pipActiveRef.current = pipActive;
  }, [pipActive]);

  useEffect(() => {
    return () => {
      clearAutoPipTimer();
      clearAutoResumeTimer();
    };
  }, [clearAutoPipTimer, clearAutoResumeTimer]);

  useEffect(() => {
    if (!ready || isWatchRoute || !quickPlayStream || !hlsSrc || touchDevice) {
      clearAutoPipTimer();
      return;
    }

    const attemptKey = `${quickPlayStream.streamPubkey}:${quickPlayStream.streamId}:${pathname ?? ""}`;
    if (autoPipAttemptKeyRef.current === attemptKey) return;
    autoPipAttemptKeyRef.current = attemptKey;
    autoPipAttemptsRef.current = 0;

    const attempt = async () => {
      if (pipActiveRef.current) {
        clearAutoPipTimer();
        return;
      }
      autoPipAttemptsRef.current += 1;
      const ok = await requestSystemPip();
      if (ok || autoPipAttemptsRef.current >= AUTO_PIP_MAX_ATTEMPTS) {
        clearAutoPipTimer();
        return;
      }
      autoPipTimerRef.current = setTimeout(() => {
        void attempt();
      }, AUTO_PIP_RETRY_MS);
    };

    autoPipTimerRef.current = setTimeout(() => {
      void attempt();
    }, 350);

    return () => clearAutoPipTimer();
  }, [clearAutoPipTimer, hlsSrc, isWatchRoute, pathname, quickPlayStream, ready, requestSystemPip, touchDevice]);

  useEffect(() => {
    if (!ready || isWatchRoute || !quickPlayStream || !hlsSrc) {
      clearAutoResumeTimer();
      return;
    }

    const attemptKey = `${quickPlayStream.streamPubkey}:${quickPlayStream.streamId}:${pathname ?? ""}:${hlsSrc}:${whepSrc ?? ""}`;
    if (autoResumeAttemptKeyRef.current === attemptKey) return;
    autoResumeAttemptKeyRef.current = attemptKey;
    autoResumeAttemptsRef.current = 0;

    const attempt = async () => {
      const video = videoRef.current;
      if (!video) {
        if (autoResumeAttemptsRef.current >= AUTO_RESUME_MAX_ATTEMPTS) {
          clearAutoResumeTimer();
          return;
        }
        autoResumeAttemptsRef.current += 1;
        autoResumeTimerRef.current = setTimeout(() => {
          void attempt();
        }, AUTO_RESUME_RETRY_MS);
        return;
      }

      if (!video.paused && !video.ended) {
        clearAutoResumeTimer();
        return;
      }

      autoResumeAttemptsRef.current += 1;
      try {
        await video.play();
        clearAutoResumeTimer();
        return;
      } catch {
        // fallback to muted autoplay
      }

      try {
        video.muted = true;
        video.volume = 0;
      } catch {
        // ignore
      }
      setMuted(true);
      setVolume(0);
      try {
        await video.play();
        clearAutoResumeTimer();
        return;
      } catch {
        // keep retrying while we still have budget
      }

      if (autoResumeAttemptsRef.current >= AUTO_RESUME_MAX_ATTEMPTS) {
        clearAutoResumeTimer();
        return;
      }

      autoResumeTimerRef.current = setTimeout(() => {
        void attempt();
      }, AUTO_RESUME_RETRY_MS);
    };

    autoResumeTimerRef.current = setTimeout(() => {
      void attempt();
    }, 160);

    return () => clearAutoResumeTimer();
  }, [clearAutoResumeTimer, hlsSrc, isWatchRoute, pathname, quickPlayStream, ready, whepSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.volume = clampVolume(volume);
      video.muted = muted || clampVolume(volume) === 0;
    } catch {
      // ignore
    }
  }, [muted, volume]);

  useEffect(() => {
    if (interactionMode === "idle") return;

    const onMove = (e: MouseEvent | TouchEvent) => {
      e.stopPropagation();
      const isTouch = "touches" in e;
      const clientX = isTouch ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = isTouch ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;

      if (interactionMode === "drag") {
        const nextX = clientX - dragOffsetRef.current.x;
        const nextY = clientY - dragOffsetRef.current.y;
        setPosition(clampPosition(nextX, nextY, width, height));
        return;
      }

      const activeResize = resizeRef.current;
      if (!activeResize) return;

      const deltaX = clientX - activeResize.startMouseX;
      const deltaY = clientY - activeResize.startMouseY;

      let nextWidth = activeResize.startWidth;
      if (activeResize.handle.includes("right")) {
        nextWidth = clampWidth(activeResize.startWidth + deltaX);
      } else if (activeResize.handle.includes("left")) {
        nextWidth = clampWidth(activeResize.startWidth - deltaX);
        if (nextWidth <= MIN_WIDTH) nextWidth = MIN_WIDTH;
        if (nextWidth >= MAX_WIDTH) nextWidth = MAX_WIDTH;
      } else if (activeResize.handle.includes("bottom")) {
        const potentialWidth = Math.round(((activeResize.startHeight + deltaY) * 16) / 9);
        nextWidth = clampWidth(potentialWidth);
      } else {
        const potentialWidth = Math.round(((activeResize.startHeight - deltaY) * 16) / 9);
        nextWidth = clampWidth(potentialWidth);
      }
      const nextHeight = toHeight(nextWidth);

      let nextX = activeResize.startX;
      let nextY = activeResize.startY;
      if (activeResize.handle.includes("left")) {
        nextX = activeResize.startX + (activeResize.startWidth - nextWidth);
      }
      if (activeResize.handle.includes("top")) {
        nextY = activeResize.startY + (activeResize.startHeight - nextHeight);
      }

      const clamped = clampPosition(nextX, nextY, nextWidth, nextHeight);
      setWidth(nextWidth);
      setPosition(clamped);
    };

    const onUp = () => {
      resizeRef.current = null;
      setInteractionMode("idle");
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [height, interactionMode, width]);

  const handleContainerMouseDown = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      const isTouch = "touches" in event;
      if (!isTouch && (event as React.MouseEvent).button !== 0) return;
      if (isDragBlockedTarget(event.target)) return;

      if (!isTouch) {
        event.preventDefault();
      }
      event.stopPropagation();
      
      const clientX = isTouch ? (event as React.TouchEvent).touches[0].clientX : (event as React.MouseEvent).clientX;
      const clientY = isTouch ? (event as React.TouchEvent).touches[0].clientY : (event as React.MouseEvent).clientY;

      dragOffsetRef.current = { x: clientX - position.x, y: clientY - position.y };
      setInteractionMode("drag");
    },
    [position.x, position.y]
  );

  const handleResizeStart = useCallback(
    (event: React.MouseEvent, handle: ResizeHandle) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      resizeRef.current = {
        handle,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        startWidth: width,
        startHeight: height,
        startX: position.x,
        startY: position.y
      };
      setInteractionMode("resize");
    },
    [height, position.x, position.y, width]
  );

  const handleVolumeInput = useCallback((next: number) => {
    const value = clampVolume(next);
    setVolume(value);
    setMuted(value === 0);
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => !prev);
    if (volume === 0) setVolume(0.7);
  }, [volume]);

  const handleSeek = useCallback((next: number) => {
    if (videoRef.current) {
       videoRef.current.currentTime = next;
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) videoRef.current.play();
      else videoRef.current.pause();
    }
  }, []);

  const jumpToLive = useCallback(() => {
    if (videoRef.current && videoRef.current.seekable.length > 0) {
      const end = videoRef.current.seekable.end(videoRef.current.seekable.length - 1);
      videoRef.current.currentTime = end;
    }
  }, []);

  const handleTogglePip = useCallback(async () => {
    const video = videoRef.current as PipCapableVideo | null;
    if (!video) return;
    const doc = document as Document & {
      pictureInPictureElement?: Element;
      pictureInPictureEnabled?: boolean;
      exitPictureInPicture?: () => Promise<void>;
    };

    try {
      if (doc.pictureInPictureElement) {
        if (typeof doc.exitPictureInPicture === "function") await doc.exitPictureInPicture();
        setPipActive(false);
        return;
      }
      if (await requestSystemPip()) return;
      if (typeof video.webkitSetPresentationMode === "function") {
        const currentMode = video.webkitPresentationMode;
        const nextMode = currentMode === "picture-in-picture" ? "inline" : "picture-in-picture";
        video.webkitSetPresentationMode(nextMode);
        setPipActive(nextMode === "picture-in-picture");
      }
    } catch {
      // ignore
    }
  }, [requestSystemPip]);

  const globalPlayerProps = useMemo(() => ({
    src: hlsSrc,
    whepSrc,
    autoplayMuted: false,
    backgroundPlayEnabledOverride: backgroundPlayEnabled,
    isLiveStream: true,
    showTimelineControls: false,
    showAuxControls: false,
    showNativeControls: false,
    playbackStateKey
  }), [backgroundPlayEnabled, hlsSrc, playbackStateKey, whepSrc]);

  useEffect(() => {
    if (!quickPlayStream) {
       clearRequest("quickplay-dock");
    }
  }, [quickPlayStream, clearRequest]);

  if (!ready || isWatchRoute || !quickPlayStream || !hlsSrc) return null;

  return (
    <div
      onMouseDown={handleContainerMouseDown}
      onTouchStart={handleContainerMouseDown}
      style={{ left: position.x, top: position.y, width, height, position: "fixed", touchAction: "none" }}
      className={`z-[9999] bg-black rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 flex flex-col group backdrop-blur-xl ring-1 ring-white/20 select-none ${
        interactionMode === "drag" ? "cursor-grabbing" : interactionMode === "resize" ? "cursor-move" : "cursor-grab"
      }`}
      aria-label="Floating mini player"
    >
      <div ref={playerHostRef} className="h-full relative pointer-events-none select-none">
        <GlobalPlayerSlot
          id="quickplay-dock"
          playerProps={globalPlayerProps}
        />
        <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-2xl pointer-events-none" />
      </div>

      <div
        className={`absolute inset-0 z-20 flex flex-col pointer-events-none transition-opacity duration-150 ${
          touchDevice ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <div className="p-3 bg-gradient-to-b from-black/80 to-transparent flex items-center gap-3 pointer-events-auto">
          <div className="p-1.5 bg-white/10 rounded-lg">
            <Move className="w-3 h-3 text-white" />
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            {watchHref ? (
              <Link
                href={watchHref}
                onMouseDown={(event) => event.stopPropagation()}
                className="min-w-0 flex-1 rounded-lg px-1 py-0.5 hover:bg-white/10 transition"
                title="Open full stream page"
                aria-label="Open full stream page"
              >
                <p className="text-[10px] font-bold text-white truncate leading-none mb-1">NOW WATCHING</p>
                <div className="flex items-center gap-2 max-w-full">
                  <p className="truncate text-xs font-medium leading-none text-white/70">
                    {quickPlayStream.title || "Live stream"}
                  </p>
                  {effectiveViewerCount > 0 && (
                    <span className="flex-shrink-0 inline-flex items-center gap-1 text-[9px] font-bold text-red-400 bg-red-400/10 px-1 py-0.5 rounded leading-none pt-0.5">
                      <Users className="w-2.5 h-2.5" />
                      {effectiveViewerCount}
                    </span>
                  )}
                </div>
              </Link>
            ) : (
              <div className="min-w-0 flex-1 px-1 py-0.5">
                <p className="text-[10px] font-bold text-white truncate leading-none mb-1">NOW WATCHING</p>
                <div className="flex items-center gap-2 max-w-full">
                  <p className="truncate text-xs font-medium leading-none text-white/70">
                    {quickPlayStream.title || "Live stream"}
                  </p>
                  {effectiveViewerCount > 0 && (
                    <span className="flex-shrink-0 inline-flex items-center gap-1 text-[9px] font-bold text-red-400 bg-red-400/10 px-1 py-0.5 rounded leading-none pt-0.5">
                      <Users className="w-2.5 h-2.5" />
                      {effectiveViewerCount}
                    </span>
                  )}
                </div>
              </div>
            )}
            {tipHref ? (
              <Link
                href={tipHref}
                onMouseDown={(event) => event.stopPropagation()}
                className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-emerald-400/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200 transition"
                title="Tip this streamer"
                aria-label="Tip this streamer"
              >
                <HandCoins className="h-3 w-3" />
              </Link>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void handleTogglePip();
              }}
              className={`p-2 hover:bg-white/10 rounded-xl transition-all active:scale-95 ${pipActive ? "text-blue-400" : "text-white/60 hover:text-white"}`}
              title={pipActive ? "Exit Picture-in-Picture" : "Picture-in-Picture"}
              aria-label="Toggle picture-in-picture"
            >
              <PictureInPicture2 className="w-4 h-4" />
            </button>
            {watchHref ? (
              <Link
                href={watchHref}
                onMouseDown={(event) => event.stopPropagation()}
                className="p-2 hover:bg-white/10 rounded-xl text-white/60 hover:text-white transition-all active:scale-95"
                title="Open full stream page"
                aria-label="Open full stream page"
              >
                <Maximize2 className="w-4 h-4" />
              </Link>
            ) : null}
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                clearQuickPlayStream();
              }}
              className="p-2 hover:bg-blue-500/20 rounded-xl text-white/60 hover:text-red-500 transition-all active:scale-95"
              title="Close mini player"
              aria-label="Close mini player"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mt-auto p-2 pt-8 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
          <div className="flex items-end gap-3 pointer-events-auto w-full">
            
            <button 
                onClick={togglePlay} 
                className="pb-1 px-1 text-white hover:text-white/80 active:scale-95 transition-all outline-none"
                aria-label={isPlaying ? "Pause" : "Play"}
            >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>
            <div className="flex-1 flex flex-col justify-end gap-1.5 pb-1">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={jumpToLive}
                  disabled={isAtLiveEdge}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] uppercase font-bold tracking-widest transition ${
                    !isAtLiveEdge ? "text-neutral-500 hover:text-white cursor-pointer" : "text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]"
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${!isAtLiveEdge ? "bg-neutral-600" : "bg-white"}`} />
                  Live
                </button>
                <div className="text-[10px] font-mono text-white/50">{Math.floor(timelinePosition / 60)}:{(Math.floor(timelinePosition) % 60).toString().padStart(2, '0')}</div>
              </div>
              
              <div className="relative w-full h-1.5 bg-white/10 rounded-full group/timeline">
                <input
                  type="range"
                  min={0}
                  max={timelineDuration || 1}
                  step={0.1}
                  value={timelinePosition}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 touch-none peer"
                  aria-label="Seek timeline"
                />
                <div 
                  className="absolute left-0 top-0 bottom-0 bg-blue-500 rounded-full transition-all duration-100 ease-out z-0 group-hover/timeline:bg-blue-400" 
                  style={{ width: `${isAtLiveEdge ? 100 : Math.min(100, (timelinePosition / (timelineDuration || 1)) * 100)}%` }} 
                />
              </div>
            </div>

            <div className="flex flex-col gap-1 items-center relative">
              <button
                type="button"
                onClick={() => setBackgroundPlayEnabled((current) => !current)}
                className={`rounded-lg border px-1 py-1 text-[10px] font-semibold transition z-10 ${
                  backgroundPlayEnabled
                    ? "border-blue-400/60 bg-blue-500/20 text-blue-100"
                    : "border-white/20 bg-black/40 text-white/75 hover:text-white"
                }`}
                title="Keep audio playing when app/browser is backgrounded"
                aria-label={`Background play ${backgroundPlayEnabled ? "on" : "off"}`}
              >
                BG
              </button>

              <div className="group/vol relative flex flex-col items-center">
                <div className="absolute bottom-full pb-1 opacity-0 pointer-events-none group-hover/vol:opacity-100 group-hover/vol:pointer-events-auto transition-all duration-[140ms] delay-[140ms] group-hover/vol:delay-0 z-30 touch-none flex flex-col items-center justify-center">
                  <div className="bg-black/90 border border-neutral-700 rounded-xl py-3 px-2 flex flex-col items-center justify-center shadow-[0_4px_24px_rgba(0,0,0,0.8)]">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={muted ? 0 : volume}
                      onChange={(event) => handleVolumeInput(Number(event.target.value))}
                      className="accent-white rounded-full cursor-pointer touch-none"
                      aria-label="Volume"
                      style={{ 
                        writingMode: 'vertical-lr', 
                        direction: 'rtl', 
                        height: '60px', 
                        WebkitAppearance: 'slider-vertical' as any,
                        appearance: 'slider-vertical' as any
                      }}
                    />
                  </div>
                </div>
                
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className="rounded-lg border border-white/20 bg-black/40 px-2 py-1.5 text-white/90 hover:text-white relative z-20"
                  title={muted || volume === 0 ? "Unmute" : "Mute"}
                  aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                >
                  {muted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {!touchDevice ? (
          <>
            <button
              type="button"
              data-no-drag="true"
              onMouseDown={(event) => handleResizeStart(event, "top_left")}
              className="absolute top-0 left-0 w-7 h-7 pointer-events-auto cursor-nwse-resize flex items-start justify-start p-0.5"
              title="Resize mini player"
              aria-label="Resize mini player from top-left"
            />
            <button
              type="button"
              data-no-drag="true"
              onMouseDown={(event) => handleResizeStart(event, "top_right")}
              className="absolute top-0 right-0 w-7 h-7 pointer-events-auto cursor-nesw-resize flex items-start justify-end p-0.5"
              title="Resize mini player"
              aria-label="Resize mini player from top-right"
            />
            <button
              type="button"
              data-no-drag="true"
              onMouseDown={(event) => handleResizeStart(event, "bottom_right")}
              className="absolute bottom-0 right-0 w-7 h-7 pointer-events-auto cursor-nwse-resize flex items-end justify-end p-0.5"
              title="Resize mini player"
              aria-label="Resize mini player from bottom-right"
            />
            <button
              type="button"
              data-no-drag="true"
              onMouseDown={(event) => handleResizeStart(event, "bottom_left")}
              className="absolute bottom-0 left-0 w-7 h-7 pointer-events-auto cursor-nesw-resize flex items-end justify-start p-0.5"
              title="Resize mini player"
              aria-label="Resize mini player from bottom-left"
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
