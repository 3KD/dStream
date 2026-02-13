"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleDot, Camera, Mic, MonitorUp, Radio, Square, AlertTriangle, ExternalLink } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { ChatBox } from "@/components/chat/ChatBox";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { WhipClient } from "@/lib/whip";
import { getNostrRelays } from "@/lib/config";
import { publishEventDetailed, type PublishEventReport } from "@/lib/publish";
import { buildStreamAnnounceEvent, type StreamCaptionTrack, type StreamHostMode, type StreamRendition } from "@dstream/protocol";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { describeOriginStreamIdRules, makeOriginStreamId } from "@/lib/origin";
import { toMediaCaptureErrorMessage } from "@/lib/mediaPermissions";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function parseXmrAmountToAtomic(inputRaw: string): bigint | null {
  const input = inputRaw.trim();
  if (!input) return null;
  const m = input.match(/^(\d+)(?:\.(\d{0,12}))?$/);
  if (!m) return null;
  const whole = m[1] ?? "0";
  const frac = (m[2] ?? "").padEnd(12, "0");
  try {
    return BigInt(whole) * 1_000_000_000_000n + (frac ? BigInt(frac) : 0n);
  } catch {
    return null;
  }
}

function parsePositiveInt(inputRaw: string): number | null {
  const input = inputRaw.trim();
  if (!input) return null;
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return null;
  const value = Math.trunc(parsed);
  if (value <= 0) return null;
  return value;
}

function isPlaybackUrl(inputRaw: string): boolean {
  const input = inputRaw.trim();
  return /^https?:\/\//i.test(input) || input.startsWith("/");
}

function parseCaptionLines(inputRaw: string): { tracks: StreamCaptionTrack[]; error: string | null } {
  const lines = inputRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const tracks: StreamCaptionTrack[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const [langRaw, labelRaw, urlRaw, defaultRaw = ""] = line.split("|");
    const lang = (langRaw ?? "").trim().toLowerCase();
    const label = (labelRaw ?? "").trim();
    const url = (urlRaw ?? "").trim();
    if (!lang || !label || !url) {
      return { tracks: [], error: `Caption line ${index + 1} must be: lang|label|url|default(optional).` };
    }
    if (!isPlaybackUrl(url)) {
      return { tracks: [], error: `Caption line ${index + 1} has an invalid URL (use https:// or /path).` };
    }

    const defaultToken = defaultRaw.trim().toLowerCase();
    tracks.push({
      lang,
      label,
      url,
      isDefault: defaultToken === "1" || defaultToken === "true" || defaultToken === "yes" || defaultToken === "default"
    });
  }

  return { tracks, error: null };
}

function parseRenditionLines(inputRaw: string): { renditions: StreamRendition[]; error: string | null } {
  const lines = inputRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const renditions: StreamRendition[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const [idRaw, urlRaw, bwRaw = "", widthRaw = "", heightRaw = "", codecsRaw = ""] = line.split("|");
    const id = (idRaw ?? "").trim();
    const url = (urlRaw ?? "").trim();
    if (!id || !url) {
      return { renditions: [], error: `Rendition line ${index + 1} must be: id|url|bandwidth|width|height|codecs.` };
    }
    if (!isPlaybackUrl(url)) {
      return { renditions: [], error: `Rendition line ${index + 1} has an invalid URL (use https:// or /path).` };
    }

    const bandwidth = bwRaw.trim() ? parsePositiveInt(bwRaw) : null;
    const width = widthRaw.trim() ? parsePositiveInt(widthRaw) : null;
    const height = heightRaw.trim() ? parsePositiveInt(heightRaw) : null;
    if (bwRaw.trim() && bandwidth === null) {
      return { renditions: [], error: `Rendition line ${index + 1} has invalid bandwidth.` };
    }
    if (widthRaw.trim() && width === null) {
      return { renditions: [], error: `Rendition line ${index + 1} has invalid width.` };
    }
    if (heightRaw.trim() && height === null) {
      return { renditions: [], error: `Rendition line ${index + 1} has invalid height.` };
    }

    const key = `${id}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);

    renditions.push({
      id,
      url,
      bandwidth: bandwidth ?? undefined,
      width: width ?? undefined,
      height: height ?? undefined,
      codecs: codecsRaw.trim() || undefined
    });
  }

  return { renditions, error: null };
}

function safeDefaultStreamId() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `live-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

type StepStatus = "idle" | "checking" | "ok" | "fail";
type StoredBroadcastSession = { pubkey: string; streamId: string; originStreamId: string; startedAt: number };
type LadderProfile = { id: string; width: number; height: number; bandwidth: number };

const AUTO_LADDER_PROFILES: LadderProfile[] = [
  { id: "720p", width: 1280, height: 720, bandwidth: 2_500_000 },
  { id: "480p", width: 854, height: 480, bandwidth: 1_200_000 },
  { id: "360p", width: 640, height: 360, bandwidth: 700_000 }
];

export default function BroadcastPage() {
  const { identity, signEvent } = useIdentity();
  const social = useSocial();
  const relays = useMemo(() => getNostrRelays(), []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const whipRef = useRef<WhipClient | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const [streamId, setStreamId] = useState("");
  const [title, setTitle] = useState("Untitled Stream");
  const [summary, setSummary] = useState("");
  const [image, setImage] = useState("");
  const [xmr, setXmr] = useState("");
  const [stakeXmr, setStakeXmr] = useState("");
  const [stakeNote, setStakeNote] = useState("");
  const [captionLines, setCaptionLines] = useState("");
  const [renditionLines, setRenditionLines] = useState("");
  const [autoLadder, setAutoLadder] = useState(true);
  const [manifestSignerPubkey, setManifestSignerPubkey] = useState<string | null>(null);
  const [topicsCsv, setTopicsCsv] = useState("");
  const [hostMode, setHostMode] = useState<StreamHostMode>("p2p_economy");
  const [rebroadcastThresholdInput, setRebroadcastThresholdInput] = useState("6");
  const [draftLoaded, setDraftLoaded] = useState(false);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState<string>("");
  const [audioDeviceId, setAudioDeviceId] = useState<string>("");
  const [sourceMode, setSourceMode] = useState<"camera" | "screen">("camera");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [videoMaxBitrateKbps, setVideoMaxBitrateKbps] = useState("");
  const [videoMaxFps, setVideoMaxFps] = useState("");

  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "preview" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const [origin, setOrigin] = useState<string>("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [hlsStep, setHlsStep] = useState<StepStatus>("idle");
  const [hlsLastCode, setHlsLastCode] = useState<number | null>(null);
  const [announceStep, setAnnounceStep] = useState<StepStatus>("idle");
  const [autoAnnounce, setAutoAnnounce] = useState(true);
  const [lastAnnounceAt, setLastAnnounceAt] = useState<number | null>(null);
  const [announceReport, setAnnounceReport] = useState<PublishEventReport | null>(null);
  const [storedSession, setStoredSession] = useState<StoredBroadcastSession | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/manifest/identity", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as any;
        const pk = typeof data?.pubkey === "string" ? data.pubkey.trim() : "";
        if (!pk) return;
        if (cancelled) return;
        setManifestSignerPubkey(pk);
      } catch {
        // ignore (manifest service is optional)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    mediaStreamRef.current = mediaStream;
  }, [mediaStream]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("dstream_broadcast_session_v1");
      if (raw) setStoredSession(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("dstream_broadcast_include_audio_v1");
      if (raw === "1") setIncludeAudio(true);
      else if (raw === "0") setIncludeAudio(false);
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("dstream_broadcast_include_audio_v1", includeAudio ? "1" : "0");
    } catch {
      // ignore
    }
  }, [includeAudio]);

  const clearStoredSession = useCallback(() => {
    try {
      localStorage.removeItem("dstream_broadcast_session_v1");
    } catch {
      // ignore
    }
    setStoredSession(null);
  }, []);

  // Restore draft stream metadata (best-effort).
  useEffect(() => {
    if (draftLoaded) return;
    if (social.isLoading) return;
    try {
      const raw = localStorage.getItem("dstream_broadcast_draft_v1");
      if (!raw) {
        setStreamId(safeDefaultStreamId());
        setXmr(social.settings.paymentDefaults.xmrTipAddress);
        setStakeXmr(social.settings.paymentDefaults.stakeXmr);
        setStakeNote(social.settings.paymentDefaults.stakeNote);
        setHostMode(social.settings.broadcastHostMode);
        setRebroadcastThresholdInput(String(social.settings.broadcastRebroadcastThreshold));
        setCaptionLines("");
        setRenditionLines("");
        setVideoMaxBitrateKbps("");
        setVideoMaxFps("");
        return;
      }

      const parsed = JSON.parse(raw);

      if (typeof parsed.streamId === "string" && parsed.streamId.trim()) setStreamId(parsed.streamId);
      else setStreamId(safeDefaultStreamId());

      if (typeof parsed.title === "string") setTitle(parsed.title);
      if (typeof parsed.summary === "string") setSummary(parsed.summary);
      if (typeof parsed.image === "string") setImage(parsed.image);
      if (typeof parsed.xmr === "string") setXmr(parsed.xmr);
      if (typeof parsed.stakeXmr === "string") setStakeXmr(parsed.stakeXmr);
      if (typeof parsed.stakeNote === "string") setStakeNote(parsed.stakeNote);
      if (parsed.hostMode === "host_only" || parsed.hostMode === "p2p_economy") setHostMode(parsed.hostMode);
      if (typeof parsed.rebroadcastThresholdInput === "string") setRebroadcastThresholdInput(parsed.rebroadcastThresholdInput);
      else if (typeof parsed.rebroadcastThresholdInput === "number") setRebroadcastThresholdInput(String(parsed.rebroadcastThresholdInput));
      if (typeof parsed.captionLines === "string") setCaptionLines(parsed.captionLines);
      if (typeof parsed.renditionLines === "string") setRenditionLines(parsed.renditionLines);
      if (typeof parsed.autoLadder === "boolean") setAutoLadder(parsed.autoLadder);
      if (typeof parsed.topicsCsv === "string") setTopicsCsv(parsed.topicsCsv);
      if (typeof parsed.videoMaxBitrateKbps === "string") setVideoMaxBitrateKbps(parsed.videoMaxBitrateKbps);
      if (typeof parsed.videoMaxFps === "string") setVideoMaxFps(parsed.videoMaxFps);
    } catch {
      setStreamId(safeDefaultStreamId());
      setXmr(social.settings.paymentDefaults.xmrTipAddress);
      setStakeXmr(social.settings.paymentDefaults.stakeXmr);
      setStakeNote(social.settings.paymentDefaults.stakeNote);
      setHostMode(social.settings.broadcastHostMode);
      setRebroadcastThresholdInput(String(social.settings.broadcastRebroadcastThreshold));
      setCaptionLines("");
      setRenditionLines("");
      setVideoMaxBitrateKbps("");
      setVideoMaxFps("");
    } finally {
      setDraftLoaded(true);
    }
  }, [
    draftLoaded,
    social.isLoading,
    social.settings.broadcastHostMode,
    social.settings.broadcastRebroadcastThreshold,
    social.settings.paymentDefaults.stakeNote,
    social.settings.paymentDefaults.stakeXmr,
    social.settings.paymentDefaults.xmrTipAddress
  ]);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      localStorage.setItem(
        "dstream_broadcast_draft_v1",
        JSON.stringify({
          streamId,
          title,
          summary,
          image,
          xmr,
          stakeXmr,
          stakeNote,
          hostMode,
          rebroadcastThresholdInput,
          captionLines,
          renditionLines,
          autoLadder,
          videoMaxBitrateKbps,
          videoMaxFps,
          topicsCsv
        })
      );
    } catch {
      // ignore
    }
  }, [
    captionLines,
    draftLoaded,
    image,
    renditionLines,
    autoLadder,
    hostMode,
    stakeNote,
    stakeXmr,
    rebroadcastThresholdInput,
    streamId,
    summary,
    title,
    topicsCsv,
    videoMaxBitrateKbps,
    videoMaxFps,
    xmr
  ]);

  const stakeAtomic = useMemo(() => parseXmrAmountToAtomic(stakeXmr), [stakeXmr]);
  const stakeInvalid = useMemo(() => stakeXmr.trim() !== "" && stakeAtomic === null, [stakeAtomic, stakeXmr]);
  const stakeAmountAtomic = useMemo(() => {
    if (stakeAtomic === null) return undefined;
    if (stakeAtomic <= 0n) return undefined;
    return stakeAtomic.toString();
  }, [stakeAtomic]);
  const videoMaxBitrateParsed = useMemo(() => parsePositiveInt(videoMaxBitrateKbps), [videoMaxBitrateKbps]);
  const videoMaxFpsParsed = useMemo(() => parsePositiveInt(videoMaxFps), [videoMaxFps]);
  const rebroadcastThresholdParsed = useMemo(() => parsePositiveInt(rebroadcastThresholdInput), [rebroadcastThresholdInput]);
  const rebroadcastThresholdInvalid = useMemo(
    () => hostMode === "p2p_economy" && rebroadcastThresholdInput.trim() !== "" && rebroadcastThresholdParsed === null,
    [hostMode, rebroadcastThresholdInput, rebroadcastThresholdParsed]
  );
  const videoMaxBitrateInvalid = useMemo(
    () => videoMaxBitrateKbps.trim() !== "" && videoMaxBitrateParsed === null,
    [videoMaxBitrateKbps, videoMaxBitrateParsed]
  );
  const videoMaxFpsInvalid = useMemo(() => videoMaxFps.trim() !== "" && videoMaxFpsParsed === null, [videoMaxFps, videoMaxFpsParsed]);
  const parsedCaptions = useMemo(() => parseCaptionLines(captionLines), [captionLines]);
  const parsedRenditions = useMemo(() => parseRenditionLines(renditionLines), [renditionLines]);
  const captionInputError = parsedCaptions.error;
  const renditionInputError = parsedRenditions.error;

  const originStreamId = useMemo(() => {
    if (!identity) return null;
    return makeOriginStreamId(identity.pubkey, streamId);
  }, [identity, streamId]);

  const autoLadderRenditionPreview = useMemo(() => {
    if (!autoLadder || !originStreamId) return [];
    const source = {
      id: "source",
      url: `/api/hls/${originStreamId}/index.m3u8`,
      bandwidth: videoMaxBitrateParsed ? videoMaxBitrateParsed * 1000 : undefined,
      width: undefined,
      height: undefined,
      codecs: undefined
    };
    const derived = AUTO_LADDER_PROFILES.map((profile) => ({
      id: profile.id,
      url: `/api/hls/${originStreamId}__r${profile.id}/index.m3u8`,
      bandwidth: profile.bandwidth,
      width: profile.width,
      height: profile.height,
      codecs: "avc1.4d401f,mp4a.40.2"
    }));
    return [source, ...derived];
  }, [autoLadder, originStreamId, videoMaxBitrateParsed]);

  const topics = useMemo(() => {
    return topicsCsv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 24);
  }, [topicsCsv]);

  const npub = useMemo(() => (identity ? pubkeyHexToNpub(identity.pubkey) : null), [identity]);
  const watchPath = useMemo(() => {
    if (!identity) return `/watch/npub/${streamId}`;
    return `/watch/${npub ?? identity.pubkey}/${streamId}`;
  }, [identity, npub, streamId]);
  const watchUrl = useMemo(() => (origin ? `${origin}${watchPath}` : watchPath), [origin, watchPath]);

  const hlsLocalUrl = useMemo(() => {
    const name = originStreamId ?? streamId;
    return `/api/hls/${name}/index.m3u8`;
  }, [originStreamId, streamId]);

  const hlsHintUrl = useMemo(() => {
    const streamName = originStreamId ?? streamId;
    const hlsOrigin = process.env.NEXT_PUBLIC_HLS_ORIGIN?.trim();
    if (hlsOrigin) return `${hlsOrigin.replace(/\/$/, "")}/${streamName}/index.m3u8`;
    if (origin) return `${origin}/api/hls/${streamName}/index.m3u8`;
    return `/api/hls/${streamName}/index.m3u8`;
  }, [origin, originStreamId, streamId]);

  const copyWatchLink = useCallback(async () => {
    setCopyStatus("idle");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(watchUrl);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1200);
    } catch {
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 1800);
    }
  }, [watchUrl]);

  const refreshDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void refreshDevices();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (mediaStream) {
      try {
        video.srcObject = mediaStream;
      } catch {
        // ignore
      }
      void video.play().catch(() => {
        // ignore (autoplay policy)
      });
    } else {
      try {
        video.srcObject = null;
      } catch {
        // ignore
      }
    }
  }, [mediaStream]);

  const stopPreview = () => {
    const stream = mediaStreamRef.current;
    stream?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    setMediaStream(null);
    setStatus((prev) => (prev === "live" ? prev : "idle"));
  };

  const startPreview = async (modeOverride?: "camera" | "screen") => {
    setError(null);
    const mode = modeOverride ?? sourceMode;
    setSourceMode(mode);

    try {
      stopPreview();

      let stream: MediaStream;
      if (mode === "screen") {
        const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia;
        if (!getDisplayMedia) throw new Error("Screen share is not supported in this browser.");

        stream = await getDisplayMedia.call(navigator.mediaDevices, { video: true, audio: false } as any);
        if (videoMaxFpsParsed) {
          const screenTrack = stream.getVideoTracks()[0];
          if (screenTrack?.applyConstraints) {
            try {
              await screenTrack.applyConstraints({
                frameRate: { ideal: videoMaxFpsParsed, max: videoMaxFpsParsed }
              });
            } catch {
              // ignore unsupported constraint combinations
            }
          }
        }

        if (includeAudio) {
          if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is not supported in this browser.");
          const mic = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
          });
          mic.getAudioTracks().forEach((t) => stream.addTrack(t));
        }
      } else {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not supported in this browser.");
        const videoConstraints: MediaTrackConstraints = {};
        if (videoDeviceId) videoConstraints.deviceId = { exact: videoDeviceId };
        if (videoMaxFpsParsed) videoConstraints.frameRate = { ideal: videoMaxFpsParsed, max: videoMaxFpsParsed };
        stream = await navigator.mediaDevices.getUserMedia({
          video: Object.keys(videoConstraints).length > 0 ? videoConstraints : true,
          audio: includeAudio ? (audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true) : false
        });
      }

      const onEnded = () => stopPreview();
      stream.getTracks().forEach((t) => {
        t.addEventListener("ended", onEnded, { once: true });
      });

      mediaStreamRef.current = stream;
      setMediaStream(stream);
      setStatus("preview");
      await refreshDevices();
    } catch (e: any) {
      setError(toMediaCaptureErrorMessage(e, { mode, includeAudio }));
      setStatus("error");
    }
  };

  const announce = useCallback(async (nextStatus: "live" | "ended") => {
    if (!identity) throw new Error("No identity.");
    if (stakeInvalid) throw new Error("Invalid stake requirement (expected a number with up to 12 decimals).");
    if (rebroadcastThresholdInvalid) throw new Error("Rebroadcast threshold must be a positive integer.");
    if (captionInputError) throw new Error(captionInputError);
    if (renditionInputError) throw new Error(renditionInputError);

    const originStreamId = makeOriginStreamId(identity.pubkey, streamId);
    if (!originStreamId) throw new Error(`Invalid Stream ID. ${describeOriginStreamIdRules()}`);

    const streamingHint =
      nextStatus === "live"
        ? (() => {
            const hlsOrigin = process.env.NEXT_PUBLIC_HLS_ORIGIN?.trim();
            if (hlsOrigin) return `${hlsOrigin.replace(/\/$/, "")}/${originStreamId}/index.m3u8`;
            return `${window.location.origin}/api/hls/${originStreamId}/index.m3u8`;
          })()
        : undefined;

    const autoRenditions =
      nextStatus === "live" && autoLadder
        ? [
            {
              id: "source",
              url: `/api/hls/${originStreamId}/index.m3u8`,
              bandwidth: videoMaxBitrateParsed ? videoMaxBitrateParsed * 1000 : undefined
            },
            ...AUTO_LADDER_PROFILES.map((profile) => ({
              id: profile.id,
              url: `/api/hls/${originStreamId}__r${profile.id}/index.m3u8`,
              bandwidth: profile.bandwidth,
              width: profile.width,
              height: profile.height,
              codecs: "avc1.4d401f,mp4a.40.2"
            }))
          ]
        : [];

    const mergedRenditions = (() => {
      const byKey = new Map();
      for (const rendition of parsedRenditions.renditions) {
        byKey.set(`${rendition.id}|${rendition.url}`, rendition);
      }
      for (const rendition of autoRenditions) {
        const key = `${rendition.id}|${rendition.url}`;
        if (!byKey.has(key)) byKey.set(key, rendition);
      }
      return Array.from(byKey.values());
    })();

    const unsigned: any = buildStreamAnnounceEvent({
      pubkey: identity.pubkey,
      createdAt: nowSec(),
      streamId,
      title: title.trim() || streamId,
      status: nextStatus,
      summary: summary.trim() || undefined,
      streaming: streamingHint,
      image: image.trim() || undefined,
      xmr: xmr.trim() || undefined,
      hostMode,
      rebroadcastThreshold: hostMode === "p2p_economy" ? rebroadcastThresholdParsed ?? 6 : undefined,
      stakeAmountAtomic,
      stakeNote: stakeAmountAtomic ? (stakeNote.trim() || undefined) : undefined,
      captions: parsedCaptions.tracks,
      renditions: mergedRenditions,
      manifestSignerPubkey: manifestSignerPubkey ?? undefined,
      topics
    });

    const signed = await signEvent(unsigned);
    const report = await publishEventDetailed(relays, signed);
    setAnnounceReport(report);
    return report.ok;
  }, [
    autoLadder,
    captionInputError,
    identity,
    image,
    hostMode,
    manifestSignerPubkey,
    parsedCaptions.tracks,
    parsedRenditions.renditions,
    rebroadcastThresholdInvalid,
    rebroadcastThresholdParsed,
    relays,
    renditionInputError,
    signEvent,
    stakeAmountAtomic,
    stakeInvalid,
    stakeNote,
    streamId,
    summary,
    title,
    topics,
    videoMaxBitrateParsed,
    xmr
  ]);

  useEffect(() => {
    if (status !== "live") {
      setHlsStep("idle");
      setHlsLastCode(null);
      return;
    }
    if (!originStreamId) return;

    let cancelled = false;
    setHlsStep("checking");
    setHlsLastCode(null);

    void (async () => {
      let ok = false;
      for (let i = 0; i < 30; i++) {
        if (cancelled) return;
        try {
          const res = await fetch(hlsLocalUrl, { cache: "no-store" });
          if (cancelled) return;
          setHlsLastCode(res.status);
          if (res.ok) {
            ok = true;
            break;
          }
        } catch {
          // ignore (keep trying)
        }
        await new Promise((r) => setTimeout(r, 750));
      }
      if (cancelled) return;
      setHlsStep(ok ? "ok" : "fail");
    })();

    return () => {
      cancelled = true;
    };
  }, [hlsLocalUrl, originStreamId, status]);

  useEffect(() => {
    if (!autoAnnounce) return;
    if (status !== "live") return;
    if (!identity) return;

    const interval = setInterval(() => {
      void (async () => {
        try {
          setAnnounceStep("checking");
          const ok = await announce("live");
          setLastAnnounceAt(Date.now());
          setAnnounceStep(ok ? "ok" : "fail");
        } catch {
          setAnnounceStep("fail");
        }
      })();
    }, 30_000);

    return () => clearInterval(interval);
  }, [announce, autoAnnounce, identity, status]);

  const goLive = async () => {
    setError(null);
    if (!identity) {
      setError("Connect an identity first (NIP-07 preferred).");
      return;
    }
    if (!mediaStream) {
      setError("Start preview first (camera or screen).");
      return;
    }
    if (videoMaxBitrateInvalid) {
      setError("Video max bitrate must be a positive integer (kbps).");
      return;
    }
    if (videoMaxFpsInvalid) {
      setError("Video max FPS must be a positive integer.");
      return;
    }
    if (rebroadcastThresholdInvalid) {
      setError("Rebroadcast threshold must be a positive integer.");
      return;
    }
    if (captionInputError) {
      setError(captionInputError);
      return;
    }
    if (renditionInputError) {
      setError(renditionInputError);
      return;
    }

    setStatus("connecting");
    try {
      const originStreamId = makeOriginStreamId(identity.pubkey, streamId);
      if (!originStreamId) {
        setError(`Invalid Stream ID. ${describeOriginStreamIdRules()}`);
        setStatus("error");
        return;
      }

      const endpoint = `${window.location.origin}/api/whip/${originStreamId}/whip`;
      const client = new WhipClient(endpoint);
      whipRef.current = client;

      await client.publish(mediaStream, {
        videoMaxBitrateKbps: videoMaxBitrateParsed ?? undefined,
        videoMaxFps: videoMaxFpsParsed ?? undefined
      });
      setStatus("live");

      try {
        const nextSession: StoredBroadcastSession = {
          pubkey: identity.pubkey,
          streamId,
          originStreamId,
          startedAt: Date.now()
        };
        localStorage.setItem("dstream_broadcast_session_v1", JSON.stringify(nextSession));
        setStoredSession(nextSession);
      } catch {
        // ignore
      }

      try {
        setAnnounceStep("checking");
        const ok = await announce("live");
        setLastAnnounceAt(Date.now());
        setAnnounceStep(ok ? "ok" : "fail");
        if (!ok) {
          setError("Stream is live, but announce failed on relays.");
        }
      } catch (e: any) {
        setAnnounceStep("fail");
        setError(e?.message ?? "Stream is live, but announce failed.");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to publish via WHIP.");
      setStatus("error");
    }
  };

  const endStream = async () => {
    setError(null);
    try {
      whipRef.current?.close();
      whipRef.current = null;
    } catch {
      // ignore
    }
    setStatus("preview");
    clearStoredSession();
    if (identity) {
      try {
        setAnnounceStep("checking");
        const ok = await announce("ended");
        setLastAnnounceAt(Date.now());
        setAnnounceStep(ok ? "ok" : "fail");
      } catch {
        setAnnounceStep("fail");
      }
    }
  };

  return (
      <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-7xl mx-auto p-6">
        <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Radio className="w-6 h-6 text-blue-500" />
              Broadcast
            </h1>
            <p className="text-sm text-neutral-400">WHIP → MediaMTX, then announce on Nostr (kind 30311).</p>
          </div>
          <div className="flex items-end gap-3">
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-bold border shadow-lg ${
                status === "live"
                  ? "bg-red-600/20 text-red-300 border-red-500/40"
                  : status === "connecting"
                    ? "bg-blue-600/20 text-blue-300 border-blue-500/40"
                    : "bg-neutral-900/70 text-neutral-300 border-neutral-800"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <CircleDot className={`w-3.5 h-3.5 ${status === "live" ? "text-red-400" : "text-neutral-400"}`} />
                {status === "live" ? "LIVE" : status === "connecting" ? "CONNECTING" : mediaStream ? "PREVIEW" : "OFFLINE"}
              </span>
            </span>
            <Link className="text-sm text-neutral-300 hover:text-white" href="/">
              Home
            </Link>
          </div>
        </header>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Broadcast error</div>
              <div className="text-sm opacity-90">{error}</div>
            </div>
          </div>
        )}

        {storedSession && identity && storedSession.pubkey === identity.pubkey && status !== "live" && (
          <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="text-sm text-neutral-300">
              Previous session:{" "}
              <span className="font-mono text-neutral-200">{storedSession.streamId}</span>{" "}
              <span className="text-xs text-neutral-500">
                ({new Date(storedSession.startedAt).toLocaleString()})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/watch/${pubkeyHexToNpub(identity.pubkey) ?? identity.pubkey}/${storedSession.streamId}`}
                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm inline-flex items-center gap-2"
              >
                Open Watch <ExternalLink className="w-4 h-4" />
              </Link>
              <button
                onClick={clearStoredSession}
                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-neutral-800">
              {mediaStream ? (
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center flex-col gap-4 text-neutral-400 p-6 text-center">
                  <div className="flex items-center gap-3 text-neutral-500">
                    <Camera className="w-10 h-10" />
                    <MonitorUp className="w-10 h-10" />
                  </div>
                  <div className="text-sm">Choose a source to start preview.</div>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      onClick={() => {
                        void startPreview("camera");
                      }}
                      className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                    >
                      Camera
                    </button>
                    <button
                      onClick={() => {
                        void startPreview("screen");
                      }}
                      className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                    >
                      Screen
                    </button>
                  </div>
                  <div className="text-xs text-neutral-500">Your browser will ask for permission after you click.</div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Stream ID (Nostr d-tag)</label>
                  <input
                    value={streamId}
                    onChange={(e) => setStreamId(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    disabled={status === "connecting" || status === "live"}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    disabled={status === "connecting"}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-neutral-400">Summary (optional)</label>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none min-h-20"
                  disabled={status === "connecting"}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Thumbnail URL (optional)</label>
                  <input
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    disabled={status === "connecting"}
                    placeholder="https://…"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Topics (comma separated)</label>
                  <input
                    value={topicsCsv}
                    onChange={(e) => setTopicsCsv(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    disabled={status === "connecting"}
                    placeholder="music, gaming, rust…"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-neutral-400">Monero tip address (optional)</label>
                  <button
                    type="button"
                    onClick={() => {
                      setXmr(social.settings.paymentDefaults.xmrTipAddress);
                      setStakeXmr(social.settings.paymentDefaults.stakeXmr);
                      setStakeNote(social.settings.paymentDefaults.stakeNote);
                      setHostMode(social.settings.broadcastHostMode);
                      setRebroadcastThresholdInput(String(social.settings.broadcastRebroadcastThreshold));
                    }}
                    disabled={status === "connecting" || status === "live"}
                    className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                    title="Apply payment defaults from Settings"
                  >
                    Apply defaults
                  </button>
                </div>
                <input
                  value={xmr}
                  onChange={(e) => setXmr(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                  disabled={status === "connecting"}
                  placeholder="4…"
                />
                <div className="text-xs text-neutral-500">Shown on the watch page if set.</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Stake required for P2P assist (XMR, optional)</label>
                  <input
                    value={stakeXmr}
                    onChange={(e) => setStakeXmr(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                    disabled={status === "connecting"}
                    placeholder="0.05"
                  />
                  {stakeInvalid ? (
                    <div className="text-xs text-red-300">Invalid amount (use a number with up to 12 decimals).</div>
                  ) : (
                    <div className="text-xs text-neutral-500">If set, viewers must stake this amount (confirmed) to enable P2P assist.</div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Stake note (optional)</label>
                  <input
                    value={stakeNote}
                    onChange={(e) => setStakeNote(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    disabled={status === "connecting"}
                    placeholder="anti-leech bond…"
                  />
                  <div className="text-xs text-neutral-500">Shown on the watch page if set.</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Host mode</label>
                  <select
                    value={hostMode}
                    onChange={(e) => setHostMode(e.target.value === "host_only" ? "host_only" : "p2p_economy")}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    disabled={status === "connecting"}
                  >
                    <option value="p2p_economy">P2P Economy (rebroadcast queue + fee waivers)</option>
                    <option value="host_only">Host-Only (no rebroadcast waivers)</option>
                  </select>
                  <div className="text-xs text-neutral-500">
                    Advertised in the stream announce so viewers can apply the same policy.
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Rebroadcast active set threshold (T)</label>
                  <input
                    value={rebroadcastThresholdInput}
                    onChange={(e) => setRebroadcastThresholdInput(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono disabled:opacity-60"
                    disabled={status === "connecting" || hostMode === "host_only"}
                    placeholder="6"
                  />
                  {rebroadcastThresholdInvalid ? (
                    <div className="text-xs text-red-300">Use a positive integer.</div>
                  ) : hostMode === "host_only" ? (
                    <div className="text-xs text-neutral-500">Not used in Host-Only mode.</div>
                  ) : (
                    <div className="text-xs text-neutral-500">First-come viewers fill active set up to T; others remain queued.</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Caption tracks (optional, one per line)</label>
                  <textarea
                    value={captionLines}
                    onChange={(e) => setCaptionLines(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none min-h-24 font-mono"
                    disabled={status === "connecting"}
                    placeholder={"en|English|/api/hls/stream/subs-en.vtt|default\nes|Espanol|https://cdn.example.com/subs-es.vtt"}
                  />
                  {captionInputError ? (
                    <div className="text-xs text-red-300">{captionInputError}</div>
                  ) : (
                    <div className="text-xs text-neutral-500">Format: `lang|label|url|default(optional)`.</div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Rendition playlists (optional, one per line)</label>
                  <textarea
                    value={renditionLines}
                    onChange={(e) => setRenditionLines(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none min-h-24 font-mono"
                    disabled={status === "connecting"}
                    placeholder={"1080p|/api/hls/stream/1080.m3u8|6000000|1920|1080|avc1.640028,mp4a.40.2\n720p|/api/hls/stream/720.m3u8|3000000|1280|720|avc1.4d401f,mp4a.40.2"}
                  />
                  {renditionInputError ? (
                    <div className="text-xs text-red-300">{renditionInputError}</div>
                  ) : (
                    <div className="text-xs text-neutral-500">
                      Format: `id|url|bandwidth|width|height|codecs`. If two or more are present, watch auto-builds a master playlist.
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-xs text-neutral-300 select-none cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={autoLadder}
                      onChange={(e) => setAutoLadder(e.target.checked)}
                      className="accent-blue-500"
                      disabled={status === "connecting"}
                    />
                    Auto-generate ladder hints (source + 720p/480p/360p derived renditions)
                  </label>
                  {autoLadderRenditionPreview.length > 0 && (
                    <div className="text-[11px] text-neutral-500 font-mono break-all">
                      {autoLadderRenditionPreview.map((entry) => `${entry.id}:${entry.url}`).join(" | ")}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Source</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSourceMode("camera")}
                      className={`px-3 py-2 rounded-xl border text-sm ${
                        sourceMode === "camera"
                          ? "bg-blue-600/20 border-blue-500/40 text-blue-200"
                          : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                      }`}
                      disabled={status === "connecting" || status === "live"}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Camera className="w-4 h-4" /> Camera
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceMode("screen")}
                      className={`px-3 py-2 rounded-xl border text-sm ${
                        sourceMode === "screen"
                          ? "bg-blue-600/20 border-blue-500/40 text-blue-200"
                          : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                      }`}
                      disabled={status === "connecting" || status === "live"}
                    >
                      <span className="inline-flex items-center gap-2">
                        <MonitorUp className="w-4 h-4" /> Screen
                      </span>
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Audio</label>
                  <label className="flex items-center gap-2 text-sm text-neutral-300 select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeAudio}
                      onChange={(e) => setIncludeAudio(e.target.checked)}
                      className="accent-blue-500"
                      disabled={status === "connecting" || status === "live"}
                    />
                    Include microphone
                  </label>
                  <div className="text-xs text-neutral-500">
                    Tip: if playback looks blank in Safari, try disabling mic audio.
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Video max bitrate (kbps, optional)</label>
                  <input
                    value={videoMaxBitrateKbps}
                    onChange={(e) => setVideoMaxBitrateKbps(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                    disabled={status === "connecting" || status === "live"}
                    placeholder="2500"
                  />
                  {videoMaxBitrateInvalid ? (
                    <div className="text-xs text-red-300">Use a positive integer.</div>
                  ) : (
                    <div className="text-xs text-neutral-500">Applied to video RTP sender (`maxBitrate`).</div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Video max FPS (optional)</label>
                  <input
                    value={videoMaxFps}
                    onChange={(e) => setVideoMaxFps(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                    disabled={status === "connecting" || status === "live"}
                    placeholder="30"
                  />
                  {videoMaxFpsInvalid ? (
                    <div className="text-xs text-red-300">Use a positive integer.</div>
                  ) : (
                    <div className="text-xs text-neutral-500">Applied to camera/screen constraints and RTP sender (`maxFramerate`).</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400 flex items-center gap-2">
                    <Camera className="w-4 h-4" /> Camera
                  </label>
                  <select
                    value={videoDeviceId}
                    onChange={(e) => setVideoDeviceId(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none truncate"
                    disabled={status === "connecting" || status === "live" || sourceMode !== "camera"}
                  >
                    <option value="">Default Camera</option>
                    {devices
                      .filter((d) => d.kind === "videoinput")
                      .map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Camera ${d.deviceId.slice(0, 6)}…`}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-neutral-400 flex items-center gap-2">
                    <Mic className="w-4 h-4" /> Microphone
                  </label>
                  <select
                    value={audioDeviceId}
                    onChange={(e) => setAudioDeviceId(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none truncate"
                    disabled={status === "connecting" || status === "live" || !includeAudio}
                  >
                    <option value="">Default Mic</option>
                    {devices
                      .filter((d) => d.kind === "audioinput")
                      .map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Mic ${d.deviceId.slice(0, 6)}…`}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                {mediaStream ? (
                  <button
                    onClick={stopPreview}
                    className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                    disabled={status === "connecting" || status === "live"}
                  >
                    Stop Preview
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      void startPreview();
                    }}
                    className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                  >
                    {sourceMode === "screen" ? "Share Screen" : "Start Preview"}
                  </button>
                )}

                {status === "live" ? (
                  <button onClick={endStream} className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-bold flex items-center gap-2">
                    <Square className="w-4 h-4" /> End Stream
                  </button>
                ) : (
                  <button
                    onClick={goLive}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                    disabled={!mediaStream || status === "connecting"}
                  >
                    <Radio className="w-4 h-4" /> Go Live
                  </button>
                )}

                {status === "live" && identity && (
                  <button
                    onClick={() => {
                      void (async () => {
                        try {
                          setAnnounceStep("checking");
                          const ok = await announce("live");
                          setLastAnnounceAt(Date.now());
                          setAnnounceStep(ok ? "ok" : "fail");
                        } catch {
                          setAnnounceStep("fail");
                        }
                      })();
                    }}
                    className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                    title="Republish the stream announce event (kind 30311)"
                    disabled={announceStep === "checking"}
                  >
                    Update Announce
                  </button>
                )}

                <Link
                  href={`/watch/${identity ? pubkeyHexToNpub(identity.pubkey) ?? identity.pubkey : "npub"}/${streamId}`}
                  className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm inline-flex items-center gap-2"
                  title="Open watch page for this stream"
                >
                  Watch <ExternalLink className="w-4 h-4" />
                </Link>

                <button
                  onClick={copyWatchLink}
                  className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                  title="Copy watch link"
                >
                  {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy Link"}
                </button>
              </div>

              <div className="text-xs text-neutral-500">
                Announce streaming hint: <span className="font-mono break-all">{hlsHintUrl}</span>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="h-[520px]">
              <ChatBox streamPubkey={identity?.pubkey ?? ""} streamId={streamId} />
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Stream Links</div>
                <label className="flex items-center gap-2 text-xs text-neutral-400 select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoAnnounce}
                    onChange={(e) => setAutoAnnounce(e.target.checked)}
                    className="accent-blue-500"
                  />
                  Auto-announce
                </label>
              </div>

              <div className="text-xs text-neutral-500">
                Watch URL: <span className="font-mono break-all text-neutral-300">{watchUrl}</span>
              </div>

              {identity && (
                <div className="text-xs text-neutral-500">
                  Origin stream: <span className="font-mono break-all text-neutral-300">{originStreamId ?? "…"}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 text-xs">
                <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                  <span className="text-neutral-400">HLS</span>
                  <span className="font-mono text-neutral-300">
                    {hlsStep === "idle"
                      ? "idle"
                      : hlsStep === "checking"
                        ? `checking${hlsLastCode ? ` (${hlsLastCode})` : ""}`
                        : hlsStep === "ok"
                          ? "ready"
                          : "failed"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                  <span className="text-neutral-400">Announce</span>
	                  <span className="font-mono text-neutral-300">
	                    {announceStep === "idle"
	                      ? "idle"
	                      : announceStep === "checking"
	                        ? "publishing…"
	                        : announceStep === "ok"
	                          ? `ok${announceReport ? ` (${announceReport.okRelays.length}/${relays.length})` : ""}${lastAnnounceAt ? ` (${new Date(lastAnnounceAt).toLocaleTimeString()})` : ""}`
	                          : `failed${announceReport ? ` (${announceReport.okRelays.length}/${relays.length})` : ""}`}
	                  </span>
	                </div>
	              </div>

              <div className="text-xs text-neutral-500">
                Your identity: <span className="font-mono break-all text-neutral-300">{npub ?? "Connect identity"}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
              <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Checklist</div>
              <ul className="text-sm text-neutral-300 space-y-2">
                <li>1) Start Docker stack: `infra/stream`</li>
                <li>2) Connect identity (header)</li>
                <li>3) Start preview, then Go Live</li>
                <li>4) Open Watch page and chat</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-2 text-sm text-neutral-300">
              <div className="font-semibold">Relays</div>
              <div className="text-xs text-neutral-500">Using {relays.length} configured relay(s):</div>
              <div className="text-xs font-mono text-neutral-300 break-all">{relays.join(", ")}</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
