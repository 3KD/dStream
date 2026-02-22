"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleDot, Camera, Mic, MonitorUp, Radio, Square, AlertTriangle, ExternalLink, PictureInPicture2 } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { ChatBox } from "@/components/chat/ChatBox";
import { useIdentity } from "@/context/IdentityContext";
import { useQuickPlay } from "@/context/QuickPlayContext";
import { useSocial } from "@/context/SocialContext";
import { WhipClient } from "@/lib/whip";
import { getNostrRelays } from "@/lib/config";
import { publishEventDetailed, type PublishEventReport } from "@/lib/publish";
import { PAYMENT_ASSET_META, PAYMENT_ASSET_ORDER } from "@/lib/payments/catalog";
import { getPaymentRailForMethod } from "@/lib/payments/rails";
import {
  createPaymentMethodDraft,
  paymentMethodToDraft,
  type PaymentMethodDraft,
  validatePaymentAddress,
  validatePaymentMethodDrafts
} from "@/lib/payments/methods";
import {
  buildStreamAnnounceEvent,
  type StreamCaptionTrack,
  type StreamGuildFeeWaiver,
  type StreamHostMode,
  type StreamPaymentAsset,
  type StreamRendition,
  type StreamVodVisibility
} from "@dstream/protocol";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";
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

function safeDefaultStreamId(pubkeyHex?: string | null) {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const keyPrefix = pubkeyHex ? pubkeyHex.slice(0, 12) : "anon";
  return `${keyPrefix}-live-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function normalizeStreamIdParam(input: string | null): string | null {
  const streamId = (input ?? "").trim();
  if (!streamId) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(streamId)) return null;
  return streamId;
}

type StepStatus = "idle" | "checking" | "ok" | "fail";
type StoredBroadcastSession = { pubkey: string; streamId: string; originStreamId: string; startedAt: number };
type LadderProfile = { id: string; width: number; height: number; bandwidth: number };
type SourceMode = "camera" | "screen" | "camera_screen_pip";
type CaptureResolutionPreset = "source" | "1080p" | "720p" | "480p";
type EncoderGuide = "obs" | "streamlabs" | "vmix" | "xsplit" | "prism";

const AUTO_LADDER_PROFILES: LadderProfile[] = [
  { id: "360p", width: 640, height: 360, bandwidth: 700_000 }
];
const DEFAULT_BROADCAST_MAX_BITRATE_KBPS = 1000;

const CAPTURE_RESOLUTION_PRESETS: Record<Exclude<CaptureResolutionPreset, "source">, { width: number; height: number }> = {
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  "480p": { width: 854, height: 480 }
};

const ENCODER_GUIDE_OPTIONS: Array<{ id: EncoderGuide; label: string }> = [
  { id: "obs", label: "OBS" },
  { id: "streamlabs", label: "Streamlabs" },
  { id: "vmix", label: "vMix" },
  { id: "xsplit", label: "XSplit" },
  { id: "prism", label: "PRISM" }
];

export default function BroadcastPage() {
  const { identity, signEvent } = useIdentity();
  const { quickPlayStream, setQuickPlayStream, clearQuickPlayStream } = useQuickPlay();
  const social = useSocial();
  const relays = useMemo(() => getNostrRelays(), []);
  const [requestedStreamId, setRequestedStreamId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const whipRef = useRef<WhipClient | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const statusRef = useRef<"idle" | "preview" | "connecting" | "live" | "error">("idle");
  const manualStopRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectInFlightRef = useRef(false);
  const lastWhipOptionsRef = useRef<{ videoMaxBitrateKbps?: number; videoMaxFps?: number }>({});
  const previewResourceCleanupRef = useRef<(() => void) | null>(null);

  const [streamId, setStreamId] = useState("");
  const [title, setTitle] = useState("Untitled Stream");
  const [summary, setSummary] = useState("");
  const [image, setImage] = useState("");
  const [xmr, setXmr] = useState("");
  const [paymentDrafts, setPaymentDrafts] = useState<PaymentMethodDraft[]>([]);
  const [stakeXmr, setStakeXmr] = useState("");
  const [stakeNote, setStakeNote] = useState("");
  const [captionLines, setCaptionLines] = useState("");
  const [renditionLines, setRenditionLines] = useState("");
  const [autoLadder, setAutoLadder] = useState(false);
  const [manifestSignerPubkey, setManifestSignerPubkey] = useState<string | null>(null);
  const [topicsCsv, setTopicsCsv] = useState("");
  const [hostMode, setHostMode] = useState<StreamHostMode>("p2p_economy");
  const [rebroadcastThresholdInput, setRebroadcastThresholdInput] = useState("6");
  const [vodArchiveEnabled, setVodArchiveEnabled] = useState(false);
  const [vodVisibility, setVodVisibility] = useState<StreamVodVisibility>("public");
  const [feeWaiverGuilds, setFeeWaiverGuilds] = useState<StreamGuildFeeWaiver[]>([]);
  const [vipPubkeys, setVipPubkeys] = useState<string[]>([]);
  const [viewerAllowPubkeys, setViewerAllowPubkeys] = useState<string[]>([]);
  const [waiverGuildPubkeyInput, setWaiverGuildPubkeyInput] = useState("");
  const [waiverGuildIdInput, setWaiverGuildIdInput] = useState("");
  const [vipPubkeyInput, setVipPubkeyInput] = useState("");
  const [viewerAllowInput, setViewerAllowInput] = useState("");
  const [waiverInputError, setWaiverInputError] = useState<string | null>(null);
  const [viewerAllowInputError, setViewerAllowInputError] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState<string>("");
  const [audioDeviceId, setAudioDeviceId] = useState<string>("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("camera");
  const [captureResolution, setCaptureResolution] = useState<CaptureResolutionPreset>("source");
  const [bitratePreset, setBitratePreset] = useState<"custom" | "low" | "medium" | "high">("low");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [videoMaxBitrateKbps, setVideoMaxBitrateKbps] = useState(String(DEFAULT_BROADCAST_MAX_BITRATE_KBPS));
  const [videoMaxFps, setVideoMaxFps] = useState("");
  const [autoReconnectEnabled, setAutoReconnectEnabled] = useState(true);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [chatSlowModeSecInput, setChatSlowModeSecInput] = useState("");
  const [chatSubscriberOnly, setChatSubscriberOnly] = useState(false);
  const [chatFollowerOnly, setChatFollowerOnly] = useState(false);
  const [chatClearRequestNonce, setChatClearRequestNonce] = useState(0);
  const [chatClearRequestState, setChatClearRequestState] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [discoverable, setDiscoverable] = useState(true);
  const [matureContent, setMatureContent] = useState(false);

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [externalEncoderOpen, setExternalEncoderOpen] = useState(false);
  const [encoderGuide, setEncoderGuide] = useState<EncoderGuide>("obs");
  const [encoderCopyStatus, setEncoderCopyStatus] = useState<string | null>(null);
  const [previewPipAvailable, setPreviewPipAvailable] = useState(false);
  const [previewPipActive, setPreviewPipActive] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    try {
      const streamIdParam = new URLSearchParams(window.location.search).get("streamId");
      setRequestedStreamId(normalizeStreamIdParam(streamIdParam));
    } catch {
      setRequestedStreamId(null);
    }
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
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      previewResourceCleanupRef.current?.();
      previewResourceCleanupRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    if (chatClearRequestState !== "ok" && chatClearRequestState !== "error") return;
    const timeout = setTimeout(() => setChatClearRequestState("idle"), 3500);
    return () => clearTimeout(timeout);
  }, [chatClearRequestState]);

  const clearStoredSession = useCallback(() => {
    try {
      localStorage.removeItem("dstream_broadcast_session_v1");
    } catch {
      // ignore
    }
    setStoredSession(null);
  }, []);

  const requestChatWindowClear = useCallback(() => {
    setChatClearRequestState("pending");
    setChatClearRequestNonce((prev) => prev + 1);
  }, []);

  const handleChatClearRequestHandled = useCallback((ok: boolean) => {
    setChatClearRequestState(ok ? "ok" : "error");
  }, []);

  // Restore draft stream metadata (best-effort).
  useEffect(() => {
    if (draftLoaded) return;
    if (social.isLoading) return;
    try {
      const raw = localStorage.getItem("dstream_broadcast_draft_v1");
      if (!raw) {
        setStreamId(requestedStreamId ?? safeDefaultStreamId(identity?.pubkey ?? null));
        setXmr(social.settings.paymentDefaults.xmrTipAddress);
        setPaymentDrafts(social.settings.paymentDefaults.paymentMethods.map((method) => paymentMethodToDraft(method)));
        setStakeXmr(social.settings.paymentDefaults.stakeXmr);
        setStakeNote(social.settings.paymentDefaults.stakeNote);
        setHostMode(social.settings.broadcastHostMode);
        setRebroadcastThresholdInput(String(social.settings.broadcastRebroadcastThreshold));
        setCaptureResolution("source");
        setBitratePreset("custom");
        setAutoReconnectEnabled(true);
        setReconnectAttempt(0);
        setChatSlowModeSecInput("");
        setChatSubscriberOnly(false);
        setChatFollowerOnly(false);
        setDiscoverable(true);
        setMatureContent(false);
        setVodArchiveEnabled(false);
        setVodVisibility("public");
        setFeeWaiverGuilds([]);
        setVipPubkeys([]);
        setViewerAllowPubkeys([]);
        setCaptionLines("");
        setRenditionLines("");
        setVideoMaxBitrateKbps("");
        setVideoMaxFps("");
        return;
      }

      const parsed = JSON.parse(raw);

      if (requestedStreamId) setStreamId(requestedStreamId);
      else if (typeof parsed.streamId === "string" && parsed.streamId.trim()) setStreamId(parsed.streamId.trim());
      else setStreamId(safeDefaultStreamId(identity?.pubkey ?? null));

      if (typeof parsed.title === "string") setTitle(parsed.title);
      if (typeof parsed.summary === "string") setSummary(parsed.summary);
      if (typeof parsed.image === "string") setImage(parsed.image);
      if (typeof parsed.xmr === "string") setXmr(parsed.xmr);
      if (Array.isArray(parsed.paymentMethods)) {
        setPaymentDrafts(
          parsed.paymentMethods
            .map((row: any) => {
              if (!row || typeof row !== "object") return null;
              const asset = PAYMENT_ASSET_ORDER.includes((row.asset ?? "").toString().toLowerCase() as StreamPaymentAsset)
                ? ((row.asset ?? "").toString().toLowerCase() as StreamPaymentAsset)
                : null;
              if (!asset) return null;
              return {
                asset,
                address: typeof row.address === "string" ? row.address : "",
                network: typeof row.network === "string" ? row.network : "",
                label: typeof row.label === "string" ? row.label : "",
                amount: typeof row.amount === "string" ? row.amount : ""
              } satisfies PaymentMethodDraft;
            })
            .filter((row: PaymentMethodDraft | null): row is PaymentMethodDraft => !!row)
        );
      } else {
        setPaymentDrafts(social.settings.paymentDefaults.paymentMethods.map((method) => paymentMethodToDraft(method)));
      }
      if (typeof parsed.stakeXmr === "string") setStakeXmr(parsed.stakeXmr);
      if (typeof parsed.stakeNote === "string") setStakeNote(parsed.stakeNote);
      if (parsed.hostMode === "host_only" || parsed.hostMode === "p2p_economy") setHostMode(parsed.hostMode);
      if (typeof parsed.rebroadcastThresholdInput === "string") setRebroadcastThresholdInput(parsed.rebroadcastThresholdInput);
      else if (typeof parsed.rebroadcastThresholdInput === "number") setRebroadcastThresholdInput(String(parsed.rebroadcastThresholdInput));
      if (typeof parsed.vodArchiveEnabled === "boolean") setVodArchiveEnabled(parsed.vodArchiveEnabled);
      if (parsed.vodVisibility === "public" || parsed.vodVisibility === "private") setVodVisibility(parsed.vodVisibility);
      else setVodVisibility("public");
      if (Array.isArray(parsed.feeWaiverGuilds)) {
        const normalizedGuilds = parsed.feeWaiverGuilds
          .map((item: any) => {
            const guildPubkey = pubkeyParamToHex(typeof item?.guildPubkey === "string" ? item.guildPubkey : "") ?? "";
            const guildId = typeof item?.guildId === "string" ? item.guildId.trim() : "";
            if (!guildPubkey || !guildId) return null;
            return { guildPubkey, guildId } satisfies StreamGuildFeeWaiver;
          })
          .filter((item: StreamGuildFeeWaiver | null): item is StreamGuildFeeWaiver => !!item);
        setFeeWaiverGuilds(normalizedGuilds);
      } else {
        setFeeWaiverGuilds([]);
      }
      if (Array.isArray(parsed.vipPubkeys)) {
        const normalizedVips = parsed.vipPubkeys
          .map((item: any) => pubkeyParamToHex(typeof item === "string" ? item : "") ?? "")
          .filter((item: string) => !!item);
        setVipPubkeys(Array.from(new Set(normalizedVips)));
      } else {
        setVipPubkeys([]);
      }
      if (Array.isArray(parsed.viewerAllowPubkeys)) {
        const normalizedAllow = parsed.viewerAllowPubkeys
          .map((item: any) => pubkeyParamToHex(typeof item === "string" ? item : "") ?? "")
          .filter((item: string) => !!item);
        setViewerAllowPubkeys(Array.from(new Set(normalizedAllow)));
      } else {
        setViewerAllowPubkeys([]);
      }
      if (typeof parsed.captionLines === "string") setCaptionLines(parsed.captionLines);
      if (typeof parsed.renditionLines === "string") setRenditionLines(parsed.renditionLines);
      if (typeof parsed.autoLadder === "boolean") setAutoLadder(parsed.autoLadder);
      if (typeof parsed.topicsCsv === "string") setTopicsCsv(parsed.topicsCsv);
      if (typeof parsed.videoMaxBitrateKbps === "string") setVideoMaxBitrateKbps(parsed.videoMaxBitrateKbps);
      if (typeof parsed.videoMaxFps === "string") setVideoMaxFps(parsed.videoMaxFps);
      if (parsed.captureResolution === "source" || parsed.captureResolution === "1080p" || parsed.captureResolution === "720p" || parsed.captureResolution === "480p") {
        setCaptureResolution(parsed.captureResolution);
      }
      if (parsed.bitratePreset === "custom" || parsed.bitratePreset === "low" || parsed.bitratePreset === "medium" || parsed.bitratePreset === "high") {
        setBitratePreset(parsed.bitratePreset);
      }
      if (typeof parsed.autoReconnectEnabled === "boolean") setAutoReconnectEnabled(parsed.autoReconnectEnabled);
      if (typeof parsed.chatSlowModeSecInput === "string") setChatSlowModeSecInput(parsed.chatSlowModeSecInput);
      if (typeof parsed.chatSubscriberOnly === "boolean") setChatSubscriberOnly(parsed.chatSubscriberOnly);
      if (typeof parsed.chatFollowerOnly === "boolean") setChatFollowerOnly(parsed.chatFollowerOnly);
      if (typeof parsed.discoverable === "boolean") setDiscoverable(parsed.discoverable);
      else setDiscoverable(true);
      if (typeof parsed.matureContent === "boolean") setMatureContent(parsed.matureContent);
      else setMatureContent(false);
    } catch {
      setStreamId(requestedStreamId ?? safeDefaultStreamId(identity?.pubkey ?? null));
      setXmr(social.settings.paymentDefaults.xmrTipAddress);
      setPaymentDrafts(social.settings.paymentDefaults.paymentMethods.map((method) => paymentMethodToDraft(method)));
      setStakeXmr(social.settings.paymentDefaults.stakeXmr);
      setStakeNote(social.settings.paymentDefaults.stakeNote);
      setHostMode(social.settings.broadcastHostMode);
      setRebroadcastThresholdInput(String(social.settings.broadcastRebroadcastThreshold));
      setCaptureResolution("source");
      setBitratePreset("custom");
      setAutoReconnectEnabled(true);
      setReconnectAttempt(0);
      setChatSlowModeSecInput("");
      setChatSubscriberOnly(false);
      setChatFollowerOnly(false);
      setDiscoverable(true);
      setMatureContent(false);
      setVodArchiveEnabled(false);
      setFeeWaiverGuilds([]);
      setVipPubkeys([]);
      setViewerAllowPubkeys([]);
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
    identity?.pubkey,
    social.settings.paymentDefaults.stakeNote,
    social.settings.paymentDefaults.paymentMethods,
    social.settings.paymentDefaults.stakeXmr,
    social.settings.paymentDefaults.xmrTipAddress,
    requestedStreamId
  ]);

  useEffect(() => {
    if (!requestedStreamId) return;
    setStreamId(requestedStreamId);
  }, [requestedStreamId]);

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
          paymentMethods: paymentDrafts,
          stakeXmr,
          stakeNote,
          hostMode,
          rebroadcastThresholdInput,
          vodArchiveEnabled,
          vodVisibility,
          feeWaiverGuilds,
          vipPubkeys,
          viewerAllowPubkeys,
          captionLines,
          renditionLines,
          autoLadder,
          captureResolution,
          bitratePreset,
          videoMaxBitrateKbps,
          videoMaxFps,
          autoReconnectEnabled,
          chatSlowModeSecInput,
          chatSubscriberOnly,
          chatFollowerOnly,
          discoverable,
          matureContent,
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
    captureResolution,
    bitratePreset,
    autoReconnectEnabled,
    chatSlowModeSecInput,
    chatSubscriberOnly,
    chatFollowerOnly,
    discoverable,
    matureContent,
    hostMode,
    paymentDrafts,
    stakeNote,
    stakeXmr,
    rebroadcastThresholdInput,
    vodArchiveEnabled,
    vodVisibility,
    feeWaiverGuilds,
    vipPubkeys,
    viewerAllowPubkeys,
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
  const effectiveVideoMaxBitrateKbps = useMemo(
    () => videoMaxBitrateParsed ?? DEFAULT_BROADCAST_MAX_BITRATE_KBPS,
    [videoMaxBitrateParsed]
  );
  const videoMaxFpsParsed = useMemo(() => parsePositiveInt(videoMaxFps), [videoMaxFps]);
  const chatSlowModeSecParsed = useMemo(() => parsePositiveInt(chatSlowModeSecInput), [chatSlowModeSecInput]);
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
  const chatSlowModeSecInvalid = useMemo(
    () => chatSlowModeSecInput.trim() !== "" && chatSlowModeSecParsed === null,
    [chatSlowModeSecInput, chatSlowModeSecParsed]
  );
  const parsedCaptions = useMemo(() => parseCaptionLines(captionLines), [captionLines]);
  const parsedRenditions = useMemo(() => parseRenditionLines(renditionLines), [renditionLines]);
  const captionInputError = parsedCaptions.error;
  const renditionInputError = parsedRenditions.error;
  const xmrInputError = useMemo(() => {
    const value = xmr.trim();
    if (!value) return null;
    return validatePaymentAddress("xmr", value);
  }, [xmr]);
  const paymentValidation = useMemo(() => validatePaymentMethodDrafts(paymentDrafts), [paymentDrafts]);
  const paymentInputError = paymentValidation.errors[0] ?? null;
  const captureResolutionDims = useMemo(() => {
    if (captureResolution === "source") return null;
    return CAPTURE_RESOLUTION_PRESETS[captureResolution];
  }, [captureResolution]);

  const originStreamId = useMemo(() => {
    if (!identity) return null;
    return makeOriginStreamId(identity.pubkey, streamId);
  }, [identity, streamId]);

  useEffect(() => {
    if (!identity || !originStreamId) return;
    const ownerPubkey = identity.pubkey.toLowerCase();
    if (status === "live") {
      setQuickPlayStream({
        streamPubkey: ownerPubkey,
        streamId,
        title: title.trim() || "Untitled Stream",
        hlsUrl: `/api/hls/${encodeURIComponent(originStreamId)}/index.m3u8`,
        whepUrl: `/api/whep/${encodeURIComponent(originStreamId)}/whep`
      });
      return;
    }
    if (status === "idle" || status === "error") {
      if (quickPlayStream?.streamPubkey === ownerPubkey && quickPlayStream.streamId === streamId) {
        clearQuickPlayStream();
      }
    }
  }, [
    clearQuickPlayStream,
    identity,
    originStreamId,
    quickPlayStream?.streamId,
    quickPlayStream?.streamPubkey,
    setQuickPlayStream,
    status,
    streamId,
    title
  ]);

  const autoLadderRenditionPreview = useMemo(() => {
    if (!autoLadder || !originStreamId) return [];
    const source = {
      id: "source",
      url: `/api/hls/${originStreamId}/index.m3u8`,
      bandwidth: effectiveVideoMaxBitrateKbps * 1000,
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
  }, [autoLadder, effectiveVideoMaxBitrateKbps, originStreamId]);

  const topics = useMemo(() => {
    return topicsCsv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 24);
  }, [topicsCsv]);

  const addPaymentDraft = useCallback(() => {
    setPaymentDrafts((prev) => [...prev, createPaymentMethodDraft()]);
  }, []);

  const removePaymentDraft = useCallback((index: number) => {
    setPaymentDrafts((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }, []);

  const updatePaymentDraft = useCallback((index: number, patch: Partial<PaymentMethodDraft>) => {
    setPaymentDrafts((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }, []);

  const addWaiverGuild = useCallback(() => {
    setWaiverInputError(null);
    const guildPubkey = pubkeyParamToHex(waiverGuildPubkeyInput);
    const guildId = waiverGuildIdInput.trim();
    if (!guildPubkey) {
      setWaiverInputError("Guild owner pubkey must be an `npub…` or 64-hex key.");
      return;
    }
    if (!guildId) {
      setWaiverInputError("Guild ID is required for guild waivers.");
      return;
    }
    setFeeWaiverGuilds((prev) => {
      const exists = prev.some((item) => item.guildPubkey === guildPubkey && item.guildId === guildId);
      if (exists) return prev;
      return [...prev, { guildPubkey, guildId }];
    });
    setWaiverGuildPubkeyInput("");
    setWaiverGuildIdInput("");
  }, [waiverGuildIdInput, waiverGuildPubkeyInput]);

  const removeWaiverGuild = useCallback((guildPubkey: string, guildId: string) => {
    setFeeWaiverGuilds((prev) => prev.filter((item) => !(item.guildPubkey === guildPubkey && item.guildId === guildId)));
  }, []);

  const addVipPubkey = useCallback(() => {
    setWaiverInputError(null);
    const vipPubkey = pubkeyParamToHex(vipPubkeyInput);
    if (!vipPubkey) {
      setWaiverInputError("VIP pubkey must be an `npub…` or 64-hex key.");
      return;
    }
    setVipPubkeys((prev) => (prev.includes(vipPubkey) ? prev : [...prev, vipPubkey]));
    setVipPubkeyInput("");
  }, [vipPubkeyInput]);

  const removeVipPubkey = useCallback((vipPubkey: string) => {
    setVipPubkeys((prev) => prev.filter((item) => item !== vipPubkey));
  }, []);

  const addViewerAllowPubkey = useCallback(() => {
    setViewerAllowInputError(null);
    const viewerPubkey = pubkeyParamToHex(viewerAllowInput);
    if (!viewerPubkey) {
      setViewerAllowInputError("Viewer pubkey must be an `npub…` or 64-hex key.");
      return;
    }
    if (viewerPubkey === identity?.pubkey?.toLowerCase()) {
      setViewerAllowInputError("You are always allowed as stream owner.");
      return;
    }
    setViewerAllowPubkeys((prev) => (prev.includes(viewerPubkey) ? prev : [...prev, viewerPubkey]));
    setViewerAllowInput("");
  }, [identity?.pubkey, viewerAllowInput]);

  const removeViewerAllowPubkey = useCallback((viewerPubkey: string) => {
    setViewerAllowPubkeys((prev) => prev.filter((item) => item !== viewerPubkey));
  }, []);

  const setBitratePresetWithDefaults = useCallback((preset: "custom" | "low" | "medium" | "high") => {
    setBitratePreset(preset);
    if (preset === "custom") return;
    if (preset === "low") setVideoMaxBitrateKbps("1000");
    if (preset === "medium") setVideoMaxBitrateKbps("2500");
    if (preset === "high") setVideoMaxBitrateKbps("4500");
  }, []);

  const npub = useMemo(() => (identity ? pubkeyHexToNpub(identity.pubkey) : null), [identity]);
  const watchPath = useMemo(() => {
    if (!identity) return `/watch/npub/${streamId}`;
    return `/watch/${npub ?? identity.pubkey}/${streamId}`;
  }, [identity, npub, streamId]);
  const watchUrl = useMemo(() => (origin ? `${origin}${watchPath}` : watchPath), [origin, watchPath]);

  const announceStatusLabel = useMemo(() => {
    if (announceStep === "idle") return "idle";
    if (announceStep === "checking") return "publishing";
    if (announceStep === "ok") return "ok";
    return "failed";
  }, [announceStep]);

  const announceStatusMeta = useMemo(() => {
    if (!announceReport) return null;
    return `${announceReport.okRelays.length}/${relays.length} relays`;
  }, [announceReport, relays.length]);

  const lastAnnounceLabel = useMemo(() => {
    if (!lastAnnounceAt) return null;
    return new Date(lastAnnounceAt).toLocaleTimeString();
  }, [lastAnnounceAt]);

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

  const externalStreamKey = useMemo(() => {
    return originStreamId ?? "";
  }, [originStreamId]);

  const rtmpServerUrl = useMemo(() => {
    const configured = process.env.NEXT_PUBLIC_RTMP_INGEST_ORIGIN?.trim();
    if (configured) return configured.replace(/\/$/, "");

    try {
      if (origin) {
        const parsed = new URL(origin);
        return `rtmp://${parsed.hostname}:1940`;
      }
      if (typeof window !== "undefined") return `rtmp://${window.location.hostname}:1940`;
    } catch {
      // ignore
    }
    return "rtmp://localhost:1940";
  }, [origin]);

  const rtmpPublishUrl = useMemo(() => {
    if (!externalStreamKey) return "";
    return `${rtmpServerUrl}/${externalStreamKey}`;
  }, [externalStreamKey, rtmpServerUrl]);

  const whipPublishUrl = useMemo(() => {
    if (!externalStreamKey) return "";
    if (origin) return `${origin}/api/whip/${externalStreamKey}/whip`;
    return `/api/whip/${externalStreamKey}/whip`;
  }, [externalStreamKey, origin]);

  const encoderGuideSteps = useMemo(() => {
    const streamKeyValue = externalStreamKey || "<connect identity + valid stream id>";
    const shared = [
      "Open stream output settings and choose Custom RTMP.",
      `Server: ${rtmpServerUrl}`,
      `Stream key: ${streamKeyValue}`,
      "Start streaming from your encoder, then click “Announce Live (External)” below."
    ];
    switch (encoderGuide) {
      case "streamlabs":
        return ["Open Settings → Stream in Streamlabs.", ...shared];
      case "vmix":
        return ["Open Settings → Outputs/NDI/SRT → Streaming in vMix.", ...shared];
      case "xsplit":
        return ["Open Broadcast → Set up a new output → Custom RTMP in XSplit.", ...shared];
      case "prism":
        return ["Open Channels → Add Channel → RTMP in PRISM.", ...shared];
      case "obs":
      default:
        return ["Open Settings → Stream in OBS.", ...shared];
    }
  }, [encoderGuide, externalStreamKey, rtmpServerUrl]);

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

  const copyExternalEncoderValue = useCallback(async (label: string, value: string) => {
    if (!value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(value);
      setEncoderCopyStatus(`${label} copied`);
      setTimeout(() => setEncoderCopyStatus(null), 1500);
    } catch {
      setEncoderCopyStatus(`Failed to copy ${label.toLowerCase()}`);
      setTimeout(() => setEncoderCopyStatus(null), 1800);
    }
  }, []);

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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaStream) {
      setPreviewPipAvailable(false);
      setPreviewPipActive(false);
      return;
    }

    const pipDoc = document as Document & {
      pictureInPictureElement?: Element;
      pictureInPictureEnabled?: boolean;
    };
    const pipVideo = video as HTMLVideoElement & {
      disablePictureInPicture?: boolean;
      requestPictureInPicture?: () => Promise<void>;
      webkitSetPresentationMode?: (mode: "inline" | "picture-in-picture" | "fullscreen") => void;
      webkitPresentationMode?: string;
    };
    const supportsNative =
      pipDoc.pictureInPictureEnabled === true &&
      !pipVideo.disablePictureInPicture &&
      typeof pipVideo.requestPictureInPicture === "function";
    const supportsWebkit = typeof pipVideo.webkitSetPresentationMode === "function";
    setPreviewPipAvailable(supportsNative || supportsWebkit);

    const syncPipState = () => {
      const nativeActive = pipDoc.pictureInPictureElement === video;
      const webkitActive = pipVideo.webkitPresentationMode === "picture-in-picture";
      setPreviewPipActive(nativeActive || webkitActive);
    };

    syncPipState();
    video.addEventListener("enterpictureinpicture", syncPipState as any);
    video.addEventListener("leavepictureinpicture", syncPipState as any);
    video.addEventListener("webkitpresentationmodechanged", syncPipState as any);

    return () => {
      video.removeEventListener("enterpictureinpicture", syncPipState as any);
      video.removeEventListener("leavepictureinpicture", syncPipState as any);
      video.removeEventListener("webkitpresentationmodechanged", syncPipState as any);
      setPreviewPipActive(false);
    };
  }, [mediaStream]);

  const togglePreviewPip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const pipDoc = document as Document & {
      pictureInPictureElement?: Element;
      pictureInPictureEnabled?: boolean;
      exitPictureInPicture?: () => Promise<void>;
    };
    const pipVideo = video as HTMLVideoElement & {
      disablePictureInPicture?: boolean;
      requestPictureInPicture?: () => Promise<void>;
      webkitSetPresentationMode?: (mode: "inline" | "picture-in-picture" | "fullscreen") => void;
      webkitPresentationMode?: string;
    };

    try {
      if (pipDoc.pictureInPictureElement && typeof pipDoc.exitPictureInPicture === "function") {
        await pipDoc.exitPictureInPicture();
        return;
      }

      if (
        pipDoc.pictureInPictureEnabled === true &&
        !pipVideo.disablePictureInPicture &&
        typeof pipVideo.requestPictureInPicture === "function"
      ) {
        await pipVideo.requestPictureInPicture();
        return;
      }

      if (typeof pipVideo.webkitSetPresentationMode === "function") {
        const nextMode = pipVideo.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture";
        pipVideo.webkitSetPresentationMode(nextMode);
      }
    } catch {
      // ignore
    }
  }, []);

  const stopPreview = () => {
    previewResourceCleanupRef.current?.();
    previewResourceCleanupRef.current = null;
    const stream = mediaStreamRef.current;
    stream?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    setMediaStream(null);
    setStatus((prev) => (prev === "live" ? prev : "idle"));
  };

  const startPreview = async (modeOverride?: SourceMode) => {
    setError(null);
    const mode = modeOverride ?? sourceMode;
    setSourceMode(mode);

    try {
      stopPreview();

      const applyResolutionConstraints = async (track: MediaStreamTrack | undefined) => {
        if (!track || !captureResolutionDims || !track.applyConstraints) return;
        try {
          await track.applyConstraints({
            width: { ideal: captureResolutionDims.width, max: captureResolutionDims.width },
            height: { ideal: captureResolutionDims.height, max: captureResolutionDims.height }
          });
        } catch {
          // Some devices can't satisfy strict capture dimensions.
        }
      };

      let stream: MediaStream;
      if (mode === "screen") {
        const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia;
        if (!getDisplayMedia) throw new Error("Screen share is not supported in this browser.");

        stream = await getDisplayMedia.call(navigator.mediaDevices, { video: true, audio: false } as any);
        await applyResolutionConstraints(stream.getVideoTracks()[0]);
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
      } else if (mode === "camera") {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not supported in this browser.");
        const videoConstraints: MediaTrackConstraints = {};
        if (videoDeviceId) videoConstraints.deviceId = { exact: videoDeviceId };
        if (videoMaxFpsParsed) videoConstraints.frameRate = { ideal: videoMaxFpsParsed, max: videoMaxFpsParsed };
        if (captureResolutionDims) {
          videoConstraints.width = { ideal: captureResolutionDims.width, max: captureResolutionDims.width };
          videoConstraints.height = { ideal: captureResolutionDims.height, max: captureResolutionDims.height };
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: Object.keys(videoConstraints).length > 0 ? videoConstraints : true,
          audio: includeAudio ? (audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true) : false
        });
      } else {
        const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia;
        if (!getDisplayMedia) throw new Error("Screen share is not supported in this browser.");
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not supported in this browser.");

        const screenStream = await getDisplayMedia.call(navigator.mediaDevices, { video: true, audio: false } as any);
        await applyResolutionConstraints(screenStream.getVideoTracks()[0]);

        const cameraVideoConstraints: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 360 } };
        if (videoDeviceId) cameraVideoConstraints.deviceId = { exact: videoDeviceId };
        if (videoMaxFpsParsed) cameraVideoConstraints.frameRate = { ideal: videoMaxFpsParsed, max: videoMaxFpsParsed };
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: cameraVideoConstraints,
          audio: includeAudio ? (audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true) : false
        });

        const screenTrack = screenStream.getVideoTracks()[0];
        const screenSettings = screenTrack?.getSettings?.() ?? {};
        const width = captureResolutionDims?.width ?? Math.trunc((screenSettings.width as number | undefined) ?? 1280);
        const height = captureResolutionDims?.height ?? Math.trunc((screenSettings.height as number | undefined) ?? 720);

        const screenVideo = document.createElement("video");
        screenVideo.srcObject = screenStream;
        screenVideo.muted = true;
        screenVideo.playsInline = true;
        await screenVideo.play();

        const cameraVideo = document.createElement("video");
        cameraVideo.srcObject = cameraStream;
        cameraVideo.muted = true;
        cameraVideo.playsInline = true;
        await cameraVideo.play();

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(320, width);
        canvas.height = Math.max(180, height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Failed to initialize compositing canvas.");

        let rafId = 0;
        const draw = () => {
          context.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
          const pipWidth = Math.round(canvas.width * 0.24);
          const pipHeight = Math.round((pipWidth / 16) * 9);
          const margin = Math.max(12, Math.round(canvas.width * 0.015));
          const pipX = canvas.width - pipWidth - margin;
          const pipY = canvas.height - pipHeight - margin;
          context.fillStyle = "rgba(0,0,0,0.45)";
          context.fillRect(pipX - 4, pipY - 4, pipWidth + 8, pipHeight + 8);
          context.drawImage(cameraVideo, pipX, pipY, pipWidth, pipHeight);
          rafId = requestAnimationFrame(draw);
        };
        draw();

        const composed = canvas.captureStream(videoMaxFpsParsed ?? 30);
        const micTrack = cameraStream.getAudioTracks()[0] ?? null;
        if (micTrack) composed.addTrack(micTrack);

        previewResourceCleanupRef.current = () => {
          if (rafId) cancelAnimationFrame(rafId);
          try {
            screenVideo.pause();
            cameraVideo.pause();
            screenVideo.srcObject = null;
            cameraVideo.srcObject = null;
          } catch {
            // ignore
          }
          screenStream.getTracks().forEach((track) => track.stop());
          cameraStream.getTracks().forEach((track) => track.stop());
        };

        stream = composed;
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
    if (xmrInputError) throw new Error(xmrInputError);
    if (paymentInputError) throw new Error(paymentInputError);
    if (chatSlowModeSecInvalid) throw new Error("Chat slow mode seconds must be a positive integer.");

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
              bandwidth: effectiveVideoMaxBitrateKbps * 1000
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
      payments: paymentValidation.methods,
      hostMode,
      rebroadcastThreshold: hostMode === "p2p_economy" ? rebroadcastThresholdParsed ?? 6 : undefined,
      streamChatSlowModeSec: chatSlowModeSecParsed ?? undefined,
      streamChatSubscriberOnly: chatSubscriberOnly,
      streamChatFollowerOnly: chatFollowerOnly,
      discoverable,
      matureContent,
      viewerAllowPubkeys,
      vodArchiveEnabled,
      vodVisibility,
      feeWaiverGuilds,
      feeWaiverVipPubkeys: vipPubkeys,
      stakeAmountAtomic,
      stakeNote: stakeAmountAtomic ? (stakeNote.trim() || undefined) : undefined,
      captions: parsedCaptions.tracks,
      renditions: mergedRenditions,
      manifestSignerPubkey: manifestSignerPubkey ?? undefined,
      topics
    });

    const signed = await signEvent(unsigned);
    try {
      await fetch("/api/playback-access/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ announceEvent: signed }),
        cache: "no-store"
      });
    } catch {
      // ignore (playback policy registration is best-effort)
    }
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
    paymentInputError,
    xmrInputError,
    paymentValidation.methods,
    parsedRenditions.renditions,
    rebroadcastThresholdInvalid,
    rebroadcastThresholdParsed,
    chatSlowModeSecInvalid,
    chatSlowModeSecParsed,
    chatSubscriberOnly,
    chatFollowerOnly,
    discoverable,
    matureContent,
    viewerAllowPubkeys,
    vodArchiveEnabled,
    vodVisibility,
    feeWaiverGuilds,
    vipPubkeys,
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
    effectiveVideoMaxBitrateKbps,
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

  const reconnectPublish = useCallback(
    async (reason: string) => {
      if (reconnectInFlightRef.current) return;
      if (!identity) return;
      const stream = mediaStreamRef.current;
      if (!stream) return;

      reconnectInFlightRef.current = true;
      setReconnectAttempt((value) => value + 1);
      setStatus("connecting");
      try {
        whipRef.current?.close();
      } catch {
        // ignore
      }

      try {
        const originStreamId = makeOriginStreamId(identity.pubkey, streamId);
        if (!originStreamId) throw new Error(`Invalid Stream ID. ${describeOriginStreamIdRules()}`);
        const endpoint = `${window.location.origin}/api/whip/${originStreamId}/whip`;
        const client = new WhipClient(endpoint);
        whipRef.current = client;
        await client.publish(stream, {
          ...lastWhipOptionsRef.current,
          onConnectionStateChange: (state) => {
            if (manualStopRef.current) return;
            if (state === "failed" || state === "disconnected") {
              setError(`WHIP connection ${state}. Reconnecting…`);
              if (reconnectTimerRef.current) return;
              reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                void reconnectPublish(state);
              }, 1600);
            }
          }
        });
        setStatus("live");
        setError(`Recovered from ${reason}; stream reconnected.`);
        try {
          setAnnounceStep("checking");
          const ok = await announce("live");
          setLastAnnounceAt(Date.now());
          setAnnounceStep(ok ? "ok" : "fail");
        } catch {
          setAnnounceStep("fail");
        }
      } catch (err: any) {
        setStatus("error");
        setError(err?.message ?? `Failed to reconnect after ${reason}.`);
      } finally {
        reconnectInFlightRef.current = false;
      }
    },
    [announce, identity, streamId]
  );

  const scheduleReconnect = useCallback(
    (reason: string) => {
      if (!autoReconnectEnabled || manualStopRef.current) return;
      if (statusRef.current !== "live" && statusRef.current !== "connecting") return;
      if (reconnectTimerRef.current) return;
      setError(`WHIP connection ${reason}. Reconnecting…`);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void reconnectPublish(reason);
      }, 1600);
    },
    [autoReconnectEnabled, reconnectPublish]
  );

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
    if (chatSlowModeSecInvalid) {
      setError("Chat slow mode seconds must be a positive integer.");
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
      manualStopRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const originStreamId = makeOriginStreamId(identity.pubkey, streamId);
      if (!originStreamId) {
        setError(`Invalid Stream ID. ${describeOriginStreamIdRules()}`);
        setStatus("error");
        return;
      }

      const endpoint = `${window.location.origin}/api/whip/${originStreamId}/whip`;
      const client = new WhipClient(endpoint);
      whipRef.current = client;
      lastWhipOptionsRef.current = {
        videoMaxBitrateKbps: effectiveVideoMaxBitrateKbps,
        videoMaxFps: videoMaxFpsParsed ?? undefined
      };
      await client.publish(mediaStream, {
        videoMaxBitrateKbps: effectiveVideoMaxBitrateKbps,
        videoMaxFps: videoMaxFpsParsed ?? undefined,
        onConnectionStateChange: (connectionState) => {
          if (connectionState === "failed" || connectionState === "disconnected") {
            scheduleReconnect(connectionState);
          }
        }
      });
      setStatus("live");
      setReconnectAttempt(0);

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
    manualStopRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
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

  const announceExternal = useCallback(
    async (nextStatus: "live" | "ended") => {
      if (!identity) {
        setError("Connect an identity first (NIP-07 preferred).");
        return;
      }
      if (!originStreamId) {
        setError(`Invalid Stream ID. ${describeOriginStreamIdRules()}`);
        return;
      }

      setError(null);
      try {
        setAnnounceStep("checking");
        const ok = await announce(nextStatus);
        setLastAnnounceAt(Date.now());
        setAnnounceStep(ok ? "ok" : "fail");

        if (nextStatus === "live") {
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
          if (!ok) setError("External stream is live, but announce failed on relays.");
        } else {
          clearStoredSession();
          if (!ok) setError("External stream ended locally, but end announce failed on relays.");
        }
      } catch (e: any) {
        setAnnounceStep("fail");
        setError(e?.message ?? `Failed to announce external stream (${nextStatus}).`);
      }
    },
    [announce, clearStoredSession, identity, originStreamId, streamId]
  );

  const checkExternalIngest = useCallback(async () => {
    setHlsStep("checking");
    setHlsLastCode(null);
    try {
      const res = await fetch(hlsLocalUrl, { cache: "no-store" });
      setHlsLastCode(res.status);
      setHlsStep(res.ok ? "ok" : "fail");
    } catch {
      setHlsLastCode(null);
      setHlsStep("fail");
    }
  }, [hlsLocalUrl]);

  return (
      <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-[1720px] mx-auto px-6 pb-10 pt-6">
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
              className={`min-w-[120px] text-center px-3 py-1.5 rounded-full text-xs font-bold border shadow-lg ${
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

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_440px] gap-6 items-start">
          <div className="space-y-6 min-w-0">
            <div className="relative bg-black rounded-2xl overflow-hidden border border-neutral-800 min-h-[52vh] lg:min-h-[60vh] xl:min-h-[64vh] max-h-[80vh]">
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
                    <button
                      onClick={() => {
                        void startPreview("camera_screen_pip");
                      }}
                      className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                    >
                      Camera + Screen
                    </button>
                  </div>
                  <div className="text-xs text-neutral-500">Your browser will ask for permission after you click.</div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-5">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                  <div className="space-y-2">
                    <label className="text-xs text-neutral-400">Source</label>
                    <div className="flex items-center gap-2 flex-wrap">
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
                      <button
                        type="button"
                        onClick={() => setSourceMode("camera_screen_pip")}
                        className={`px-3 py-2 rounded-xl border text-sm ${
                          sourceMode === "camera_screen_pip"
                            ? "bg-blue-600/20 border-blue-500/40 text-blue-200"
                            : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                        }`}
                        disabled={status === "connecting" || status === "live"}
                      >
                        <span className="inline-flex items-center gap-2">
                          <Camera className="w-4 h-4" />
                          <MonitorUp className="w-4 h-4" />
                          Camera + Screen
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 md:justify-self-end">
                    <label className="text-xs text-neutral-400">Audio</label>
                    <label className="flex items-center gap-2 text-sm text-neutral-300 select-none cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={includeAudio}
                        onChange={(e) => setIncludeAudio(e.target.checked)}
                        className="accent-blue-500"
                        disabled={status === "connecting" || status === "live"}
                      />
                      Include microphone
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-1">
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
                      {sourceMode === "screen" ? "Share Screen" : sourceMode === "camera_screen_pip" ? "Share + Camera PiP" : "Start Preview"}
                    </button>
                  )}

                  {mediaStream && previewPipAvailable ? (
                    <button
                      type="button"
                      onClick={() => {
                        void togglePreviewPip();
                      }}
                      className={`px-4 py-2 rounded-xl border text-sm inline-flex items-center gap-2 ${
                        previewPipActive
                          ? "bg-blue-600/20 border-blue-500/40 text-blue-200"
                          : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                      }`}
                      title={previewPipActive ? "Return preview to page" : "Pop preview out into a movable picture-in-picture window"}
                    >
                      <PictureInPicture2 className="w-4 h-4" />
                      {previewPipActive ? "Return Preview" : "Pop Out Preview"}
                    </button>
                  ) : null}

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
                      <Radio className="w-4 h-4" /> Start Stream
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
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-neutral-400">Stream ID (Nostr d-tag)</label>
                    <button
                      type="button"
                      onClick={() => setStreamId(safeDefaultStreamId(identity?.pubkey ?? null))}
                      disabled={status === "connecting" || status === "live"}
                      className="px-2 py-1 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 text-[11px] text-neutral-300 disabled:opacity-50"
                      title="Generate from identity pubkey + timestamp"
                    >
                      Auto from pubkey
                    </button>
                  </div>
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

              <div className="ui-surface-soft p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-neutral-100">Ingest + encoder tools</div>
                    <p className="text-xs text-neutral-500">Use external tools only when streaming from OBS/Streamlabs/vMix/XSplit/PRISM.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExternalEncoderOpen((prev) => !prev)}
                    className="ui-pill"
                    data-active={externalEncoderOpen}
                    aria-expanded={externalEncoderOpen}
                    aria-controls="broadcast-external-encoder"
                  >
                    <span className="text-sm leading-none">{externalEncoderOpen ? "^" : "v"}</span>
                    <span>{externalEncoderOpen ? "Hide External Tools" : "Show External Tools"}</span>
                  </button>
                </div>

                <div className="text-xs text-neutral-500">
                  HLS hint: <span className="font-mono break-all">{hlsHintUrl}</span>
                </div>

                {externalEncoderOpen ? (
                  <div id="broadcast-external-encoder" className="pt-3 border-t border-neutral-800 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-neutral-100">External Encoder</div>
                        <p className="text-xs text-neutral-500">
                          Use custom RTMP from desktop software. Keep this page open to publish announce events.
                        </p>
                      </div>
                      {encoderCopyStatus ? (
                        <span className="px-2 py-1 rounded-lg border border-blue-500/40 bg-blue-600/20 text-[11px] text-blue-200">
                          {encoderCopyStatus}
                        </span>
                      ) : null}
                    </div>

                    {!identity || !originStreamId ? (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        Connect identity and keep a valid Stream ID to generate a stable external stream key.
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs text-neutral-400">RTMP server</label>
                        <div className="flex gap-2">
                          <input
                            value={rtmpServerUrl}
                            readOnly
                            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono text-neutral-200"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void copyExternalEncoderValue("RTMP server", rtmpServerUrl);
                            }}
                            className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-neutral-400">Stream key</label>
                        <div className="flex gap-2">
                          <input
                            value={externalStreamKey || ""}
                            readOnly
                            placeholder="Connect identity first"
                            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono text-neutral-200 placeholder:text-neutral-500"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void copyExternalEncoderValue("Stream key", externalStreamKey);
                            }}
                            disabled={!externalStreamKey}
                            className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs disabled:opacity-50"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-neutral-400">RTMP publish URL (reference)</label>
                        <div className="flex gap-2">
                          <input
                            value={rtmpPublishUrl}
                            readOnly
                            placeholder="Generated from server + key"
                            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono text-neutral-200 placeholder:text-neutral-500"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void copyExternalEncoderValue("RTMP URL", rtmpPublishUrl);
                            }}
                            disabled={!rtmpPublishUrl}
                            className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs disabled:opacity-50"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-neutral-400">WHIP endpoint (optional, WHIP-capable encoders)</label>
                        <div className="flex gap-2">
                          <input
                            value={whipPublishUrl}
                            readOnly
                            placeholder="Generated from stream key"
                            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono text-neutral-200 placeholder:text-neutral-500"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void copyExternalEncoderValue("WHIP endpoint", whipPublishUrl);
                            }}
                            disabled={!whipPublishUrl}
                            className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs disabled:opacity-50"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-xs text-neutral-400">Quick setup</label>
                      <div className="flex flex-wrap gap-2">
                        {ENCODER_GUIDE_OPTIONS.map((guide) => (
                          <button
                            key={guide.id}
                            type="button"
                            onClick={() => setEncoderGuide(guide.id)}
                            className={`px-3 py-1.5 rounded-lg border text-xs ${
                              encoderGuide === guide.id
                                ? "bg-blue-600/20 border-blue-500/40 text-blue-200"
                                : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                            }`}
                          >
                            {guide.label}
                          </button>
                        ))}
                      </div>
                      <ol className="list-decimal pl-5 space-y-1 text-xs text-neutral-300">
                        {encoderGuideSteps.map((step, index) => (
                          <li key={`encoder-guide-${index}`}>{step}</li>
                        ))}
                      </ol>
                    </div>

                    <div className="flex flex-wrap gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          void announceExternal("live");
                        }}
                        disabled={!identity || !originStreamId || announceStep === "checking"}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-bold disabled:opacity-50"
                      >
                        Announce Live (External)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void announceExternal("ended");
                        }}
                        disabled={!identity || !originStreamId || announceStep === "checking"}
                        className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
                      >
                        Announce Ended
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void checkExternalIngest();
                        }}
                        className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                      >
                        Check External Feed
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="pt-2 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((prev) => !prev)}
                  className="ui-pill"
                  data-active={advancedOpen}
                  aria-expanded={advancedOpen}
                  aria-controls="broadcast-advanced-settings"
                >
                  <span className="text-lg leading-none">{advancedOpen ? "^" : "v"}</span>
                  <span>{advancedOpen ? "Hide Advanced Settings" : "Show Advanced Settings"}</span>
                </button>
              </div>

              {advancedOpen ? (
                <div id="broadcast-advanced-settings" className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-5">
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
                          setPaymentDrafts(social.settings.paymentDefaults.paymentMethods.map((method) => paymentMethodToDraft(method)));
                          setStakeXmr(social.settings.paymentDefaults.stakeXmr);
                          setStakeNote(social.settings.paymentDefaults.stakeNote);
                          setHostMode(social.settings.broadcastHostMode);
                          setRebroadcastThresholdInput(String(social.settings.broadcastRebroadcastThreshold));
                          setCaptureResolution("source");
                          setBitratePreset("custom");
                          setAutoReconnectEnabled(true);
                          setReconnectAttempt(0);
                          setChatSlowModeSecInput("");
                          setChatSubscriberOnly(false);
                          setChatFollowerOnly(false);
                          setMatureContent(false);
                          setVodArchiveEnabled(false);
                          setFeeWaiverGuilds([]);
                          setVipPubkeys([]);
                          setViewerAllowPubkeys([]);
                          setWaiverGuildPubkeyInput("");
                          setWaiverGuildIdInput("");
                          setVipPubkeyInput("");
                          setViewerAllowInput("");
                          setWaiverInputError(null);
                          setViewerAllowInputError(null);
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
                    {xmrInputError && <div className="text-xs text-red-300">{xmrInputError}</div>}
                    <div className="text-xs text-neutral-500">Shown on the watch page if set.</div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-neutral-400">Additional payout methods (optional)</label>
                      <button
                        type="button"
                        onClick={addPaymentDraft}
                        disabled={status === "connecting"}
                        className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                      >
                        Add method
                      </button>
                    </div>

                    {paymentDrafts.length === 0 ? (
                      <div className="text-xs text-neutral-500">No additional payout methods configured.</div>
                    ) : (
                      <div className="space-y-2">
                        {paymentDrafts.map((row, index) => {
                          const rail = getPaymentRailForMethod({
                            asset: row.asset,
                            address: row.address.trim(),
                            network: row.network.trim() || undefined,
                            label: row.label.trim() || undefined,
                            amount: row.amount.trim() || undefined
                          });
                          const networkToken = row.network.trim().toLowerCase();
                          const addressToken = row.address.trim().toLowerCase();
                          const isBtcLightning =
                            row.asset === "btc" &&
                            (networkToken === "lightning" ||
                              networkToken === "ln" ||
                              networkToken === "lnurl" ||
                              networkToken === "bolt11" ||
                              addressToken.startsWith("lnbc") ||
                              addressToken.startsWith("lntb") ||
                              addressToken.startsWith("lnbcrt") ||
                              addressToken.startsWith("lnurl") ||
                              addressToken.includes("@"));
                          return (
                            <div key={`broadcast-payment-${index}`} className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-950/40 p-2">
                              <div className="grid grid-cols-1 lg:grid-cols-[120px_1fr_130px_130px_130px_auto] gap-2">
                                <select
                                  value={row.asset}
                                  onChange={(e) => updatePaymentDraft(index, { asset: e.target.value as StreamPaymentAsset })}
                                  disabled={status === "connecting"}
                                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-2 text-xs"
                                >
                                  {PAYMENT_ASSET_ORDER.map((asset) => (
                                    <option key={asset} value={asset}>
                                      {PAYMENT_ASSET_META[asset].symbol}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={row.address}
                                  onChange={(e) => updatePaymentDraft(index, { address: e.target.value })}
                                  disabled={status === "connecting"}
                                  placeholder={PAYMENT_ASSET_META[row.asset].placeholder}
                                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono"
                                />
                                <input
                                  value={row.network}
                                  onChange={(e) => updatePaymentDraft(index, { network: e.target.value })}
                                  disabled={status === "connecting"}
                                  placeholder={row.asset === "btc" ? "network (bitcoin/lightning)" : "network"}
                                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs"
                                />
                                <input
                                  value={row.label}
                                  onChange={(e) => updatePaymentDraft(index, { label: e.target.value })}
                                  disabled={status === "connecting"}
                                  placeholder="label"
                                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs"
                                />
                                <input
                                  value={row.amount}
                                  onChange={(e) => updatePaymentDraft(index, { amount: e.target.value })}
                                  disabled={status === "connecting"}
                                  placeholder={isBtcLightning ? "amount sats" : "amount (optional)"}
                                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono"
                                />
                                <button
                                  type="button"
                                  onClick={() => removePaymentDraft(index)}
                                  disabled={status === "connecting"}
                                  className="px-3 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="text-[11px] text-neutral-500">
                                Rail:{" "}
                                <span className="text-neutral-300">
                                  {rail.name}
                                </span>{" "}
                                · {rail.execution === "verified_backend" ? "verified backend" : "wallet URI / copy"}
                                {row.amount.trim()
                                  ? ` · amount: ${row.amount.trim()}${isBtcLightning ? " sats" : ` ${PAYMENT_ASSET_META[row.asset].symbol}`}`
                                  : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {paymentInputError ? (
                      <div className="text-xs text-red-300">{paymentInputError}</div>
                    ) : (
                      <div className="text-xs text-neutral-500">
                        Supported assets: XMR, ETH, BTC (on-chain + Lightning), USDT, XRP, USDC, SOL, TRX, DOGE, BCH, ADA, PEPE.
                      </div>
                    )}
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

                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-3">
                    <label className="flex items-start gap-3 text-sm text-neutral-300 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={vodArchiveEnabled}
                        onChange={(e) => setVodArchiveEnabled(e.target.checked)}
                        className="mt-0.5 accent-blue-500"
                        disabled={status === "connecting" || status === "live"}
                      />
                      <span className="space-y-1">
                        <span className="font-medium text-neutral-200">Enable VOD archive and DVR controls</span>
                        <span className="block text-xs text-neutral-500">
                          Default is off for decentralized mode. Turn on only if you explicitly want server-side recording and viewer rewind/archive playback.
                        </span>
                      </span>
                    </label>
                    {vodArchiveEnabled ? (
                      <div className="mt-3 pt-3 border-t border-neutral-800/80 space-y-2">
                        <label className="text-xs text-neutral-400">VOD visibility</label>
                        <select
                          value={vodVisibility}
                          onChange={(event) => setVodVisibility(event.target.value === "private" ? "private" : "public")}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                          disabled={status === "connecting" || status === "live"}
                        >
                          <option value="public">Public (recommended for open channels)</option>
                          <option value="private">Private (owner + allowlist only)</option>
                        </select>
                        <div className="text-xs text-neutral-500">
                          Simple mode: choose one default. Public VOD is visible to everyone; private VOD requires stream-owner or allowlisted identity.
                        </div>
                      </div>
                    ) : null}
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

                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-3">
                    <label className="flex items-start gap-3 text-sm text-neutral-300 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={discoverable}
                        onChange={(e) => setDiscoverable(e.target.checked)}
                        className="mt-0.5 accent-blue-500"
                        disabled={status === "connecting"}
                      />
                      <span className="space-y-1">
                        <span className="font-medium text-neutral-200">List this stream in public discovery</span>
                        <span className="block text-xs text-neutral-500">
                          When off, your stream is hidden from dStream home/browse discovery surfaces but still reachable by direct watch link.
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-3">
                    <label className="flex items-start gap-3 text-sm text-neutral-300 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={matureContent}
                        onChange={(e) => setMatureContent(e.target.checked)}
                        className="mt-0.5 accent-blue-500"
                        disabled={status === "connecting"}
                      />
                      <span className="space-y-1">
                        <span className="font-medium text-neutral-200">Mark stream as mature content</span>
                        <span className="block text-xs text-neutral-500">
                          Adds a mature-content label in stream metadata. Viewers can filter these streams in discovery.
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
                    <div className="text-sm font-semibold text-neutral-200">Fee waivers (guild + VIP)</div>
                    <div className="text-xs text-neutral-500">
                      Let specific guild members or specific pubkeys access your stream without stake/pay requirement.
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        value={waiverGuildPubkeyInput}
                        onChange={(e) => setWaiverGuildPubkeyInput(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                        placeholder="Guild owner npub… or hex"
                        disabled={status === "connecting"}
                      />
                      <div className="flex gap-2">
                        <input
                          value={waiverGuildIdInput}
                          onChange={(e) => setWaiverGuildIdInput(e.target.value)}
                          className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                          placeholder="guildId"
                          disabled={status === "connecting"}
                        />
                        <button
                          type="button"
                          onClick={addWaiverGuild}
                          disabled={status === "connecting"}
                          className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
                        >
                          Add Guild
                        </button>
                      </div>
                    </div>

                    {feeWaiverGuilds.length > 0 ? (
                      <div className="space-y-2">
                        {feeWaiverGuilds.map((entry) => (
                          <div
                            key={`${entry.guildPubkey}:${entry.guildId}`}
                            className="flex items-center justify-between gap-3 text-xs bg-neutral-900/60 border border-neutral-800 rounded-xl px-3 py-2"
                          >
                            <span className="font-mono text-neutral-300 truncate">
                              {pubkeyHexToNpub(entry.guildPubkey) ?? shortenText(entry.guildPubkey, { head: 18, tail: 8 })} / {entry.guildId}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeWaiverGuild(entry.guildPubkey, entry.guildId)}
                              className="text-neutral-400 hover:text-white"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-neutral-500">No guild waivers configured.</div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                      <input
                        value={vipPubkeyInput}
                        onChange={(e) => setVipPubkeyInput(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                        placeholder="VIP npub… or hex"
                        disabled={status === "connecting"}
                      />
                      <button
                        type="button"
                        onClick={addVipPubkey}
                        disabled={status === "connecting"}
                        className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
                      >
                        Add VIP
                      </button>
                    </div>

                    {vipPubkeys.length > 0 ? (
                      <div className="space-y-2">
                        {vipPubkeys.map((vip) => (
                          <div
                            key={vip}
                            className="flex items-center justify-between gap-3 text-xs bg-neutral-900/60 border border-neutral-800 rounded-xl px-3 py-2"
                          >
                            <span className="font-mono text-neutral-300 truncate">{pubkeyHexToNpub(vip) ?? shortenText(vip, { head: 18, tail: 8 })}</span>
                            <button
                              type="button"
                              onClick={() => removeVipPubkey(vip)}
                              className="text-neutral-400 hover:text-white"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-neutral-500">No VIP users configured.</div>
                    )}

                    {waiverInputError && <div className="text-xs text-red-300">{waiverInputError}</div>}
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
                    <div className="text-sm font-semibold text-neutral-200">Private stream allowlist (optional)</div>
                    <div className="text-xs text-neutral-500">
                      If one or more viewers are listed here, playback is restricted to these pubkeys plus the stream owner.
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                      <input
                        value={viewerAllowInput}
                        onChange={(e) => setViewerAllowInput(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                        placeholder="Viewer npub… or hex"
                        disabled={status === "connecting"}
                      />
                      <button
                        type="button"
                        onClick={addViewerAllowPubkey}
                        disabled={status === "connecting"}
                        className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
                      >
                        Add Viewer
                      </button>
                    </div>

                    {viewerAllowPubkeys.length > 0 ? (
                      <div className="space-y-2">
                        {viewerAllowPubkeys.map((viewerPubkey) => (
                          <div
                            key={viewerPubkey}
                            className="flex items-center justify-between gap-3 text-xs bg-neutral-900/60 border border-neutral-800 rounded-xl px-3 py-2"
                          >
                            <span className="font-mono text-neutral-300 truncate">
                              {pubkeyHexToNpub(viewerPubkey) ?? shortenText(viewerPubkey, { head: 18, tail: 8 })}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeViewerAllowPubkey(viewerPubkey)}
                              className="text-neutral-400 hover:text-white"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-neutral-500">No private viewer allowlist. Stream is open to everyone.</div>
                    )}

                    {viewerAllowInputError ? <div className="text-xs text-red-300">{viewerAllowInputError}</div> : null}
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
                        Auto-generate ladder hints (source + 360p derived rendition)
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
                      <label className="text-xs text-neutral-400">Capture resolution preset</label>
                      <select
                        value={captureResolution}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (next === "source" || next === "1080p" || next === "720p" || next === "480p") {
                            setCaptureResolution(next);
                          }
                        }}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        disabled={status === "connecting" || status === "live"}
                      >
                        <option value="source">Source native</option>
                        <option value="1080p">1080p</option>
                        <option value="720p">720p</option>
                        <option value="480p">480p</option>
                      </select>
                      <div className="text-xs text-neutral-500">
                        Applied at capture constraints time (camera/screen/PiP canvas output).
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-neutral-400">Video max bitrate (kbps, optional)</label>
                      <input
                        value={videoMaxBitrateKbps}
                        onChange={(e) => {
                          setVideoMaxBitrateKbps(e.target.value);
                          setBitratePreset("custom");
                        }}
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
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-neutral-400">Bitrate preset</label>
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" },
                        { value: "custom", label: "Custom" }
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setBitratePresetWithDefaults(option.value as "custom" | "low" | "medium" | "high")}
                          disabled={status === "connecting" || status === "live"}
                          className={`px-3 py-1.5 rounded-lg border text-xs disabled:opacity-50 ${
                            bitratePreset === option.value
                              ? "bg-blue-600/20 border-blue-500/40 text-blue-200"
                              : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-neutral-500">
                      Presets set `video max bitrate` to 1000 / 2500 / 4500 kbps. Custom leaves manual input unchanged.
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-3 space-y-2">
                      <label className="flex items-start gap-3 text-sm text-neutral-300 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoReconnectEnabled}
                          onChange={(e) => setAutoReconnectEnabled(e.target.checked)}
                          className="mt-0.5 accent-blue-500"
                          disabled={status === "connecting"}
                        />
                        <span className="space-y-1">
                          <span className="font-medium text-neutral-200">Auto reconnect on WHIP disconnect</span>
                          <span className="block text-xs text-neutral-500">When enabled, publish restarts automatically after transient failures.</span>
                        </span>
                      </label>
                      <div className="text-[11px] text-neutral-500 font-mono">Reconnect attempts this session: {reconnectAttempt}</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
                    <div className="text-sm font-semibold text-neutral-200">Chat policy (viewer-side enforcement)</div>
                    <div className="text-xs text-neutral-500">
                      These policy tags are included in your live announce and enforced by dStream watch chat.
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="flex items-center gap-2 text-xs text-neutral-300 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={chatSubscriberOnly}
                          onChange={(e) => setChatSubscriberOnly(e.target.checked)}
                          className="accent-blue-500"
                          disabled={status === "connecting"}
                        />
                        Subscriber-only chat
                      </label>
                      <label className="flex items-center gap-2 text-xs text-neutral-300 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={chatFollowerOnly}
                          onChange={(e) => setChatFollowerOnly(e.target.checked)}
                          className="accent-blue-500"
                          disabled={status === "connecting"}
                        />
                        Follower-only chat
                      </label>
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-400">Slow mode seconds (optional)</label>
                        <input
                          value={chatSlowModeSecInput}
                          onChange={(e) => setChatSlowModeSecInput(e.target.value)}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs focus:border-blue-500 focus:outline-none font-mono"
                          disabled={status === "connecting"}
                          placeholder="10"
                        />
                        {chatSlowModeSecInvalid ? (
                          <div className="text-[11px] text-red-300">Use a positive integer.</div>
                        ) : (
                          <div className="text-[11px] text-neutral-500">Enforced per sender on supported clients.</div>
                        )}
                      </div>
                    </div>
                    <div className="pt-2 border-t border-neutral-800 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={requestChatWindowClear}
                        disabled={!identity || status === "connecting" || chatClearRequestState === "pending"}
                        className="px-3 py-2 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                      >
                        {chatClearRequestState === "pending" ? "Clearing Chat…" : "Clear Chat Window"}
                      </button>
                      {chatClearRequestState === "ok" ? (
                        <span className="text-[11px] text-emerald-300">Chat cleared for connected viewers.</span>
                      ) : null}
                      {chatClearRequestState === "error" ? (
                        <span className="text-[11px] text-red-300">Failed to clear chat on relays.</span>
                      ) : null}
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
                        disabled={status === "connecting" || status === "live" || sourceMode === "screen"}
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
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-6 xl:sticky xl:top-24">
            <div className="h-[68vh] min-h-[620px] max-h-[82vh] xl:h-[calc(100vh-7rem)] xl:max-h-[calc(100vh-7rem)] xl:min-h-[720px]">
              <ChatBox
                streamPubkey={identity?.pubkey ?? ""}
                streamId={streamId}
                slowModeSec={chatSlowModeSecParsed ?? undefined}
                subscriberOnly={chatSubscriberOnly}
                followerOnly={chatFollowerOnly}
                clearWindowRequestNonce={chatClearRequestNonce}
                onClearWindowRequestHandled={handleChatClearRequestHandled}
              />
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
                  <div className="min-w-[130px] text-right">
                    <div className="font-mono text-neutral-300">{announceStatusLabel}</div>
                    {announceStatusMeta ? <div className="text-[11px] text-neutral-500">{announceStatusMeta}</div> : null}
                  </div>
                </div>
              </div>

              {lastAnnounceLabel ? (
                <div className="text-[11px] text-neutral-500">Last announce: {lastAnnounceLabel}</div>
              ) : null}

              <div className="text-xs text-neutral-500">
                Your identity: <span className="font-mono break-all text-neutral-300">{npub ?? "Connect identity"}</span>
              </div>
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
