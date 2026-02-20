"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Move, PictureInPicture2, Volume2, VolumeX, X } from "lucide-react";
import { Player } from "@/components/Player";
import { useQuickPlay } from "@/context/QuickPlayContext";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { makeOriginStreamId } from "@/lib/origin";
import { deriveQuickPlayPlaybackStateKey } from "@/lib/quickplay";

const STORAGE_KEY = "dstream_mini_player_layout_v3";
const MIN_WIDTH = 240;
const MAX_WIDTH = 960;
const DEFAULT_WIDTH = 320;
const DEFAULT_GAP = 24;
const AUTO_PIP_RETRY_MS = 1200;
const AUTO_PIP_MAX_ATTEMPTS = 8;
const DRAG_BLOCK_SELECTOR = "button,a,input,select,textarea,label,[role='button'],[data-no-drag='true']";

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

export function GlobalQuickPlayDock() {
  const pathname = usePathname();
  const isWatchRoute = pathname?.startsWith("/watch/") ?? false;
  const { quickPlayStream, clearQuickPlayStream } = useQuickPlay();

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [position, setPosition] = useState({
    x: DEFAULT_GAP,
    y: typeof window === "undefined" ? DEFAULT_GAP : window.innerHeight - toHeight(DEFAULT_WIDTH) - DEFAULT_GAP
  });
  const [ready, setReady] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [interactionMode, setInteractionMode] = useState<"idle" | "drag" | "resize">("idle");
  const [touchDevice, setTouchDevice] = useState(false);

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
    ? `/watch/${pubkeyHexToNpub(quickPlayStream.streamPubkey) ?? quickPlayStream.streamPubkey}/${quickPlayStream.streamId}`
    : null;
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
  }, []);

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
        found.volume = clampVolume(volume);
        found.muted = muted || clampVolume(volume) === 0;
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

      found.addEventListener("volumechange", onVolumeChange);
      found.addEventListener("enterpictureinpicture", onEnterPip as any);
      found.addEventListener("leavepictureinpicture", onLeavePip as any);
      found.addEventListener("webkitpresentationmodechanged", onWebkitPip as any);

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
    return () => clearAutoPipTimer();
  }, [clearAutoPipTimer]);

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

    const onMove = (event: MouseEvent) => {
      if (interactionMode === "drag") {
        setPosition(() =>
          clampPosition(event.clientX - dragOffsetRef.current.x, event.clientY - dragOffsetRef.current.y, width, height)
        );
        return;
      }

      const activeResize = resizeRef.current;
      if (!activeResize) return;

      const dx = event.clientX - activeResize.startMouseX;
      const dy = event.clientY - activeResize.startMouseY;
      const horizontalSign = activeResize.handle.includes("left") ? -1 : 1;
      const verticalSign = activeResize.handle.includes("top") ? -1 : 1;
      const widthDeltaX = horizontalSign * dx;
      const widthDeltaY = verticalSign * dy * (16 / 9);
      const widthDelta = Math.abs(widthDeltaX) >= Math.abs(widthDeltaY) ? widthDeltaX : widthDeltaY;
      const nextWidth = clampWidth(activeResize.startWidth + widthDelta);
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
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [height, interactionMode, width]);

  const handleContainerMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return;
      if (isDragBlockedTarget(event.target)) return;
      dragOffsetRef.current = { x: event.clientX - position.x, y: event.clientY - position.y };
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

  if (!ready || isWatchRoute || !quickPlayStream || !hlsSrc) return null;

  return (
    <div
      onMouseDown={handleContainerMouseDown}
      style={{ left: position.x, top: position.y, width, height, position: "fixed" }}
      className={`z-[9999] bg-black rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 flex flex-col group backdrop-blur-xl ring-1 ring-white/20 select-none ${
        interactionMode === "drag" ? "cursor-grabbing" : interactionMode === "resize" ? "cursor-move" : "cursor-grab"
      }`}
      aria-label="Floating mini player"
    >
      <div ref={playerHostRef} className="h-full relative">
        <Player
          src={hlsSrc}
          whepSrc={whepSrc}
          autoplayMuted={false}
          isLiveStream
          showTimelineControls={false}
          showAuxControls={false}
          showNativeControls={false}
          playbackStateKey={playbackStateKey}
        />
        <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-2xl pointer-events-none" />
      </div>

      <div className="absolute inset-0 z-20 flex flex-col pointer-events-none opacity-100">
        <div className="p-3 bg-gradient-to-b from-black/80 to-transparent flex items-center gap-3 pointer-events-auto">
          <div className="p-1.5 bg-white/10 rounded-lg">
            <Move className="w-3 h-3 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-white truncate leading-none mb-1">NOW WATCHING</p>
            <p className="text-xs font-medium text-white/70 truncate leading-none">
              {quickPlayStream.title || "Live stream"}
            </p>
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
              className="p-2 hover:bg-red-500/20 rounded-xl text-white/60 hover:text-red-500 transition-all active:scale-95"
              title="Close mini player"
              aria-label="Close mini player"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mt-auto p-2 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <button
              type="button"
              onClick={handleToggleMute}
              className="rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-white/90 hover:text-white"
              title={muted || volume === 0 ? "Unmute" : "Mute"}
              aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
            >
              {muted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => handleVolumeInput(Number(event.target.value))}
              className="flex-1 accent-blue-500"
              aria-label="Mini player volume"
            />
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
            >
              <span className="w-4 h-4 rounded-br-xl bg-white/20 border-l border-t border-white/50 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
            </button>
            <button
              type="button"
              data-no-drag="true"
              onMouseDown={(event) => handleResizeStart(event, "top_right")}
              className="absolute top-0 right-0 w-7 h-7 pointer-events-auto cursor-nesw-resize flex items-start justify-end p-0.5"
              title="Resize mini player"
              aria-label="Resize mini player from top-right"
            >
              <span className="w-4 h-4 rounded-bl-xl bg-white/20 border-r border-t border-white/50 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
            </button>
            <button
              type="button"
              data-no-drag="true"
              onMouseDown={(event) => handleResizeStart(event, "bottom_right")}
              className="absolute bottom-0 right-0 w-7 h-7 pointer-events-auto cursor-nwse-resize flex items-end justify-end p-0.5"
              title="Resize mini player"
              aria-label="Resize mini player from bottom-right"
            >
              <span className="w-4 h-4 rounded-tl-xl bg-white/20 border-r border-b border-white/50 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
            </button>
            <button
              type="button"
              data-no-drag="true"
              onMouseDown={(event) => handleResizeStart(event, "bottom_left")}
              className="absolute bottom-0 left-0 w-7 h-7 pointer-events-auto cursor-nesw-resize flex items-end justify-start p-0.5"
              title="Resize mini player"
              aria-label="Resize mini player from bottom-left"
            >
              <span className="w-4 h-4 rounded-tr-xl bg-white/20 border-l border-b border-white/50 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
