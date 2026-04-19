"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Flag, Star, X, Network, Share2, ArrowDownToLine, ArrowUpFromLine, Database, Download, Upload } from "lucide-react";
import QRCode from "qrcode";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { GlobalPlayerSlot } from "@/context/GlobalPlayerContext";
import { ChatBox } from "@/components/chat/ChatBox";
import { MoneroLogo } from "@/components/icons/MoneroLogo";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import { useStreamAnnounce } from "@/hooks/useStreamAnnounce";
import { useStreamIntegrity } from "@/hooks/useStreamIntegrity";
import { useStreamPresence } from "@/hooks/useStreamPresence";
import { usePublishPresence } from "@/hooks/usePublishPresence";
import { useStreamZaps } from "@/hooks/useStreamZaps";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { useIdentity } from "@/context/IdentityContext";
import { useQuickPlay } from "@/context/QuickPlayContext";
import { useSocial } from "@/context/SocialContext";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";
import { isHttpLikeMediaUrl, isLikelyHlsUrl, isLikelyPlayableMediaUrl, isLikelyPublicPlayableMediaUrl } from "@/lib/mediaUrl";
import { makeOriginStreamId } from "@/lib/origin";
import { getNostrRelays } from "@/lib/config";
import { PAYMENT_ASSET_META, buildPaymentUri, comparePaymentAssetOrder, getWalletIntegrationById } from "@/lib/payments/catalog";
import { groupPaymentMethodsByRail } from "@/lib/payments/rails";
import {
  getNativeWalletCapability,
  nativeWalletProviderLabel,
  nativeWalletSendNeedsAmount,
  sendNativeWalletPayment,
  supportsNativeWalletPayment
} from "@/lib/payments/nativeWallet";
import { publishEventDetailed } from "@/lib/publish";
import { buildSignedScopeProof, submitModerationReport } from "@/lib/moderation/reportClient";
import type { ReportReasonCode } from "@/lib/moderation/reportTypes";
import { formatXmrAtomic, resolveVideoPolicy, videoModeLabel } from "@/lib/videoPolicy";
import { buildZapRequestUnsigned } from "@/lib/zaps";
import { P2PSwarm, type P2PSwarmStats } from "@/lib/p2p/swarm";
import { createLocalSignalIdentity, type SignalIdentity } from "@/lib/p2p/localIdentity";
import { buildP2PBytesReceiptEvent, type StreamPaymentMethod } from "@dstream/protocol";

function base64EncodeUtf8(input: string): string {
  try {
    return btoa(unescape(encodeURIComponent(input)));
  } catch {
    return btoa(input);
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function normalizeHex64(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(value) ? value : null;
}

function isLikelyInternalStreamId(input: string): boolean {
  const value = input.trim().toLowerCase();
  if (!value) return false;
  if (/^[0-9a-f]{64}--.+/.test(value)) return true;
  if (/^[0-9a-f]{64}$/.test(value)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) return true;
  return false;
}

function withQueryParam(url: string, key: string, value: string | null): string {
  if (!value) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function formatRemainingMs(remainingMs: number): string {
  if (remainingMs <= 0) return "expired";
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

type WatchLayoutMode = "portrait" | "landscape" | "desktop";

function detectWatchLayoutMode(): WatchLayoutMode {
  if (typeof window === "undefined") return "portrait";

  const width = window.innerWidth;
  const height = Math.max(window.innerHeight, 1);
  const ratio = width / height;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const anyCoarsePointer = window.matchMedia("(any-pointer: coarse)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches || window.matchMedia("(any-pointer: fine)").matches;
  const hoverNone = window.matchMedia("(hover: none)").matches;
  const touchPoints =
    typeof navigator !== "undefined" && typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent ?? "" : "";
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Silk/i.test(userAgent);
  const touchCapable = mobileUserAgent || coarsePointer || anyCoarsePointer || hoverNone || touchPoints > 0;

  if (finePointer && !mobileUserAgent) return "desktop";
  if (!touchCapable) return "desktop";

  const orientationLandscape = window.matchMedia("(orientation: landscape)").matches;
  const isLandscape = orientationLandscape || (ratio > 1.05 && width >= 560);
  return isLandscape ? "landscape" : "portrait";
}


function P2PStatsPanel({ stats }: { stats: P2PSwarmStats | null }) {
  const [open, setOpen] = useState(false);
  if (!stats) return null;
  const toMB = (b: number) => (b / (1024 * 1024)).toFixed(2) + " MB";

  return (
    <div className="relative z-50">
      <button 
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/60 bg-emerald-900/20 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-900/40 uppercase tracking-wider transition-colors"
      >
        <Network className="w-3 h-3" />
        P2P Telemetry
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-[calc(100vw-2rem)] sm:w-[480px] bg-neutral-900 border border-neutral-700 rounded-xl p-4 shadow-2xl z-50">
          <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
            <Network className="w-24 h-24" />
          </div>
          <div className="mb-4 flex items-center justify-between relative z-10">
             <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-widest flex items-center gap-2">
                P2P Swarm Telemetry
             </h3>
             <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-white p-1">
               <X className="w-4 h-4" />
             </button>
          </div>
          <div className="grid grid-cols-2 gap-3 relative z-10">
            <div className="bg-neutral-950/50 rounded-lg p-2.5 border border-neutral-800/50">
              <div className="text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5"><Share2 className="w-3 h-3" /> Connect peers</div>
              <div className="font-mono text-white text-base">{stats.peersConnected} <span className="text-neutral-600 text-xs">/ {stats.peersDesired}</span></div>
            </div>
            <div className="bg-neutral-950/50 rounded-lg p-2.5 border border-neutral-800/50">
              <div className="text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5"><Download className="w-3 h-3 text-emerald-500" /> Bandwidth Saved</div>
              <div className="font-mono text-emerald-400 text-base">{toMB(stats.bytesFromPeers)}</div>
            </div>
            <div className="bg-neutral-950/50 rounded-lg p-2.5 border border-neutral-800/50">
              <div className="text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5"><Upload className="w-3 h-3 text-blue-500" /> Uploaded to Swarm</div>
              <div className="font-mono text-blue-400 text-base">{toMB(stats.bytesToPeers)}</div>
            </div>
            <div className="bg-neutral-950/50 rounded-lg p-2.5 border border-neutral-800/50">
              <div className="text-neutral-500 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5"><Database className="w-3 h-3 text-purple-500" /> Segment Cache</div>
              <div className="font-mono text-purple-400 text-base">{toMB(stats.cacheBytes)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WatchPage() {
  const routeParams = useParams<Record<string, string | string[]>>();
  const pubkeyParamRaw = routeParams?.pubkey;
  const streamIdRaw = routeParams?.streamId;
  const pubkeyParam = typeof pubkeyParamRaw === "string" ? pubkeyParamRaw : Array.isArray(pubkeyParamRaw) ? pubkeyParamRaw[0] ?? "" : "";
  const streamId = typeof streamIdRaw === "string" 
    ? streamIdRaw 
    : Array.isArray(streamIdRaw) 
      ? streamIdRaw.map(decodeURIComponent).join("/") 
      : "";
  const searchParams = useSearchParams();
  const e2e = searchParams.get("e2e") === "1";
  const manifestSignerQuery = normalizeHex64(searchParams.get("manifest"));
  const hlsOverrideQuery = searchParams.get("hls");
  const directPlaybackQuery = searchParams.get("u");
  const tipQueryOpen = searchParams.get("tip") === "1";
  const e2eHlsOverride = (() => {
    if (!hlsOverrideQuery) return null;
    const value = hlsOverrideQuery.trim();
    return isHttpLikeMediaUrl(value) ? value : null;
  })();
  const directPlaybackHint = (() => {
    if (!directPlaybackQuery) return null;
    const value = directPlaybackQuery.trim();
    return isLikelyPublicPlayableMediaUrl(value) ? value : null;
  })();
  const e2eSentRef = useRef({ loaded: false, player: false, chat: false, integrityVerified: false, integrityTamper: false });
  const tipAutoOpenedRef = useRef(false);
  const { identity, signEvent, nip04 } = useIdentity();
  const { setQuickPlayStream } = useQuickPlay();
  const social = useSocial();
  const relays = useMemo(() => getNostrRelays(), []);
  const pubkey = useMemo(() => pubkeyParamToHex(pubkeyParam), [pubkeyParam]);
  const npub = useMemo(() => (pubkey ? pubkeyHexToNpub(pubkey) : null), [pubkey]);
  const originStreamId = useMemo(() => (pubkey ? makeOriginStreamId(pubkey, streamId) : null), [pubkey, streamId]);

  const { announce, isLoading: announceLoading } = useStreamAnnounce(pubkey ?? "", streamId);
  const hostProfile = useNostrProfile(pubkey);
  const manifestSignerPubkey = announce?.manifestSignerPubkey ?? manifestSignerQuery;
  const { viewerCount, viewerPubkeys } = useStreamPresence({ streamPubkey: pubkey ?? "", streamId });
  const effectiveViewerCount = Math.max(viewerCount, announce?.currentParticipants ?? 0);
  const { count: zapCount, totalSats: zapTotalSats, isConnected: zapsConnected } = useStreamZaps({
    streamPubkey: pubkey ?? "",
    streamId
  });
  const { session: integritySession, snapshot: integritySnapshot } = useStreamIntegrity({
    streamPubkey: pubkey ?? "",
    streamId,
    manifestSignerPubkey
  });

  const stakeRequiredAtomic = useMemo(() => {
    const raw = announce?.stakeAmountAtomic;
    if (!raw) return null;
    try {
      const v = BigInt(raw);
      if (v <= 0n) return null;
      return raw;
    } catch {
      return null;
    }
  }, [announce?.stakeAmountAtomic]);

  const presenceEnabled = social.settings.presenceEnabled;

  const { status: presenceStatus, lastSentAt } = usePublishPresence({
    streamPubkey: pubkey ?? "",
    streamId,
    enabled: presenceEnabled
  });

  const p2pEnabled = social.settings.p2pAssistEnabled;

  const [stakeCopyStatus, setStakeCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [stake, setStake] = useState<{ session: string; address: string } | null>(null);
  const [stakeQr, setStakeQr] = useState<string | null>(null);
  const [stakeBusy, setStakeBusy] = useState<"idle" | "creating" | "checking">("idle");
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [stakeStatus, setStakeStatus] = useState<{
    totalAtomic: string;
    confirmedAtomic: string;
    transferCount: number;
    confirmationsRequired: number;
    lastObservedAtMs: number | null;
    lastTxid: string | null;
  } | null>(null);
  const [stakeRefundAddress, setStakeRefundAddress] = useState("");
  const [stakeRefundBusy, setStakeRefundBusy] = useState(false);
  const [stakeRefundError, setStakeRefundError] = useState<string | null>(null);
  const [stakeRefundResult, setStakeRefundResult] = useState<{
    settled: boolean;
    amountAtomic: string;
    txids: string[];
    servedBytes: number;
  } | null>(null);
  const videoPolicy = useMemo(() => (announce ? resolveVideoPolicy(announce) : { mode: "off" as const }), [announce]);
  const videoPriceAtomic = useMemo(() => {
    const raw = videoPolicy.priceAtomic;
    if (!raw || !/^\d+$/.test(raw)) return null;
    try {
      const value = BigInt(raw);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [videoPolicy.priceAtomic]);
  const videoPaidRequiresUnlock = useMemo(() => {
    if (!announce || announce.status !== "ended") return false;
    if (videoPolicy.mode !== "paid") return false;
    const currency = (videoPolicy.currency ?? "xmr").toLowerCase();
    return currency === "xmr" && videoPriceAtomic !== null;
  }, [announce, videoPolicy, videoPriceAtomic]);
  const videoPlaylistId = useMemo(() => (videoPolicy.playlistId ?? "").trim(), [videoPolicy.playlistId]);
  const videoEntitlementScope = useMemo<"stream" | "playlist">(
    () => (videoPolicy.accessScope === "playlist" && videoPlaylistId ? "playlist" : "stream"),
    [videoPlaylistId, videoPolicy.accessScope]
  );
  const [videoUnlocked, setVideoUnlocked] = useState(false);
  const [videoUnlockExpiresAtMs, setVideoUnlockExpiresAtMs] = useState<number | null>(null);
  const [videoAccessToken, setVideoAccessToken] = useState<string | null>(null);
  const [videoUnlockSession, setVideoUnlockSession] = useState<{ session: string; address: string } | null>(null);
  const [videoUnlockQr, setVideoUnlockQr] = useState<string | null>(null);
  const [videoUnlockCopyStatus, setVideoUnlockCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [videoUnlockBusy, setVideoUnlockBusy] = useState<"idle" | "creating" | "checking">("idle");
  const [videoUnlockError, setVideoUnlockError] = useState<string | null>(null);
  const [videoUnlockStatus, setVideoUnlockStatus] = useState<{
    found: boolean;
    amountAtomic: string | null;
    confirmed: boolean | null;
    observedAtMs: number | null;
  } | null>(null);
  const [videoNowMs, setVideoNowMs] = useState(() => Date.now());

  const stakeSatisfied = useMemo(() => {
    if (!stakeRequiredAtomic) return true;
    if (!stakeStatus) return false;
    try {
      return BigInt(stakeStatus.confirmedAtomic) >= BigInt(stakeRequiredAtomic);
    } catch {
      return false;
    }
  }, [stakeRequiredAtomic, stakeStatus]);

  const ephemeralSignalIdentityRef = useRef<SignalIdentity | null>(null);
  const signalIdentity = useMemo<SignalIdentity | null>(() => {
    if (identity && nip04) {
      return {
        pubkey: identity.pubkey,
        signEvent,
        nip04
      };
    }
    if (stakeRequiredAtomic) return null;
    if (!ephemeralSignalIdentityRef.current) {
      try {
        ephemeralSignalIdentityRef.current = createLocalSignalIdentity();
      } catch {
        ephemeralSignalIdentityRef.current = null;
      }
    }
    return ephemeralSignalIdentityRef.current;
  }, [identity, nip04, signEvent, stakeRequiredAtomic]);

  const p2pAllowed = useMemo(() => {
    if (!signalIdentity) return false;
    if (!stakeRequiredAtomic) return true;
    return stakeSatisfied && !!identity && !!nip04;
  }, [identity, nip04, signalIdentity, stakeRequiredAtomic, stakeSatisfied]);

  const [p2pSwarm, setP2pSwarm] = useState<P2PSwarm | null>(null);
  const [p2pStats, setP2pStats] = useState<P2PSwarmStats | null>(null);
  const [mobileLayoutMode, setMobileLayoutMode] = useState<WatchLayoutMode>(() => detectWatchLayoutMode());
  const [mobileDetailsExpanded, setMobileDetailsExpanded] = useState(true);
  const [scrollY, setScrollY] = useState(0);
  const mobilePortraitChatShellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateLayout = () => setMobileLayoutMode(detectWatchLayoutMode());

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);
    window.visualViewport?.addEventListener("resize", updateLayout);
    window.screen.orientation?.addEventListener?.("change", updateLayout);
    document.addEventListener("visibilitychange", updateLayout);
    const interval = window.setInterval(updateLayout, 900);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
      window.visualViewport?.removeEventListener("resize", updateLayout);
      window.screen.orientation?.removeEventListener?.("change", updateLayout);
      document.removeEventListener("visibilitychange", updateLayout);
    };
  }, []);

  const mobileLandscapeLayout = mobileLayoutMode === "landscape";
  const mobilePortraitLayout = mobileLayoutMode === "portrait";
  const desktopWatchLayout = mobileLayoutMode === "desktop";

  useEffect(() => {
    if (desktopWatchLayout || mobileLandscapeLayout) {
      setMobileDetailsExpanded(true);
    }
  }, [desktopWatchLayout, mobileLandscapeLayout]);


  useEffect(() => {
    if (!p2pEnabled || !p2pAllowed || !signalIdentity || !pubkey) {
      setP2pSwarm(null);
      setP2pStats(null);
      return;
    }

    const swarm = new P2PSwarm({
      identity: signalIdentity,
      relays,
      streamPubkey: pubkey,
      streamId
    });

    let alive = true;
    setP2pSwarm(swarm);
    void swarm.start().catch(() => {
      if (!alive) return;
      social.updateSettings({ p2pAssistEnabled: false });
    });

    return () => {
      alive = false;
      swarm.stop();
    };
  }, [p2pAllowed, p2pEnabled, pubkey, relays, signalIdentity, social.updateSettings, streamId]);

  useEffect(() => {
    if (!p2pEnabled || !p2pAllowed || !p2pSwarm) return;
    const self = signalIdentity?.pubkey ?? null;
    let desired = viewerPubkeys.filter((pk) => pk !== self && !social.isBlocked(pk));
    if (social.settings.p2pPeerMode === "trusted_only") {
      desired = desired.filter((pk) => social.isTrusted(pk));
    }
    p2pSwarm.setDesiredPeers(desired);
  }, [p2pAllowed, p2pEnabled, p2pSwarm, signalIdentity?.pubkey, social.isBlocked, social.isTrusted, social.settings.p2pPeerMode, viewerPubkeys]);

  useEffect(() => {
    if (!p2pEnabled || !p2pAllowed || !p2pSwarm) return;
    const tick = () => setP2pStats(p2pSwarm.getStats());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [p2pAllowed, p2pEnabled, p2pSwarm]);

  const isEnded = announce?.status === "ended";
  const streamPath = isEnded ? "/api/video/file" : "/api/hls";
  const fallbackUrl = originStreamId ? `${streamPath}/${originStreamId}/index.m3u8` : `${streamPath}/${streamId}/index.m3u8`;
  const renditionHints = useMemo(() => {
    return (announce?.renditions ?? [])
      .map((rendition) => ({
        id: rendition.id.trim(),
        url: rendition.url.trim(),
        bandwidth: rendition.bandwidth,
        width: rendition.width,
        height: rendition.height,
        codecs: rendition.codecs?.trim() || undefined
      }))
      .filter((rendition) => rendition.id && isLikelyPublicPlayableMediaUrl(rendition.url))
      .slice(0, 8);
  }, [announce?.renditions]);

  const renditionMasterUrl = useMemo(() => {
    if (renditionHints.length < 2) return null;
    const params = new URLSearchParams();
    renditionHints.forEach((rendition, index) => {
      params.set(`id${index}`, rendition.id);
      params.set(`u${index}`, rendition.url);
      if (rendition.bandwidth) params.set(`bw${index}`, String(rendition.bandwidth));
      if (rendition.width) params.set(`w${index}`, String(rendition.width));
      if (rendition.height) params.set(`h${index}`, String(rendition.height));
      if (rendition.codecs) params.set(`c${index}`, rendition.codecs);
    });
    return `/api/hls-master?${params.toString()}`;
  }, [renditionHints]);

  const announceStreamingHint = (announce?.streaming ?? "").trim();
  const canUseLocalFallback = useMemo(() => {
    if (e2eHlsOverride || directPlaybackHint) return false;
    if (announceStreamingHint) {
      if (!isLikelyPlayableMediaUrl(announceStreamingHint)) return false;
      const normalized = announceStreamingHint.toLowerCase();
      return (
        announceStreamingHint.startsWith("/") ||
        normalized.includes("/api/hls/") ||
        normalized.includes("://dstream.stream/") ||
        normalized.includes("://www.dstream.stream/")
      );
    }
    return isLikelyInternalStreamId(streamId);
  }, [announceStreamingHint, directPlaybackHint, e2eHlsOverride, streamId]);

  const streamUrl = useMemo(() => {
    if (e2eHlsOverride) return e2eHlsOverride;
    if (directPlaybackHint) return directPlaybackHint;
    if (renditionMasterUrl) return renditionMasterUrl;
    if (renditionHints[0]?.url) return renditionHints[0].url;
    if (isLikelyPublicPlayableMediaUrl(announceStreamingHint)) return announceStreamingHint;
    if (announceLoading && !canUseLocalFallback) return "";
    return canUseLocalFallback ? fallbackUrl : "";
  }, [
    announceLoading,
    announceStreamingHint,
    canUseLocalFallback,
    directPlaybackHint,
    e2eHlsOverride,
    fallbackUrl,
    renditionHints,
    renditionMasterUrl
  ]);
  const playbackStreamUrl = useMemo(() => {
    if (!videoPaidRequiresUnlock || !videoAccessToken) return streamUrl;
    return withQueryParam(streamUrl, "vat", videoAccessToken);
  }, [streamUrl, videoAccessToken, videoPaidRequiresUnlock]);

  const shouldTryWhep = useMemo(() => {
    if (!originStreamId) return false;
    if (!streamUrl) return false;
    return isLikelyHlsUrl(streamUrl);
  }, [originStreamId, streamUrl]);

  const whepSrc = useMemo(() => {
    if (!originStreamId || !shouldTryWhep) return null;
    return `/api/whep/${encodeURIComponent(originStreamId)}/whep`;
  }, [originStreamId, shouldTryWhep]);

  useEffect(() => {
    if (!pubkey || !streamId) return;
    const nextUrl = playbackStreamUrl.trim();
    if (!nextUrl || !isLikelyPlayableMediaUrl(nextUrl)) return;
    
    // Prevent the broadcaster's own screen from queueing into the global mini-player
    if (identity?.pubkey === pubkey) return;

    setQuickPlayStream({
      streamPubkey: pubkey,
      streamId,
      title: announce?.title?.trim() || "Live Stream",
      hlsUrl: nextUrl,
      whepUrl: shouldTryWhep ? whepSrc ?? undefined : undefined
    });
  }, [announce?.title, identity?.pubkey, playbackStreamUrl, pubkey, setQuickPlayStream, shouldTryWhep, streamId, whepSrc]);

  const captionTracks = useMemo(() => {
    return (announce?.captions ?? [])
      .map((caption) => ({
        src: caption.url.trim(),
        lang: caption.lang.trim().toLowerCase(),
        label: caption.label.trim(),
        isDefault: !!caption.isDefault
      }))
      .filter((caption) => caption.src && caption.lang && caption.label && isHttpLikeMediaUrl(caption.src))
      .slice(0, 8);
  }, [announce?.captions]);

  const postE2E = useCallback((payload: any) => {
    if (!e2e) return;
    try {
      const target = window.parent && window.parent !== window ? window.parent : window.opener;
      target?.postMessage(payload, window.location.origin);
    } catch {
      // ignore
    }
  }, [e2e]);

  useEffect(() => {
    if (!e2e) return;
    if (e2eSentRef.current.loaded) return;
    e2eSentRef.current.loaded = true;
    postE2E({ type: "dstream:e2e", t: "watch_loaded", streamPubkey: pubkey ?? "", streamId });
  }, [e2e, postE2E, pubkey, streamId]);

  useEffect(() => {
    if (!e2e) return;
    if (!integritySnapshot) return;
    if (integritySnapshot.lastTamper && !e2eSentRef.current.integrityTamper) {
      e2eSentRef.current.integrityTamper = true;
      postE2E({ type: "dstream:e2e", t: "watch_integrity_tamper", streamPubkey: pubkey ?? "", streamId });
    }
    if (integritySnapshot.verifiedOk > 0 && !e2eSentRef.current.integrityVerified) {
      e2eSentRef.current.integrityVerified = true;
      postE2E({ type: "dstream:e2e", t: "watch_integrity_verified", streamPubkey: pubkey ?? "", streamId });
    }
  }, [e2e, integritySnapshot, postE2E, pubkey, streamId]);

  const identityDisplayValue = useMemo(() => {
    if (npub) return npub;
    return pubkey ?? "";
  }, [npub, pubkey]);
  const [identityCopyStatus, setIdentityCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyIdentityDisplayValue = useCallback(async () => {
    setIdentityCopyStatus("idle");
    try {
      const value = identityDisplayValue.trim();
      if (!value) return;
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(value);
      setIdentityCopyStatus("copied");
      setTimeout(() => setIdentityCopyStatus("idle"), 1200);
    } catch {
      setIdentityCopyStatus("error");
      setTimeout(() => setIdentityCopyStatus("idle"), 1800);
    }
  }, [identityDisplayValue]);

  const [playbackUrlCopyStatus, setPlaybackUrlCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyPlaybackUrl = useCallback(async () => {
    setPlaybackUrlCopyStatus("idle");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(streamUrl);
      setPlaybackUrlCopyStatus("copied");
      setTimeout(() => setPlaybackUrlCopyStatus("idle"), 1200);
    } catch {
      setPlaybackUrlCopyStatus("error");
      setTimeout(() => setPlaybackUrlCopyStatus("idle"), 1800);
    }
  }, [streamUrl]);

  const [tipCopyStatus, setTipCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyTipAddress = useCallback(async () => {
    setTipCopyStatus("idle");
    try {
      const address = announce?.xmr?.trim();
      if (!address) return;
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(address);
      setTipCopyStatus("copied");
      setTimeout(() => setTipCopyStatus("idle"), 1200);
    } catch {
      setTipCopyStatus("error");
      setTimeout(() => setTipCopyStatus("idle"), 1800);
    }
  }, [announce?.xmr]);

  const paymentMethods = useMemo<StreamPaymentMethod[]>(() => {
    const source = Array.isArray(announce?.payments) ? announce.payments : [];
    const dedup = new Map<string, StreamPaymentMethod>();
    for (const method of source) {
      const asset = method.asset;
      const address = (method.address ?? "").trim();
      if (!asset || !address) continue;
      const network = (method.network ?? "").trim();
      const label = (method.label ?? "").trim();
      const amount = (method.amount ?? "").trim();
      const key = `${asset}:${network.toLowerCase()}:${address.toLowerCase()}`;
      dedup.set(key, {
        asset,
        address,
        network: network || undefined,
        label: label || undefined,
        amount: amount || undefined
      });
    }

    const xmrFallback = (announce?.xmr ?? "").trim();
    if (xmrFallback) {
      const xmrKey = `xmr::${xmrFallback.toLowerCase()}`;
      if (!dedup.has(xmrKey)) {
        dedup.set(xmrKey, { asset: "xmr", address: xmrFallback, label: "Monero" });
      }
    }

    if (hostProfile?.profile) {
      const lud16 = hostProfile.profile.lud16?.trim();
      const lud06 = hostProfile.profile.lud06?.trim();
      if (lud16) {
        const key = `btc:lightning:${lud16.toLowerCase()}`;
        if (!dedup.has(key)) {
          dedup.set(key, { asset: "btc", network: "lightning", address: lud16, label: "Lightning (NIP-57)" });
        }
      } else if (lud06) {
        const key = `btc:lightning:${lud06.toLowerCase()}`;
        if (!dedup.has(key)) {
          dedup.set(key, { asset: "btc", network: "lightning", address: lud06, label: "Lightning (NIP-57)" });
        }
      }
    }

    return Array.from(dedup.values()).sort((a, b) => comparePaymentAssetOrder(a.asset, b.asset));
  }, [announce?.payments, announce?.xmr, hostProfile?.profile]);

  const nonMoneroPaymentMethods = useMemo(
    () => paymentMethods.filter((method) => method.asset !== "xmr"),
    [paymentMethods]
  );

  const paymentRailGroups = useMemo(
    () => groupPaymentMethodsByRail(nonMoneroPaymentMethods),
    [nonMoneroPaymentMethods]
  );

  const [tipModalOpen, setTipModalOpen] = useState(false);
  const closeTipModal = useCallback(() => setTipModalOpen(false), []);
  const openTipModal = useCallback(() => setTipModalOpen(true), []);

  useEffect(() => {
    if (!tipQueryOpen || tipAutoOpenedRef.current) return;
    tipAutoOpenedRef.current = true;
    setTipModalOpen(true);
  }, [tipQueryOpen]);

  useEffect(() => {
    if (!tipModalOpen || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTipModalOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tipModalOpen]);

  const viewerWalletMethods = useMemo(() => social.settings.paymentDefaults.paymentMethods, [social.settings.paymentDefaults.paymentMethods]);

  const commonAssetSet = useMemo(() => {
    const set = new Set<string>();
    for (const method of viewerWalletMethods) {
      set.add(method.asset);
    }
    if ((social.settings.paymentDefaults.xmrTipAddress ?? "").trim()) set.add("xmr");
    return set;
  }, [social.settings.paymentDefaults.xmrTipAddress, viewerWalletMethods]);

  const commonAssetNetworkSet = useMemo(() => {
    const set = new Set<string>();
    for (const method of viewerWalletMethods) {
      const asset = (method.asset ?? "").trim().toLowerCase();
      if (!asset) continue;
      const network = (method.network ?? "").trim().toLowerCase();
      if (!network) continue;
      set.add(`${asset}:${network}`);
    }
    return set;
  }, [viewerWalletMethods]);

  const tipModalMethods = useMemo(
    () =>
      paymentMethods
        .map((method, index) => {
          const network = (method.network ?? "").trim().toLowerCase();
          const asset = (method.asset ?? "").trim().toLowerCase();
          const commonNetwork = !!network && commonAssetNetworkSet.has(`${asset}:${network}`);
          const commonAsset = commonAssetSet.has(asset);
          const rank = commonNetwork ? 0 : commonAsset ? 1 : 2;
          return { method, index, commonAsset, commonNetwork, rank };
        })
        .sort((a, b) => {
          if (a.rank !== b.rank) return a.rank - b.rank;
          const byAsset = comparePaymentAssetOrder(a.method.asset, b.method.asset);
          if (byAsset !== 0) return byAsset;
          return a.index - b.index;
        }),
    [commonAssetNetworkSet, commonAssetSet, paymentMethods]
  );

  const [paymentCopyStatus, setPaymentCopyStatus] = useState<Record<string, "idle" | "copied" | "error">>({});
  const [nativeSendBusyByKey, setNativeSendBusyByKey] = useState<Record<string, boolean>>({});
  const [nativeSendStatusByKey, setNativeSendStatusByKey] = useState<
    Record<string, { ok: boolean; message: string; txId?: string }>
  >({});
  const [nativeSendAmountByKey, setNativeSendAmountByKey] = useState<Record<string, string>>({});

  const copyPaymentAddress = useCallback(async (paymentKey: string, address: string) => {
    setPaymentCopyStatus((prev) => ({ ...prev, [paymentKey]: "idle" }));
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(address);
      setPaymentCopyStatus((prev) => ({ ...prev, [paymentKey]: "copied" }));
      setTimeout(() => {
        setPaymentCopyStatus((prev) => ({ ...prev, [paymentKey]: "idle" }));
      }, 1200);
    } catch {
      setPaymentCopyStatus((prev) => ({ ...prev, [paymentKey]: "error" }));
      setTimeout(() => {
        setPaymentCopyStatus((prev) => ({ ...prev, [paymentKey]: "idle" }));
      }, 1800);
    }
  }, []);

  const sendNativePayment = useCallback(
    async (paymentKey: string, method: StreamPaymentMethod) => {
      const amountOverride = (nativeSendAmountByKey[paymentKey] ?? "").trim();
      const requestMethod: StreamPaymentMethod = {
        ...method,
        amount: (method.amount ?? "").trim() || amountOverride || undefined
      };
      setNativeSendBusyByKey((prev) => ({ ...prev, [paymentKey]: true }));
      setNativeSendStatusByKey((prev) => ({ ...prev, [paymentKey]: { ok: false, message: "" } }));
      try {
        const result = await sendNativeWalletPayment(requestMethod);
        if (!result.ok) {
          setNativeSendStatusByKey((prev) => ({
            ...prev,
            [paymentKey]: { ok: false, message: result.error ?? "Wallet send failed." }
          }));
          return;
        }
        setNativeSendStatusByKey((prev) => ({
          ...prev,
          [paymentKey]: {
            ok: true,
            message: result.provider === "wallet_uri" ? "Opened wallet app." : `Sent via ${result.provider ?? "wallet"}.`,
            txId: result.txId
          }
        }));
      } catch (error: any) {
        setNativeSendStatusByKey((prev) => ({
          ...prev,
          [paymentKey]: { ok: false, message: error?.message ?? "Wallet send failed." }
        }));
      } finally {
        setNativeSendBusyByKey((prev) => ({ ...prev, [paymentKey]: false }));
      }
    },
    [nativeSendAmountByKey]
  );

  const hasLightningZap = useMemo(() => {
    return paymentMethods.some((method) => {
      if (method.asset !== "btc") return false;
      const network = (method.network ?? "").trim().toLowerCase();
      const address = (method.address ?? "").trim().toLowerCase();
      if (network.includes("lightning") || network.includes("lnurl") || network.includes("bolt11")) return true;
      return address.startsWith("lnbc") || address.startsWith("lnurl") || address.startsWith("lightning:");
    });
  }, [paymentMethods]);

  const [zapAmountSats, setZapAmountSats] = useState("1000");
  const [zapComment, setZapComment] = useState("");
  const [zapRequestBusy, setZapRequestBusy] = useState(false);
  const [zapRequestNotice, setZapRequestNotice] = useState<string | null>(null);
  const [zapRequestError, setZapRequestError] = useState<string | null>(null);
  const publishZapRequest = useCallback(async () => {
    if (!pubkey || !streamId) {
      setZapRequestError("Invalid stream target for zap request.");
      return;
    }
    if (!identity) {
      setZapRequestError("Connect identity to publish a zap request.");
      return;
    }
    const sats = Number(zapAmountSats);
    if (!Number.isFinite(sats) || sats <= 0) {
      setZapRequestError("Enter a valid zap amount in sats.");
      return;
    }
    setZapRequestBusy(true);
    setZapRequestError(null);
    setZapRequestNotice(null);
    try {
      const unsigned = buildZapRequestUnsigned({
        senderPubkey: identity.pubkey,
        recipientPubkey: pubkey,
        streamId,
        amountSats: Math.floor(sats),
        relays,
        comment: zapComment
      });
      const signed = await signEvent(unsigned as any);
      const report = await publishEventDetailed(relays, signed as any, { timeoutMs: 8_000 });
      if (!report.ok) {
        setZapRequestError(report.failedRelays[0]?.reason ?? "No relay acknowledged zap request.");
        return;
      }
      setZapRequestNotice(`Zap request published (${report.okRelays.length}/${relays.length} relays).`);
    } catch (error: any) {
      setZapRequestError(error?.message ?? "Failed to publish zap request.");
    } finally {
      setZapRequestBusy(false);
    }
  }, [identity, pubkey, relays, signEvent, streamId, zapAmountSats, zapComment]);

  const [watchReportOpen, setWatchReportOpen] = useState(false);
  const [watchReportBusy, setWatchReportBusy] = useState(false);
  const [watchReportError, setWatchReportError] = useState<string | null>(null);
  const [watchReportNotice, setWatchReportNotice] = useState<string | null>(null);
  const [watchReportTargetType, setWatchReportTargetType] = useState<"stream" | "creator">("stream");
  const watchReportDialogTitle = watchReportTargetType === "creator" ? "Report Creator" : "Report Stream";
  const watchReportTargetSummary = useMemo(() => {
    if (watchReportTargetType === "creator") {
      if (npub) return `Creator (${npub})`;
      if (pubkey) return `Creator (${shortenText(pubkey, { head: 14, tail: 8 })})`;
      return "Creator";
    }
    const targetLabel = announce?.title?.trim() || "Live Stream";
    if (npub) return `${targetLabel} (${npub} / ${streamId})`;
    if (pubkey) return `${targetLabel} (${shortenText(pubkey, { head: 14, tail: 8 })} / ${streamId})`;
    return `${targetLabel} (${streamId})`;
  }, [announce?.title, npub, pubkey, streamId, watchReportTargetType]);
  const openWatchReport = useCallback((targetType: "stream" | "creator") => {
    if (!pubkey || !streamId) return;
    setWatchReportTargetType(targetType);
    setWatchReportError(null);
    setWatchReportOpen(true);
  }, [pubkey, streamId]);
  const closeWatchReport = useCallback(() => {
    if (watchReportBusy) return;
    setWatchReportOpen(false);
    setWatchReportError(null);
  }, [watchReportBusy]);
  const submitWatchReport = useCallback(
    async (input: { reasonCode: ReportReasonCode; note: string }) => {
      if (!pubkey || !streamId) return;
      setWatchReportBusy(true);
      setWatchReportError(null);
      try {
        const proof = await buildSignedScopeProof(signEvent as any, identity?.pubkey ?? null, "report_submit", [
          ["stream", `${pubkey}--${streamId}`]
        ]);
        const reportTargetType = watchReportTargetType === "creator" ? "user" : "stream";
        await submitModerationReport({
          report: {
            reasonCode: input.reasonCode,
            note: input.note,
            reporterPubkey: identity?.pubkey ?? undefined,
            targetType: reportTargetType,
            targetPubkey: pubkey,
            targetStreamId: reportTargetType === "stream" ? streamId : undefined,
            contextPage: "watch_panel",
            contextUrl: typeof window !== "undefined" ? window.location.href : undefined
          },
          reporterProofEvent: proof
        });
        setWatchReportOpen(false);
        setWatchReportNotice("Report submitted. Operators can review it in Moderation.");
        setTimeout(() => {
          setWatchReportNotice((current) =>
            current === "Report submitted. Operators can review it in Moderation." ? null : current
          );
        }, 3500);
      } catch (error: any) {
        setWatchReportError(error?.message ?? "Failed to submit report.");
      } finally {
        setWatchReportBusy(false);
      }
    },
    [identity?.pubkey, pubkey, signEvent, streamId, watchReportTargetType]
  );

  const [verifiedTipCopyStatus, setVerifiedTipCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const needsXmrRpc = !!(announce?.xmr || stakeRequiredAtomic || videoPaidRequiresUnlock);
  const [xmrRpcAvailable, setXmrRpcAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!needsXmrRpc) {
      setXmrRpcAvailable(false);
      return;
    }

    void (async () => {
      try {
        const res = await fetch("/api/xmr/health", { cache: "no-store" });
        if (cancelled) return;
        setXmrRpcAvailable(res.ok);
      } catch {
        if (cancelled) return;
        setXmrRpcAvailable(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsXmrRpc]);

  const videoEntitlementKey = useMemo(
    () => (pubkey && streamId ? `dstream_video_access_v1:${pubkey}:${streamId}` : null),
    [pubkey, streamId]
  );
  const videoPlaylistEntitlementKey = useMemo(
    () => (pubkey && videoPlaylistId ? `dstream_video_playlist_access_v1:${pubkey}:${videoPlaylistId}` : null),
    [pubkey, videoPlaylistId]
  );

  const persistVideoUnlock = useCallback(
    (params: {
      observedAtMs?: number | null;
      accessToken?: string | null;
      expiresAtMs?: number | null;
      accessScope?: "stream" | "playlist";
      playlistId?: string | null;
    }) => {
      const unlockedAtMs = params.observedAtMs && Number.isFinite(params.observedAtMs) ? params.observedAtMs : Date.now();
      const accessSeconds = videoPolicy.accessSeconds && videoPolicy.accessSeconds > 0 ? videoPolicy.accessSeconds : null;
      const expiresAtMs = params.expiresAtMs ?? (accessSeconds ? unlockedAtMs + accessSeconds * 1000 : null);
      const accessToken = params.accessToken?.trim() || null;
      const accessScope = params.accessScope === "playlist" && videoPlaylistId ? "playlist" : "stream";
      const playlistId = (params.playlistId ?? videoPlaylistId ?? "").trim() || null;

      if (videoPaidRequiresUnlock && !accessToken) {
        setVideoUnlocked(false);
        setVideoAccessToken(null);
        setVideoUnlockExpiresAtMs(null);
        return;
      }

      setVideoUnlocked(true);
      setVideoAccessToken(accessToken);
      setVideoUnlockExpiresAtMs(expiresAtMs);
      if (!videoEntitlementKey) return;
      try {
        const payload = JSON.stringify({
          unlockedAtMs,
          expiresAtMs,
          accessToken,
          accessScope,
          playlistId
        });
        localStorage.setItem(videoEntitlementKey, payload);
        if (accessScope === "playlist" && videoPlaylistEntitlementKey) {
          localStorage.setItem(videoPlaylistEntitlementKey, payload);
        }
      } catch {
        // ignore storage errors
      }
    },
    [videoEntitlementKey, videoPaidRequiresUnlock, videoPlaylistEntitlementKey, videoPlaylistId, videoPolicy.accessSeconds]
  );

  useEffect(() => {
    if (!videoPaidRequiresUnlock) {
      setVideoUnlocked(true);
      setVideoUnlockExpiresAtMs(null);
      setVideoAccessToken(null);
      return;
    }
    setVideoUnlocked(false);
    setVideoUnlockExpiresAtMs(null);
    setVideoAccessToken(null);
    if (!videoEntitlementKey) return;

    const candidateKeys = [videoEntitlementKey];
    if (videoEntitlementScope === "playlist" && videoPlaylistEntitlementKey) {
      candidateKeys.push(videoPlaylistEntitlementKey);
    }

    try {
      const nowMs = Date.now();
      for (const key of candidateKeys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as {
          unlockedAtMs?: number;
          expiresAtMs?: number | null;
          accessToken?: string | null;
          accessScope?: "stream" | "playlist";
          playlistId?: string | null;
        } | null;
        const accessToken = typeof parsed?.accessToken === "string" ? parsed.accessToken.trim() : "";
        if (!accessToken) {
          localStorage.removeItem(key);
          continue;
        }
        const expiresAtMs = parsed?.expiresAtMs ?? null;
        if (expiresAtMs && nowMs >= expiresAtMs) {
          localStorage.removeItem(key);
          continue;
        }
        if (videoEntitlementScope === "playlist") {
          const scope = parsed?.accessScope === "playlist" ? "playlist" : "stream";
          const playlistId = typeof parsed?.playlistId === "string" ? parsed.playlistId.trim() : "";
          if (scope !== "playlist" || !videoPlaylistId || playlistId !== videoPlaylistId) continue;
        }
        setVideoUnlocked(true);
        setVideoAccessToken(accessToken);
        setVideoUnlockExpiresAtMs(expiresAtMs);
        break;
      }
    } catch {
      // ignore parse errors
    }
  }, [videoEntitlementKey, videoEntitlementScope, videoPaidRequiresUnlock, videoPlaylistEntitlementKey, videoPlaylistId]);

  useEffect(() => {
    if (!videoUnlockExpiresAtMs || !videoEntitlementKey) return;
    const remaining = videoUnlockExpiresAtMs - Date.now();
    const clearKeys = () => {
      try {
        localStorage.removeItem(videoEntitlementKey);
        if (videoPlaylistEntitlementKey) localStorage.removeItem(videoPlaylistEntitlementKey);
      } catch {
        // ignore
      }
    };
    if (remaining <= 0) {
      setVideoUnlocked(false);
      setVideoAccessToken(null);
      setVideoUnlockExpiresAtMs(null);
      clearKeys();
      return;
    }

    const timer = setTimeout(() => {
      setVideoUnlocked(false);
      setVideoAccessToken(null);
      setVideoUnlockExpiresAtMs(null);
      clearKeys();
    }, remaining);
    return () => clearTimeout(timer);
  }, [videoEntitlementKey, videoPlaylistEntitlementKey, videoUnlockExpiresAtMs]);

  const claimVideoAccess = useCallback(
    async (tipSession: string, observedAtMs: number | null): Promise<boolean> => {
      const res = await fetch("/api/video/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tipSession })
      });

      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        if (res.status === 402) {
          if (data?.reason === "amount_insufficient") {
            setVideoUnlockError("Payment detected but below Video unlock price.");
          } else if (data?.reason === "payment_not_confirmed") {
            setVideoUnlockError("Payment detected but still waiting for confirmations.");
          } else {
            setVideoUnlockError("Unlock is not available yet. Confirm payment and retry.");
          }
          return false;
        }
        throw new Error(typeof data?.message === "string" ? data.message : `Unlock failed (${res.status}).`);
      }

      const accessToken = typeof data?.token === "string" ? data.token.trim() : "";
      const expiresAtMs = typeof data?.expiresAtMs === "number" && Number.isFinite(data.expiresAtMs) ? data.expiresAtMs : null;
      const accessScope = data?.accessScope === "playlist" ? "playlist" : "stream";
      const playlistId = typeof data?.playlistId === "string" ? data.playlistId : null;
      if (!accessToken || !expiresAtMs) throw new Error("Invalid unlock response from server.");

      persistVideoUnlock({
        observedAtMs,
        accessToken,
        expiresAtMs,
        accessScope,
        playlistId
      });
      return true;
    },
    [persistVideoUnlock]
  );

  const startVideoUnlockSession = useCallback(async () => {
    if (!pubkey || !streamId || !videoPaidRequiresUnlock) return;
    setVideoUnlockBusy("creating");
    setVideoUnlockError(null);
    setVideoUnlockStatus(null);
    setVideoUnlockSession(null);
    setVideoUnlockQr(null);

    try {
      const res = await fetch("/api/xmr/tip/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ streamPubkey: pubkey, streamId })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as any;
      const session = typeof data?.session === "string" ? data.session : "";
      const address = typeof data?.address === "string" ? data.address : "";
      if (!session || !address) throw new Error("Invalid unlock session response.");
      setVideoUnlockSession({ session, address });
    } catch (err: any) {
      setVideoUnlockError(err?.message ?? "Failed to create unlock session.");
    } finally {
      setVideoUnlockBusy("idle");
    }
  }, [pubkey, streamId, videoPaidRequiresUnlock]);

  const checkVideoUnlockStatus = useCallback(async () => {
    if (videoUnlockBusy !== "idle") return;
    const token = videoUnlockSession?.session;
    if (!token || !videoPaidRequiresUnlock || videoPriceAtomic === null) return;
    setVideoUnlockBusy("checking");
    setVideoUnlockError(null);
    try {
      const res = await fetch(`/api/xmr/tip/session/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as any;
      const amountAtomic = typeof data?.amountAtomic === "string" ? data.amountAtomic : null;
      const confirmed = typeof data?.confirmed === "boolean" ? data.confirmed : null;
      const found = !!data?.found;
      const observedAtMs = typeof data?.observedAtMs === "number" ? data.observedAtMs : null;
      setVideoUnlockStatus({ found, amountAtomic, confirmed, observedAtMs });

      if (found && confirmed && amountAtomic && /^\d+$/.test(amountAtomic) && BigInt(amountAtomic) >= videoPriceAtomic) {
        await claimVideoAccess(token, observedAtMs);
      }
    } catch (err: any) {
      setVideoUnlockError(err?.message ?? "Failed to check unlock status.");
    } finally {
      setVideoUnlockBusy("idle");
    }
  }, [claimVideoAccess, videoPaidRequiresUnlock, videoPriceAtomic, videoUnlockBusy, videoUnlockSession?.session]);

  useEffect(() => {
    if (!videoUnlockSession?.session || !videoPaidRequiresUnlock || !xmrRpcAvailable || videoUnlocked) return;
    void checkVideoUnlockStatus();
    const interval = setInterval(() => {
      void checkVideoUnlockStatus();
    }, 12_000);
    return () => clearInterval(interval);
  }, [checkVideoUnlockStatus, videoPaidRequiresUnlock, videoUnlockSession?.session, videoUnlocked, xmrRpcAvailable]);

  useEffect(() => {
    if (!videoPaidRequiresUnlock && !videoUnlockExpiresAtMs && !videoUnlockSession?.session) return;
    const interval = setInterval(() => setVideoNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [videoPaidRequiresUnlock, videoUnlockExpiresAtMs, videoUnlockSession?.session]);

  const copyVideoUnlockAddress = useCallback(async () => {
    setVideoUnlockCopyStatus("idle");
    try {
      const address = videoUnlockSession?.address?.trim();
      if (!address) return;
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(address);
      setVideoUnlockCopyStatus("copied");
      setTimeout(() => setVideoUnlockCopyStatus("idle"), 1200);
    } catch {
      setVideoUnlockCopyStatus("error");
      setTimeout(() => setVideoUnlockCopyStatus("idle"), 1800);
    }
  }, [videoUnlockSession?.address]);

  useEffect(() => {
    let cancelled = false;
    const address = videoUnlockSession?.address?.trim();
    if (!address) {
      setVideoUnlockQr(null);
      return;
    }

    void (async () => {
      try {
        const uri = `monero:${address}`;
        const dataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 176 });
        if (cancelled) return;
        setVideoUnlockQr(dataUrl);
      } catch {
        if (cancelled) return;
        setVideoUnlockQr(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [videoUnlockSession?.address]);

  const [verifiedTip, setVerifiedTip] = useState<{ session: string; address: string } | null>(null);
  const [verifiedTipQr, setVerifiedTipQr] = useState<string | null>(null);
  const [verifiedTipBusy, setVerifiedTipBusy] = useState<"idle" | "creating" | "checking">("idle");
  const [verifiedTipError, setVerifiedTipError] = useState<string | null>(null);
  const [verifiedTipStatus, setVerifiedTipStatus] = useState<{
    found: boolean;
    amountAtomic: string | null;
    confirmed: boolean | null;
    observedAtMs: number | null;
  } | null>(null);

  const copyVerifiedTipAddress = useCallback(async () => {
    setVerifiedTipCopyStatus("idle");
    try {
      const address = verifiedTip?.address?.trim();
      if (!address) return;
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(address);
      setVerifiedTipCopyStatus("copied");
      setTimeout(() => setVerifiedTipCopyStatus("idle"), 1200);
    } catch {
      setVerifiedTipCopyStatus("error");
      setTimeout(() => setVerifiedTipCopyStatus("idle"), 1800);
    }
  }, [verifiedTip?.address]);

  const startVerifiedTipSession = useCallback(async () => {
    if (!pubkey || !streamId) return;
    setVerifiedTipBusy("creating");
    setVerifiedTipError(null);
    setVerifiedTipStatus(null);
    setVerifiedTip(null);
    setVerifiedTipQr(null);

    try {
      const res = await fetch("/api/xmr/tip/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ streamPubkey: pubkey, streamId })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as any;
      const session = typeof data?.session === "string" ? data.session : "";
      const address = typeof data?.address === "string" ? data.address : "";
      if (!session || !address) throw new Error("Invalid tip session response.");
      setVerifiedTip({ session, address });
    } catch (err: any) {
      setVerifiedTipError(err?.message ?? "Failed to create tip session.");
    } finally {
      setVerifiedTipBusy("idle");
    }
  }, [pubkey, streamId]);

  const checkVerifiedTip = useCallback(async () => {
    const session = verifiedTip?.session;
    if (!session) return;
    setVerifiedTipBusy("checking");
    setVerifiedTipError(null);
    try {
      const url = `/api/xmr/tip/session/${encodeURIComponent(session)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as any;
      setVerifiedTipStatus({
        found: !!data?.found,
        amountAtomic: typeof data?.amountAtomic === "string" ? data.amountAtomic : null,
        confirmed: typeof data?.confirmed === "boolean" ? data.confirmed : null,
        observedAtMs: typeof data?.observedAtMs === "number" ? data.observedAtMs : null
      });
    } catch (err: any) {
      setVerifiedTipError(err?.message ?? "Failed to check tip status.");
    } finally {
      setVerifiedTipBusy("idle");
    }
  }, [verifiedTip?.session]);

  useEffect(() => {
    let cancelled = false;
    const address = verifiedTip?.address?.trim();
    if (!address) {
      setVerifiedTipQr(null);
      return;
    }

    void (async () => {
      try {
        const uri = `monero:${address}`;
        const dataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 176 });
        if (cancelled) return;
        setVerifiedTipQr(dataUrl);
      } catch {
        if (cancelled) return;
        setVerifiedTipQr(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [verifiedTip?.address]);

  const stakeRequiredXmr = useMemo(
    () => (stakeRequiredAtomic ? formatXmrAtomic(stakeRequiredAtomic) : null),
    [stakeRequiredAtomic]
  );

  useEffect(() => {
    setStake(null);
    setStakeQr(null);
    setStakeBusy("idle");
    setStakeError(null);
    setStakeStatus(null);
    setStakeRefundAddress("");
    setStakeRefundBusy(false);
    setStakeRefundError(null);
    setStakeRefundResult(null);
    setVideoUnlockSession(null);
    setVideoUnlockQr(null);
    setVideoUnlockCopyStatus("idle");
    setVideoUnlockBusy("idle");
    setVideoUnlockError(null);
    setVideoUnlockStatus(null);
    setVideoAccessToken(null);
  }, [pubkey, streamId]);

  const makeNip98AuthHeader = useCallback(
    async (opts: { url: string; method: "GET" | "POST" }) => {
      if (!identity) throw new Error("Connect identity to authorize requests.");
      const unsigned: any = {
        kind: 27235,
        created_at: nowSec(),
        content: "",
        tags: [
          ["u", opts.url],
          ["method", opts.method]
        ],
        pubkey: identity.pubkey
      };
      const signed = await signEvent(unsigned);
      return `Nostr ${base64EncodeUtf8(JSON.stringify(signed))}`;
    },
    [identity, signEvent]
  );

  const copyStakeAddress = useCallback(async () => {
    setStakeCopyStatus("idle");
    try {
      const address = stake?.address?.trim();
      if (!address) return;
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(address);
      setStakeCopyStatus("copied");
      setTimeout(() => setStakeCopyStatus("idle"), 1200);
    } catch {
      setStakeCopyStatus("error");
      setTimeout(() => setStakeCopyStatus("idle"), 1800);
    }
  }, [stake?.address]);

  const startStakeSession = useCallback(async () => {
    if (!pubkey || !streamId) return;
    if (!stakeRequiredAtomic) return;
    if (!xmrRpcAvailable) {
      setStakeError("Stake verification is unavailable (origin wallet RPC not configured).");
      return;
    }
    setStakeBusy("creating");
    setStakeError(null);
    setStakeStatus(null);
    setStake(null);
    setStakeQr(null);

    try {
      const path = "/api/xmr/stake/session";
      const url = `${window.location.origin}${path}`;
      const auth = await makeNip98AuthHeader({ url, method: "POST" });

      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify({ streamPubkey: pubkey, streamId })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as any;
      const session = typeof data?.session === "string" ? data.session : "";
      const address = typeof data?.address === "string" ? data.address : "";
      if (!session || !address) throw new Error("Invalid stake session response.");
      setStake({ session, address });
    } catch (err: any) {
      setStakeError(err?.message ?? "Failed to create stake session.");
    } finally {
      setStakeBusy("idle");
    }
  }, [makeNip98AuthHeader, pubkey, stakeRequiredAtomic, streamId, xmrRpcAvailable]);

  const checkStake = useCallback(async () => {
    const session = stake?.session;
    if (!session) return;
    setStakeBusy("checking");
    setStakeError(null);
    try {
      const path = `/api/xmr/stake/session/${encodeURIComponent(session)}`;
      const url = `${window.location.origin}${path}`;
      const auth = await makeNip98AuthHeader({ url, method: "GET" });
      const res = await fetch(path, { cache: "no-store", headers: { authorization: auth } });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as any;
      const totalAtomic = typeof data?.totalAtomic === "string" ? data.totalAtomic : null;
      const confirmedAtomic = typeof data?.confirmedAtomic === "string" ? data.confirmedAtomic : null;
      const transferCount = typeof data?.transferCount === "number" ? data.transferCount : null;
      const confirmationsRequired = typeof data?.confirmationsRequired === "number" ? data.confirmationsRequired : null;
      if (!totalAtomic || !confirmedAtomic || transferCount === null || confirmationsRequired === null) {
        throw new Error("Invalid stake status response.");
      }
      setStakeStatus({
        totalAtomic,
        confirmedAtomic,
        transferCount,
        confirmationsRequired,
        lastObservedAtMs: typeof data?.lastObservedAtMs === "number" ? data.lastObservedAtMs : null,
        lastTxid: typeof data?.lastTxid === "string" ? data.lastTxid : null
      });
    } catch (err: any) {
      setStakeError(err?.message ?? "Failed to check stake status.");
    } finally {
      setStakeBusy("idle");
    }
  }, [makeNip98AuthHeader, stake?.session]);

  const requestStakeRefund = useCallback(async () => {
    const session = stake?.session;
    if (!session || !identity || !pubkey || !streamId) return;
    const refundAddress = stakeRefundAddress.trim();
    if (!refundAddress) {
      setStakeRefundError("Enter a Monero refund address.");
      return;
    }

    setStakeRefundBusy(true);
    setStakeRefundError(null);
    setStakeRefundResult(null);
    try {
      const path = `/api/xmr/stake/session/${encodeURIComponent(session)}/refund`;
      const url = `${window.location.origin}${path}`;
      const auth = await makeNip98AuthHeader({ url, method: "POST" });

      const servedBytes = Math.max(0, Math.trunc(p2pStats?.bytesToPeers ?? 0));
      const receipts: any[] = [];
      if (servedBytes > 0) {
        const unsigned: any = buildP2PBytesReceiptEvent({
          pubkey: identity.pubkey,
          createdAt: nowSec(),
          streamPubkey: pubkey,
          streamId,
          fromPubkey: identity.pubkey,
          servedBytes,
          observedAtMs: Date.now(),
          sessionId: session
        });
        const signed = await signEvent(unsigned);
        receipts.push(signed);
      }

      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify({
          refundAddress,
          receipts
        })
      });

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as any;
      setStakeRefundResult({
        settled: !!data?.settled,
        amountAtomic: typeof data?.amountAtomic === "string" ? data.amountAtomic : "0",
        txids: Array.isArray(data?.txids) ? data.txids.filter((x: any) => typeof x === "string") : [],
        servedBytes: typeof data?.servedBytes === "number" ? data.servedBytes : servedBytes
      });
      await checkStake();
    } catch (err: any) {
      setStakeRefundError(err?.message ?? "Refund request failed.");
    } finally {
      setStakeRefundBusy(false);
    }
  }, [checkStake, identity, makeNip98AuthHeader, p2pStats?.bytesToPeers, pubkey, signEvent, stake?.session, stakeRefundAddress, streamId]);

  useEffect(() => {
    let cancelled = false;
    const address = stake?.address?.trim();
    if (!address) {
      setStakeQr(null);
      return;
    }

    void (async () => {
      try {
        const uri = `monero:${address}`;
        const dataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 176 });
        if (cancelled) return;
        setStakeQr(dataUrl);
      } catch {
        if (cancelled) return;
        setStakeQr(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stake?.address]);

  const p2pBlockedReason = useMemo(() => {
    if (!signalIdentity) return "P2P assist unavailable in this browser context.";
    if (!stakeRequiredAtomic || stakeSatisfied) return null;
    if (!identity || !nip04) return "Connect identity to enable stake-gated P2P assist.";
    if (!xmrRpcAvailable) return "Stake required, but Monero verification is unavailable (origin wallet RPC not configured).";
    if (!stake) return `Stake required: ${stakeRequiredXmr ?? "unknown amount"}. Get a stake address below.`;
    if (!stakeStatus) return `Stake required: ${stakeRequiredXmr ?? "unknown amount"} (confirmed). Send stake, then click Check.`;
    try {
      const required = BigInt(stakeRequiredAtomic);
      const confirmed = BigInt(stakeStatus.confirmedAtomic);
      const remaining = required > confirmed ? required - confirmed : 0n;
      if (remaining > 0n) {
        return `Stake required: ${stakeRequiredXmr ?? "unknown amount"} (confirmed). Confirmed so far: ${formatXmrAtomic(
          stakeStatus.confirmedAtomic
        )} (need +${formatXmrAtomic(remaining.toString())}).`;
      }
    } catch {
      // ignore
    }
    return `Stake required: ${stakeRequiredXmr ?? "unknown amount"} (confirmed).`;
  }, [identity, nip04, signalIdentity, stake, stakeRequiredAtomic, stakeRequiredXmr, stakeSatisfied, stakeStatus, xmrRpcAvailable]);

  useEffect(() => {
    if (!stakeRequiredAtomic) return;
    if (stakeSatisfied) return;
    if (!p2pEnabled) return;
    social.updateSettings({ p2pAssistEnabled: false });
  }, [p2pEnabled, social.updateSettings, stakeRequiredAtomic, stakeSatisfied]);

  const showP2PPanel = !!(
    p2pEnabled &&
    p2pAllowed &&
    p2pStats &&
    (p2pStats.peersConnected > 0 || p2pStats.bytesFromPeers > 0 || p2pStats.bytesToPeers > 0)
  );

  const p2pHitRatePct = useMemo(() => {
    if (!p2pStats) return null;
    const requests = Math.max(0, Math.trunc(p2pStats.requestsToPeers));
    if (requests <= 0) return null;
    const hits = Math.max(0, Math.trunc(p2pStats.hitsFromPeers));
    return Math.max(0, Math.min(100, Math.round((hits / requests) * 100)));
  }, [p2pStats]);
  const p2pContributionPct = useMemo(() => {
    if (!p2pStats) return null;
    const incoming = Math.max(0, Math.trunc(p2pStats.bytesFromPeers));
    const outgoing = Math.max(0, Math.trunc(p2pStats.bytesToPeers));
    const total = incoming + outgoing;
    if (total <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((outgoing / total) * 100)));
  }, [p2pStats]);

  const globalPlayerProps = useMemo(() => ({
    src: playbackStreamUrl,
    fallbackSrc: announce?.status === "live" && canUseLocalFallback ? fallbackUrl : null,
    whepSrc: whepSrc,
    p2pSwarm: p2pSwarm,
    integrity: integritySession,
    isLiveStream: announce?.status !== "ended",
    showNativeControls: false,
    captionTracks: captionTracks,
    viewerCount: effectiveViewerCount,
    p2pPeers: p2pStats?.peersConnected,
    autoplayMuted: e2e ? true : social.settings.playbackAutoplayMuted,
    layoutMode: mobilePortraitLayout ? "aspect" : "fill",
    overlayTitle: announce?.title ?? "Live Stream",
    auxMetaSlot: pubkey ? (
      <button
        type="button"
        onClick={() => social.toggleFavoriteStream(pubkey, streamId)}
        className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200"
        title={social.isFavoriteStream(pubkey, streamId) ? "Unfavorite" : "Favorite"}
        aria-label={social.isFavoriteStream(pubkey, streamId) ? "Unfavorite stream" : "Favorite stream"}
      >
        <Star
          className={`w-3.5 h-3.5 ${
            social.isFavoriteStream(pubkey, streamId) ? "fill-yellow-400 text-yellow-400" : "text-neutral-400"
          }`}
        />
      </button>
    ) : null,
    onReady: () => {
      if (!e2e || e2eSentRef.current.player) return;
      e2eSentRef.current.player = true;
      postE2E({ type: "dstream:e2e", t: "watch_player_ready", streamPubkey: pubkey ?? "", streamId });
    }
  }), [
    playbackStreamUrl,
    announce?.status,
    canUseLocalFallback,
    fallbackUrl,
    whepSrc,
    p2pSwarm,
    integritySession,
    captionTracks,
    effectiveViewerCount,
    p2pStats?.peersConnected,
    e2e,
    social,
    mobilePortraitLayout,
    announce?.title,
    pubkey,
    streamId
  ]);

  const showVideoUnlockGate = videoPaidRequiresUnlock && !videoUnlocked;
  const videoAccessExpiryLabel = useMemo(() => {
    if (!videoUnlockExpiresAtMs) return null;
    return new Date(videoUnlockExpiresAtMs).toLocaleString();
  }, [videoUnlockExpiresAtMs]);
  const videoAccessRemainingLabel = useMemo(() => {
    if (!videoUnlockExpiresAtMs) return null;
    return formatRemainingMs(videoUnlockExpiresAtMs - videoNowMs);
  }, [videoNowMs, videoUnlockExpiresAtMs]);
  const videoUnlockDeepLink = useMemo(() => {
    const address = videoUnlockSession?.address?.trim();
    return address ? `monero:${address}` : null;
  }, [videoUnlockSession?.address]);
  const videoUnlockSatisfied = useMemo(() => {
    if (!videoUnlockStatus?.found || !videoUnlockStatus.confirmed || !videoUnlockStatus.amountAtomic || videoPriceAtomic === null) {
      return false;
    }
    if (!/^\d+$/.test(videoUnlockStatus.amountAtomic)) return false;
    try {
      return BigInt(videoUnlockStatus.amountAtomic) >= videoPriceAtomic;
    } catch {
      return false;
    }
  }, [videoPriceAtomic, videoUnlockStatus]);

  const chatBox = (
    <ChatBox
      streamPubkey={pubkey ?? ""}
      streamId={streamId}
      viewerCount={effectiveViewerCount}
      onMessageCountChange={(count) => {
        if (!e2e || e2eSentRef.current.chat) return;
        if (count <= 0) return;
        e2eSentRef.current.chat = true;
        postE2E({ type: "dstream:e2e", t: "watch_chat_ready", streamPubkey: pubkey ?? "", streamId });
      }}
    />
  );

  return (
    <>
      <style>{`
        #global-site-footer { display: none !important; }
      `}</style>
      <div className="w-full flex-1 flex flex-col bg-neutral-950 text-white">
        <SimpleHeader />
      <main className="w-full min-h-0 px-4 pt-6 pb-0 md:px-5 lg:px-6 lg:pb-0">
        {!pubkey && (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
            Invalid pubkey in route. Expected a 64-hex pubkey or an <span className="font-mono">npub…</span>.
          </div>
        )}



        <div
          data-testid="watch-layout-grid"
          className={`grid gap-6 ${
            desktopWatchLayout
              ? "grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] items-start"
              : mobileLandscapeLayout
                ? "grid-cols-[minmax(0,1fr)_minmax(14rem,38vw)] items-start"
                : "grid-cols-1"
          }`}
        >
          <div className={desktopWatchLayout || mobileLandscapeLayout ? "min-w-0 flex flex-col gap-6" : "flex flex-col gap-4"}>
            {showVideoUnlockGate ? (
              <div className="rounded-2xl border border-amber-700/40 bg-amber-950/15 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <MoneroLogo className="w-5 h-5 text-orange-400" />
                    <div className="text-xs font-mono text-amber-200 uppercase tracking-wider font-bold">Paid Video</div>
                  </div>
                  <div className="text-xs text-amber-300">{videoModeLabel(videoPolicy)} unlock required</div>
                </div>

                <div className="text-sm text-neutral-200">
                  Unlock price:{" "}
                  <span className="font-mono text-amber-300">
                    {videoPriceAtomic ? formatXmrAtomic(videoPriceAtomic.toString()) : "unknown"}
                  </span>
                </div>
                <div className="text-xs text-neutral-500">
                  Scope:{" "}
                  <span className="text-neutral-300">
                    {videoEntitlementScope === "playlist" && videoPlaylistId
                      ? `playlist bundle (${videoPlaylistId})`
                      : "single stream replay"}
                  </span>
                </div>

                {videoAccessExpiryLabel && (
                  <div className="text-xs text-neutral-500">
                    Current unlock expires at {videoAccessExpiryLabel}
                    {videoAccessRemainingLabel ? ` (in ${videoAccessRemainingLabel})` : ""}.
                  </div>
                )}

                {!xmrRpcAvailable && (
                  <div className="text-xs text-neutral-500">Unlock verification unavailable (origin wallet RPC not configured).</div>
                )}
                {videoUnlockError && <div className="text-xs text-red-300">{videoUnlockError}</div>}
                {videoUnlockStatus && (
                  <div className={`text-xs ${videoUnlockSatisfied ? "text-emerald-300" : "text-neutral-500"}`}>
                    {videoUnlockStatus.found
                      ? `Detected ${videoUnlockStatus.amountAtomic ? formatXmrAtomic(videoUnlockStatus.amountAtomic) : "a payment"}${
                          videoUnlockStatus.confirmed ? " (confirmed)" : " (unconfirmed)"
                        }`
                      : "Waiting for payment…"}
                  </div>
                )}
                {!!videoUnlockSession?.session && !videoUnlockSatisfied && (
                  <div className="text-[11px] text-neutral-500">Auto-checking unlock status every 12 seconds.</div>
                )}

                {!videoUnlockSession ? (
                  <button
                    type="button"
                    onClick={() => void startVideoUnlockSession()}
                    disabled={videoUnlockBusy !== "idle" || !xmrRpcAvailable}
                    className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                  >
                    {videoUnlockBusy === "creating" ? "Creating…" : "Get unlock address"}
                  </button>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
                    <div className="space-y-2">
                      <div className="text-xs text-neutral-500">Payment subaddress</div>
                      <div className="text-sm text-neutral-200 font-mono break-all">{videoUnlockSession.address}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={copyVideoUnlockAddress}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
                        >
                          <Copy className="w-4 h-4" />
                          {videoUnlockCopyStatus === "copied"
                            ? "Copied"
                            : videoUnlockCopyStatus === "error"
                              ? "Error"
                              : "Copy"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void checkVideoUnlockStatus()}
                          disabled={videoUnlockBusy !== "idle"}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                        >
                          {videoUnlockBusy === "checking" ? "Checking…" : "Check unlock"}
                        </button>
                        {videoUnlockDeepLink && (
                          <a
                            href={videoUnlockDeepLink}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
                          >
                            Open wallet
                          </a>
                        )}
                      </div>
                    </div>
                    {videoUnlockQr && (
                      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-2 w-fit">
                        <img src={videoUnlockQr} alt="Unlock QR" className="w-44 h-44" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                data-testid="watch-player-panel"
                className={`${
                  mobilePortraitLayout
                    ? "order-1"
                    : "h-[clamp(18rem,56vh,43rem)] sm:h-[clamp(20rem,60vh,47rem)] md:h-[min(calc(100dvh-15.5rem),52rem)] md:min-h-[24rem]"
                }`}
              >
                {streamUrl ? (
                  <>
                    <GlobalPlayerSlot
                    id="watch-page"
                    playerProps={globalPlayerProps}
                  />
                  </>
                ) : (
                  <div className="h-full rounded-2xl border border-neutral-800 bg-neutral-900/40 flex items-center justify-center px-6 text-center text-sm text-neutral-400">
                    {announceLoading ? "Resolving stream source…" : "Unable to resolve a playable stream source."}
                  </div>
                )}
              </div>
            )}

            {mobilePortraitLayout && (
              <div ref={mobilePortraitChatShellRef} data-testid="watch-chat-panel-mobile-portrait" className="order-2 flex flex-col w-full h-[calc(100svh-clamp(15rem,35vh,24rem))] min-h-[30rem]">
                <div className="flex-1 flex flex-col h-full">
                  {chatBox}
                </div>
              </div>
            )}

            <div
              data-testid="watch-details-panel"
              className={`${mobilePortraitLayout ? "order-3" : ""} rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4`}
            >
              {!desktopWatchLayout && mobilePortraitLayout && (
                <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                  <div className="text-xs font-mono text-neutral-300 uppercase tracking-wider">
                    {mobileDetailsExpanded ? "Stream details" : announce?.title ?? "Live Stream"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileDetailsExpanded((current) => !current)}
                    className="inline-flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                  >
                    {mobileDetailsExpanded ? "Collapse" : "Expand"}
                    {mobileDetailsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}

              {(desktopWatchLayout || !mobilePortraitLayout || mobileDetailsExpanded) && (
                <>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
                <div className="text-left space-y-1">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950/70 text-sm font-semibold text-neutral-200">
                      {(social.getAlias(pubkey ?? "") || announce?.title || "S").trim().charAt(0).toUpperCase()}
                    </div>
                    <h1 className="text-2xl font-bold leading-tight">{announce?.title ?? "Live Stream"}</h1>
                  </div>
                  {pubkey && (
                    <div className="text-xs text-neutral-500 font-mono flex flex-wrap items-center gap-1.5">
                      {social.getAlias(pubkey) && <span className="text-neutral-300">{social.getAlias(pubkey)}</span>}
                      {social.getAlias(pubkey) && <span className="text-neutral-600"> · </span>}
                      <button
                        type="button"
                        onClick={() => void copyIdentityDisplayValue()}
                        className="text-neutral-400 hover:text-neutral-200 hover:underline underline-offset-2"
                        title={identityDisplayValue}
                      >
                        {npub ? shortenText(npub, { head: 14, tail: 8 }) : shortenText(pubkey, { head: 14, tail: 8 })}
                      </button>
                      <span>/ {streamId}</span>
                      {identityCopyStatus === "copied" ? (
                        <span className="text-emerald-300">Copied</span>
                      ) : identityCopyStatus === "error" ? (
                        <span className="text-red-300">Error</span>
                      ) : null}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <div className="text-emerald-300">Playing live stream path.</div>
                    {p2pStats && <P2PStatsPanel stats={p2pStats} />}
                    {tipModalMethods.length > 0 && (
                      <button
                        type="button"
                        onClick={openTipModal}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-700/60 bg-emerald-900/20 px-2.5 py-1 text-emerald-200 hover:bg-emerald-900/35"
                      >
                        Tip
                      </button>
                    )}
                    <div className="text-neutral-500">
                      Zaps: <span className="font-mono text-neutral-300">{zapCount}</span> ·{" "}
                      <span className="font-mono text-neutral-300">{zapTotalSats}</span> sats
                      {!zapsConnected && <span className="text-neutral-600"> (syncing)</span>}
                    </div>
                    <a
                      href={streamUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200"
                      title={streamUrl}
                    >
                      Playback URL
                    </a>
                    <button
                      type="button"
                      onClick={() => void copyPlaybackUrl()}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200"
                      title={streamUrl}
                      aria-label="Copy playback URL"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    {playbackUrlCopyStatus === "copied" ? (
                      <span className="text-emerald-300">Copied</span>
                    ) : playbackUrlCopyStatus === "error" ? (
                      <span className="text-red-300">Error</span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">About</div>
                  <p className="text-sm text-neutral-300 leading-relaxed">
                    {announce?.summary ??
                      "This stream is discoverable via Nostr and delivered via HLS (with optional peer assist when available)."}
                  </p>
                  {captionTracks.length > 0 && (
                    <div className="text-xs text-neutral-500">
                      Captions:{" "}
                      <span className="text-neutral-300">
                        {captionTracks.map((track) => `${track.label} (${track.lang})`).join(", ")}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {pubkey && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      aria-pressed={presenceEnabled}
                      onClick={() => social.updateSettings({ presenceEnabled: !presenceEnabled })}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-colors ${
                        presenceEnabled
                          ? "bg-blue-500/20 border-blue-500/50 text-blue-200"
                          : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                      }`}
                    >
                      Share presence {presenceEnabled ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      aria-pressed={p2pEnabled}
                      disabled={!p2pAllowed}
                      onClick={() => {
                        if (!p2pAllowed) return;
                        social.updateSettings({ p2pAssistEnabled: !p2pEnabled });
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-colors ${
                        p2pEnabled
                          ? "bg-blue-500/20 border-blue-500/50 text-blue-200"
                          : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                      } ${p2pAllowed ? "" : "opacity-60 cursor-not-allowed"}`}
                    >
                      P2P assist {p2pEnabled ? "On" : "Off"}
                    </button>
                    {identity ? (
                      <div
                        className={`inline-flex min-w-[8.5rem] items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-mono tabular-nums ${
                          presenceStatus === "ok"
                            ? "border-emerald-800/70 text-emerald-300"
                            : presenceStatus === "sending"
                              ? "border-blue-800/70 text-blue-300"
                              : presenceStatus === "fail"
                                ? "border-red-800/70 text-red-300"
                                : "border-neutral-800 text-neutral-500"
                        }`}
                        title={
                          presenceStatus === "ok" && lastSentAt
                            ? `Last published ${new Date(lastSentAt).toLocaleTimeString()}`
                            : undefined
                        }
                      >
                        {presenceStatus === "sending"
                          ? "publishing"
                          : presenceStatus === "ok"
                            ? "published"
                            : presenceStatus === "fail"
                              ? "retrying"
                              : "idle"}
                      </div>
                    ) : (
                      <div className="text-[11px] text-neutral-500">Connect identity to publish.</div>
                    )}
                    <button
                      type="button"
                      onClick={() => openWatchReport("stream")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                    >
                      <Flag className="h-3.5 w-3.5" />
                      Report stream
                    </button>
                    <button
                      type="button"
                      onClick={() => openWatchReport("creator")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                    >
                      <Flag className="h-3.5 w-3.5" />
                      Report creator
                    </button>
                  </div>

                  {(integritySnapshot && manifestSignerPubkey) || p2pBlockedReason || (watchReportError && !watchReportOpen) ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950/30 px-3 py-2 text-xs text-neutral-400">
                      {integritySnapshot && manifestSignerPubkey && (
                        <div
                          className={`text-[11px] font-mono ${
                            integritySnapshot.lastTamper
                              ? "text-red-300"
                              : integritySnapshot.verifiedOk > 0
                                ? "text-emerald-300"
                                : "text-neutral-500"
                          }`}
                          title={
                            integritySnapshot.lastTamper
                              ? `Tamper detected for ${integritySnapshot.lastTamper.uri}`
                              : !integritySnapshot.sha256Supported
                                ? "SHA-256 unavailable in this browser context"
                                : integritySnapshot.verifiedOk > 0
                                  ? "Segments verified"
                                  : "Waiting for manifests / first verified segment"
                          }
                        >
                          integrity:
                          {integritySnapshot.lastTamper
                            ? " tamper"
                            : !integritySnapshot.sha256Supported
                              ? " unsupported"
                              : integritySnapshot.verifiedOk > 0
                                ? " verified"
                                : " pending"}
                        </div>
                      )}
                      {p2pBlockedReason && <div className="w-full text-[11px] text-neutral-500">{p2pBlockedReason}</div>}
                      {watchReportError && !watchReportOpen && <div className="w-full text-[11px] text-red-300">{watchReportError}</div>}
                    </div>
                  ) : null}

                  {watchReportNotice && <div className="text-xs text-emerald-300">{watchReportNotice}</div>}
                </div>
              )}
                </>
              )}
            </div>

            {showP2PPanel && !desktopWatchLayout && (
              <div className="order-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 flex flex-col gap-3 text-xs text-neutral-300">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-neutral-400">P2P</span>
                  <span className="font-mono">
                    {p2pStats?.peersConnected ?? 0} peers / {Math.round((p2pStats?.cacheBytes ?? 0) / 1024)} KiB cache
                  </span>
                </div>
                <div className="font-mono text-neutral-500">
                  in: {Math.round((p2pStats?.bytesFromPeers ?? 0) / 1024)} KiB · out:{" "}
                  {Math.round((p2pStats?.bytesToPeers ?? 0) / 1024)} KiB · hits: {p2pStats?.hitsFromPeers ?? 0}/
                  {p2pStats?.requestsToPeers ?? 0}
                </div>
              </div>
            )}

            {stakeRequiredAtomic && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <MoneroLogo className="w-5 h-5 text-orange-400" />
                    <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Stake (P2P)</div>
                  </div>

                  {identity && (
                    <>
                      {!stake ? (
                        <button
                          type="button"
                          onClick={() => void startStakeSession()}
                          disabled={stakeBusy !== "idle" || !xmrRpcAvailable}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                        >
                          {stakeBusy === "creating" ? "Creating…" : "Get address"}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={copyStakeAddress}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
                            title="Copy stake address"
                          >
                            <Copy className="w-4 h-4" />
                            {stakeCopyStatus === "copied" ? "Copied" : stakeCopyStatus === "error" ? "Error" : "Copy"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void checkStake()}
                            disabled={stakeBusy !== "idle"}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                          >
                            {stakeBusy === "checking" ? "Checking…" : "Check"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="text-xs text-neutral-500">
                  Requires <span className="text-neutral-200 font-mono">{stakeRequiredXmr ?? "unknown amount"}</span> (confirmed) to enable P2P assist.
                </div>

                {!!announce?.stakeNote?.trim() && (
                  <div className="text-xs text-neutral-500">
                    Note: <span className="text-neutral-300">{announce.stakeNote.trim()}</span>
                  </div>
                )}

                {!xmrRpcAvailable && (
                  <div className="text-xs text-neutral-500">
                    Stake verification is unavailable (origin wallet RPC not configured). P2P assist will remain disabled.
                  </div>
                )}

                {!identity && (
                  <div className="text-xs text-neutral-500">Connect identity to request a stake address.</div>
                )}

                {stakeError && <div className="text-xs text-red-300">{stakeError}</div>}

                {stake && (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
                    <div className="space-y-1">
                      <div className="text-xs text-neutral-500">Unique subaddress</div>
                      <div className="text-sm text-neutral-200 font-mono break-all">{stake.address}</div>
                      <div className="text-[11px] text-neutral-500">
                        This address is allocated by the streamer’s origin for wallet-RPC verification.
                      </div>

                      {!stakeStatus ? (
                        <div className="text-xs text-neutral-500 pt-2">Send stake to this subaddress, then click Check.</div>
                      ) : (
                        <div className={`text-xs pt-2 ${stakeSatisfied ? "text-emerald-300" : "text-neutral-500"}`}>
                          Confirmed{" "}
                          <span className="font-mono text-neutral-200">
                            {formatXmrAtomic(stakeStatus.confirmedAtomic)}
                          </span>{" "}
                          / Required{" "}
                          <span className="font-mono text-neutral-200">{formatXmrAtomic(stakeRequiredAtomic)}</span>{" "}
                          <span className="text-neutral-500">(≥{stakeStatus.confirmationsRequired} conf)</span>
                        </div>
                      )}

                      <div className="mt-3 pt-3 border-t border-neutral-800 space-y-2">
                        <div className="text-xs text-neutral-500">Request refund after participating in P2P assist.</div>
                        <input
                          value={stakeRefundAddress}
                          onChange={(e) => setStakeRefundAddress(e.target.value)}
                          placeholder="Refund Monero address"
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] text-neutral-500 font-mono">
                            Served bytes: {Math.max(0, Math.trunc(p2pStats?.bytesToPeers ?? 0))}
                          </div>
                          <button
                            type="button"
                            onClick={() => void requestStakeRefund()}
                            disabled={stakeRefundBusy || !stakeRefundAddress.trim()}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                          >
                            {stakeRefundBusy ? "Requesting…" : "Request refund"}
                          </button>
                        </div>
                        {stakeRefundError && <div className="text-xs text-red-300">{stakeRefundError}</div>}
                        {stakeRefundResult && (
                          <div className={`text-xs ${stakeRefundResult.settled ? "text-emerald-300" : "text-neutral-500"}`}>
                            {stakeRefundResult.settled ? "Refund settled" : "No unlocked stake to refund"} ·{" "}
                            <span className="font-mono">{formatXmrAtomic(stakeRefundResult.amountAtomic)}</span>
                            {stakeRefundResult.txids.length > 0 ? (
                              <span className="text-neutral-500"> · tx {shortenText(stakeRefundResult.txids[0] ?? "", { head: 10, tail: 8 })}</span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>

                    {stakeQr && (
                      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-2 w-fit">
                        <img src={stakeQr} alt="Stake QR" className="w-44 h-44" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {announce?.xmr && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <MoneroLogo className="w-5 h-5 text-orange-400" />
                    <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Monero</div>
                  </div>
                  <button
                    type="button"
                    onClick={copyTipAddress}
                    className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
                    title="Copy Monero address"
                  >
                    <Copy className="w-4 h-4" />
                    {tipCopyStatus === "copied" ? "Copied" : tipCopyStatus === "error" ? "Error" : "Copy"}
                  </button>
                </div>
                <div className="text-sm text-neutral-200 font-mono break-all">{announce.xmr}</div>
                <div className="text-xs text-neutral-500">Tips go directly to the streamer.</div>

                {xmrRpcAvailable && (
                  <div className="pt-3 border-t border-neutral-800 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-mono text-neutral-500 uppercase tracking-wider font-bold">Verified tips</div>
                      {!verifiedTip ? (
                        <button
                          type="button"
                          onClick={() => void startVerifiedTipSession()}
                          disabled={verifiedTipBusy !== "idle"}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                        >
                          {verifiedTipBusy === "creating" ? "Creating…" : "Get address"}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={copyVerifiedTipAddress}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
                            title="Copy verified tip address"
                          >
                            <Copy className="w-4 h-4" />
                            {verifiedTipCopyStatus === "copied" ? "Copied" : verifiedTipCopyStatus === "error" ? "Error" : "Copy"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void checkVerifiedTip()}
                            disabled={verifiedTipBusy !== "idle"}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                          >
                            {verifiedTipBusy === "checking" ? "Checking…" : "Check"}
                          </button>
                        </div>
                      )}
                    </div>

                    {verifiedTipError && <div className="text-xs text-red-300">{verifiedTipError}</div>}

                    {verifiedTip && (
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
                        <div className="space-y-1">
                          <div className="text-xs text-neutral-500">Unique subaddress</div>
                          <div className="text-sm text-neutral-200 font-mono break-all">{verifiedTip.address}</div>
                          <div className="text-[11px] text-neutral-500">
                            This address is allocated by the streamer’s origin for wallet-RPC verification.
                          </div>

                          {verifiedTipStatus?.found ? (
                            <div className="text-xs text-emerald-300 pt-2">
                              Detected{" "}
                              <span className="font-mono text-emerald-200">
                                {verifiedTipStatus.amountAtomic ? formatXmrAtomic(verifiedTipStatus.amountAtomic) : "a tip"}
                              </span>{" "}
                              {verifiedTipStatus.confirmed === false ? (
                                <span className="text-neutral-500">(unconfirmed)</span>
                              ) : verifiedTipStatus.confirmed === true ? (
                                <span className="text-neutral-500">(confirmed)</span>
                              ) : null}
                            </div>
                          ) : (
                            <div className="text-xs text-neutral-500 pt-2">Waiting for a transfer to this subaddress.</div>
                          )}
                        </div>

                        {verifiedTipQr && (
                          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-2 w-fit">
                            <img src={verifiedTipQr} alt="Monero QR" className="w-44 h-44" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {paymentRailGroups.length > 0 && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Wallet Actions</div>
                  <div className="text-xs text-neutral-500">Native app / extension / CLI</div>
                </div>

                <div className="space-y-3">
                  {paymentRailGroups.map(({ rail, methods }) => (
                    <div key={rail.id} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-neutral-200">{rail.name}</div>
                        <div className="text-[11px] text-neutral-500">
                          {rail.execution === "verified_backend" ? "verified backend" : "wallet URI / copy"}
                        </div>
                      </div>

                      <div className="space-y-2">
                        {methods.map((method, methodIndex) => {
                          const paymentKey = `${rail.id}:${method.asset}:${method.network ?? ""}:${method.address}:${methodIndex}`;
                          const walletUri = buildPaymentUri(method);
                          const preferredWalletId = social.settings.paymentDefaults.preferredWalletByAsset[method.asset] ?? null;
                          const preferredWallet = getWalletIntegrationById(preferredWalletId);
                          const copyState = paymentCopyStatus[paymentKey] ?? "idle";
                          const nativeState = nativeSendStatusByKey[paymentKey];
                          const nativeBusy = !!nativeSendBusyByKey[paymentKey];
                          const nativeAmountDraft = nativeSendAmountByKey[paymentKey] ?? "";
                          const assetMeta = PAYMENT_ASSET_META[method.asset];
                          const nativeCapability = getNativeWalletCapability(method);
                          const nativeSupported = nativeCapability.supported && supportsNativeWalletPayment(method);
                          const nativeNeedsAmount = nativeCapability.requiresAmount && nativeWalletSendNeedsAmount(method);
                          const nativeAmount = (method.amount ?? "").trim() || nativeAmountDraft.trim();
                          const canNativeSend = nativeSupported && (!nativeNeedsAmount || !!nativeAmount);
                          const providerLabel = nativeCapability.providerLabel || nativeWalletProviderLabel(method);
                          const nativeActionLabel = nativeCapability.mode === "wallet_uri" ? "Open wallet app" : `Send via ${providerLabel}`;
                          const nativeTitle = nativeSupported
                            ? nativeCapability.mode === "wallet_uri"
                              ? "Open wallet using payment URI"
                              : `Send with ${providerLabel}`
                            : nativeCapability.reason ?? `${providerLabel} not detected in this browser`;
                          return (
                            <div key={paymentKey} className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs text-neutral-300">
                                  <span className="font-semibold text-neutral-200">{assetMeta.symbol}</span>
                                  {method.network ? <span className="text-neutral-500"> · {method.network}</span> : null}
                                  {method.label ? <span className="text-neutral-500"> · {method.label}</span> : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void copyPaymentAddress(paymentKey, method.address)}
                                    className="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-1.5"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                    {copyState === "copied" ? "Copied" : copyState === "error" ? "Error" : "Copy"}
                                  </button>
                                  {walletUri && (
                                    <a
                                      href={walletUri}
                                      className="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
                                    >
                                      {preferredWallet ? `Open ${preferredWallet.name}` : "Open wallet"}
                                    </a>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => void sendNativePayment(paymentKey, method)}
                                    disabled={!canNativeSend || nativeBusy}
                                    className="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                                    title={nativeTitle}
                                  >
                                    {nativeBusy ? "Sending…" : nativeActionLabel}
                                  </button>
                                </div>
                              </div>
                              {nativeNeedsAmount && !(method.amount ?? "").trim() && (
                                <input
                                  value={nativeAmountDraft}
                                  onChange={(event) =>
                                    setNativeSendAmountByKey((prev) => ({ ...prev, [paymentKey]: event.target.value }))
                                  }
                                  placeholder={`Amount (${assetMeta.symbol})`}
                                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none"
                                />
                              )}
                              {!nativeSupported && (
                                <div className="text-[11px] text-neutral-500">
                                  {nativeCapability.reason ?? `${providerLabel} not detected in this browser.`}
                                </div>
                              )}
                              {nativeCapability.mode === "wallet_uri" && nativeSupported && (
                                <div className="text-[11px] text-neutral-500">
                                  This asset opens your installed wallet app using a URI handoff.
                                </div>
                              )}
                              <div className="text-xs text-neutral-400 font-mono break-all">{method.address}</div>
                              {nativeState?.message ? (
                                <div className={`text-[11px] ${nativeState.ok ? "text-emerald-300" : "text-red-300"}`}>
                                  {nativeState.message}
                                  {nativeState.txId ? (
                                    <>
                                      {" "}
                                      · tx{" "}
                                      <span className="font-mono text-neutral-300">
                                        {shortenText(nativeState.txId, { head: 12, tail: 8 })}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasLightningZap && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">NIP-57 Zaps</div>
                  <div className="text-xs text-neutral-500">
                    Receipts: <span className="font-mono text-neutral-300">{zapCount}</span> ·{" "}
                    <span className="font-mono text-neutral-300">{zapTotalSats}</span> sats
                  </div>
                </div>
                <div className="text-xs text-neutral-500">
                  Publish a signed zap request (kind 9734). Lightning settlement still happens in the viewer wallet flow.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={zapAmountSats}
                    onChange={(event) => setZapAmountSats(event.target.value)}
                    placeholder="sats"
                    className="bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none"
                  />
                  <input
                    value={zapComment}
                    onChange={(event) => setZapComment(event.target.value)}
                    placeholder="Optional zap note"
                    className="bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void publishZapRequest()}
                    disabled={zapRequestBusy}
                    className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                  >
                    {zapRequestBusy ? "Publishing…" : "Publish request"}
                  </button>
                </div>
                {zapRequestNotice && <div className="text-xs text-emerald-300">{zapRequestNotice}</div>}
                {zapRequestError && <div className="text-xs text-red-300">{zapRequestError}</div>}
              </div>
            )}
          </div>

          {(desktopWatchLayout || mobileLandscapeLayout) && (
            <div
              data-testid="watch-chat-panel"
              className={
                desktopWatchLayout
                  ? "sticky top-6 self-start h-[calc(100dvh-6.5rem)] min-h-[22rem] min-w-0"
                  : "sticky top-4 self-start h-[calc(100dvh-5.5rem)] min-h-[19rem] min-w-0"
              }
            >
              {chatBox}
            </div>
          )}
        </div>

        {tipModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/75" onClick={closeTipModal} />
            <div className="relative z-10 w-full max-w-3xl max-h-[88dvh] overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
                <div>
                  <div className="text-sm font-semibold text-neutral-100">Tip Streamer</div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Wallet rails configured by this creator. Methods matching your wallet setup are listed first.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeTipModal}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
                  aria-label="Close tip modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[calc(88dvh-5rem)] overflow-y-auto px-5 py-4 space-y-3">
                {tipModalMethods.length === 0 ? (
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-400">
                    This stream has not configured any tip wallets yet.
                  </div>
                ) : (
                  tipModalMethods.map(({ method, index, commonAsset, commonNetwork }) => {
                    const paymentKey = `tip-modal:${index}:${method.asset}:${method.network ?? ""}:${method.address}`;
                    const walletUri = buildPaymentUri(method);
                    const preferredWalletId = social.settings.paymentDefaults.preferredWalletByAsset[method.asset] ?? null;
                    const preferredWallet = getWalletIntegrationById(preferredWalletId);
                    const copyState = paymentCopyStatus[paymentKey] ?? "idle";
                    const nativeState = nativeSendStatusByKey[paymentKey];
                    const nativeBusy = !!nativeSendBusyByKey[paymentKey];
                    const nativeAmountDraft = nativeSendAmountByKey[paymentKey] ?? "";
                    const assetMeta = PAYMENT_ASSET_META[method.asset];
                    const nativeCapability = getNativeWalletCapability(method);
                    const nativeSupported = nativeCapability.supported && supportsNativeWalletPayment(method);
                    const nativeNeedsAmount = nativeCapability.requiresAmount && nativeWalletSendNeedsAmount(method);
                    const nativeAmount = (method.amount ?? "").trim() || nativeAmountDraft.trim();
                    const canNativeSend = nativeSupported && (!nativeNeedsAmount || !!nativeAmount);
                    const providerLabel = nativeCapability.providerLabel || nativeWalletProviderLabel(method);
                    const nativeActionLabel = nativeCapability.mode === "wallet_uri" ? "Open wallet app" : `Send via ${providerLabel}`;
                    const nativeTitle = nativeSupported
                      ? nativeCapability.mode === "wallet_uri"
                        ? "Open wallet using payment URI"
                        : `Send with ${providerLabel}`
                      : nativeCapability.reason ?? `${providerLabel} not detected in this browser`;

                    return (
                      <div key={paymentKey} className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold text-neutral-200">{assetMeta.symbol}</span>
                            {method.network ? <span className="text-neutral-500">· {method.network}</span> : null}
                            {method.label ? <span className="text-neutral-500">· {method.label}</span> : null}
                            {commonNetwork ? (
                              <span className="rounded-full border border-emerald-600/70 bg-emerald-900/30 px-2 py-0.5 text-[11px] text-emerald-200">
                                Matches your network
                              </span>
                            ) : commonAsset ? (
                              <span className="rounded-full border border-blue-600/70 bg-blue-900/30 px-2 py-0.5 text-[11px] text-blue-200">
                                Matches your wallet setup
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void copyPaymentAddress(paymentKey, method.address)}
                              className="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-1.5"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              {copyState === "copied" ? "Copied" : copyState === "error" ? "Error" : "Copy"}
                            </button>
                            {walletUri && (
                              <a
                                href={walletUri}
                                className="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
                              >
                                {preferredWallet ? `Open ${preferredWallet.name}` : "Open wallet"}
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => void sendNativePayment(paymentKey, method)}
                              disabled={!canNativeSend || nativeBusy}
                              className="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                              title={nativeTitle}
                            >
                              {nativeBusy ? "Sending…" : nativeActionLabel}
                            </button>
                          </div>
                        </div>

                        {nativeNeedsAmount && !(method.amount ?? "").trim() && (
                          <input
                            value={nativeAmountDraft}
                            onChange={(event) => setNativeSendAmountByKey((prev) => ({ ...prev, [paymentKey]: event.target.value }))}
                            placeholder={`Amount (${assetMeta.symbol})`}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none"
                          />
                        )}
                        <div className="text-xs text-neutral-400 font-mono break-all">{method.address}</div>
                        {nativeState?.message ? (
                          <div className={`text-[11px] ${nativeState.ok ? "text-emerald-300" : "text-red-300"}`}>
                            {nativeState.message}
                            {nativeState.txId ? (
                              <>
                                {" "}
                                · tx <span className="font-mono text-neutral-300">{shortenText(nativeState.txId, { head: 12, tail: 8 })}</span>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        <ReportDialog
          open={watchReportOpen}
          busy={watchReportBusy}
          title={watchReportDialogTitle}
          targetSummary={watchReportTargetSummary}
          error={watchReportError}
          onClose={closeWatchReport}
          onSubmit={submitWatchReport}
        />
      </main>
    </div>
    </>
  );
}
