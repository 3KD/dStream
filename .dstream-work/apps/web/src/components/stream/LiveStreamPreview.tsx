"use client";

import { useEffect, useMemo, useState } from "react";
import Hls from "hls.js";
import { makeOriginStreamId } from "@/lib/origin";
import { inferMediaUrlKind } from "@/lib/mediaUrl";

interface LiveStreamPreviewProps {
  streamPubkey: string;
  streamId: string;
  title: string;
  streamingUrl?: string | null;
  fallbackImage?: string;
  enabled?: boolean;
}

function randomMs(minMs: number, maxMs: number): number {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

const INITIAL_CAPTURE_MIN_MS = 900;
const INITIAL_CAPTURE_MAX_MS = 3400;
const CAPTURE_START_TIMEOUT_MS = 30_000;

export function LiveStreamPreview({ streamPubkey, streamId, title, streamingUrl, fallbackImage, enabled = true }: LiveStreamPreviewProps) {
  const [capturedFrame, setCapturedFrame] = useState<{ sourceUrl: string; dataUrl: string } | null>(null);
  const [failedFallbackImage, setFailedFallbackImage] = useState<string | null>(null);

  const hlsPreviewUrl = useMemo(() => {
    const explicit = streamingUrl?.trim();
    if (explicit && inferMediaUrlKind(explicit) !== "unknown") return explicit;
    const originStreamId = makeOriginStreamId(streamPubkey, streamId);
    if (!originStreamId) return null;
    return `/api/hls/${encodeURIComponent(originStreamId)}/index.m3u8`;
  }, [streamId, streamPubkey, streamingUrl]);

  const fallbackImageUrl = fallbackImage?.trim() || null;
  const fallbackImageFailed = Boolean(fallbackImageUrl && failedFallbackImage === fallbackImageUrl);
  const frameDataUrl = capturedFrame?.sourceUrl === hlsPreviewUrl ? capturedFrame.dataUrl : null;
  const shouldCaptureFrame = enabled && (!fallbackImageUrl || fallbackImageFailed);

  useEffect(() => {
    if (!shouldCaptureFrame || !hlsPreviewUrl) return;

    let cancelled = false;
    let captureTimer: ReturnType<typeof setTimeout> | null = null;
    let hls: Hls | null = null;
    let hasCapturedFrame = false;
    const startedAt = Date.now();

    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    (video as any).disablePictureInPicture = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    const canvas = document.createElement("canvas");

    const clearTimer = () => {
      if (!captureTimer) return;
      clearTimeout(captureTimer);
      captureTimer = null;
    };

    const stopPreviewLoading = () => {
      clearTimer();
      try {
        hls?.destroy();
      } catch {
        // ignore
      }
      hls = null;
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // ignore
      }
    };

    const scheduleCapture = (minMs: number, maxMs: number) => {
      if (captureTimer) return;
      captureTimer = setTimeout(() => {
        captureTimer = null;
        if (cancelled) return;
        if (!hasCapturedFrame && Date.now() - startedAt > CAPTURE_START_TIMEOUT_MS) {
          stopPreviewLoading();
          return;
        }
        if (video.readyState < 2 || video.videoWidth < 32 || video.videoHeight < 32) {
          scheduleCapture(INITIAL_CAPTURE_MIN_MS, INITIAL_CAPTURE_MAX_MS);
          return;
        }
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          scheduleCapture(INITIAL_CAPTURE_MIN_MS, INITIAL_CAPTURE_MAX_MS);
          return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const nextFrame = canvas.toDataURL("image/jpeg", 0.78);
          if (!cancelled) {
            hasCapturedFrame = true;
            setCapturedFrame({ sourceUrl: hlsPreviewUrl, dataUrl: nextFrame });
            stopPreviewLoading();
            return;
          }
        } catch {
          // ignore draw errors (usually cross-origin/tainting or decode transitions)
        }
        scheduleCapture(INITIAL_CAPTURE_MIN_MS, INITIAL_CAPTURE_MAX_MS);
      }, randomMs(minMs, maxMs));
    };

    const onPlayable = () => {
      void video.play().catch(() => {
        // autoplay can be blocked; keep fallback image/UI.
      });
      scheduleCapture(INITIAL_CAPTURE_MIN_MS, INITIAL_CAPTURE_MAX_MS);
    };

    video.addEventListener("loadeddata", onPlayable);
    video.addEventListener("playing", onPlayable);

    const sourceKind = inferMediaUrlKind(hlsPreviewUrl);
    if (sourceKind === "hls" && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        startLevel: 0,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 2
      });
      hls.attachMedia(video);
      hls.loadSource(hlsPreviewUrl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls && hls.levels.length > 0) hls.autoLevelCapping = 0;
        onPlayable();
      });
    } else if (sourceKind === "hls" && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsPreviewUrl;
    } else if (sourceKind === "direct") {
      video.src = hlsPreviewUrl;
    }

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", onPlayable);
      video.removeEventListener("playing", onPlayable);
      stopPreviewLoading();
    };
  }, [hlsPreviewUrl, shouldCaptureFrame]);

  if (frameDataUrl) {
    return (
      <img
        src={frameDataUrl}
        alt={title}
        className="w-full h-full object-cover"
        loading="lazy"
        data-live-preview-state="frame"
      />
    );
  }

  if (fallbackImageUrl && !fallbackImageFailed) {
    return (
      <img
        src={fallbackImageUrl}
        alt={title}
        className="w-full h-full object-cover"
        loading="lazy"
        data-live-preview-state="poster"
        onError={() => setFailedFallbackImage(fallbackImageUrl)}
      />
    );
  }

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 gap-2"
      data-live-preview-state={shouldCaptureFrame ? "loading-frame" : "placeholder"}
    >
      <img src="/logo_trimmed.png" alt="" className="w-14 h-14 object-contain opacity-15 grayscale" />
      <span className="text-[11px] font-semibold tracking-wider text-neutral-700">dStream</span>
    </div>
  );
}
