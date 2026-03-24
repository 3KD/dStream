"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Star } from "lucide-react";
import QRCode from "qrcode";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { Player } from "@/components/Player";
import { ChatBox } from "@/components/chat/ChatBox";
import { MoneroLogo } from "@/components/icons/MoneroLogo";
import { useStreamAnnounce } from "@/hooks/useStreamAnnounce";
import { useStreamIntegrity } from "@/hooks/useStreamIntegrity";
import { useStreamPresence } from "@/hooks/useStreamPresence";
import { usePublishPresence } from "@/hooks/usePublishPresence";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";
import { isHttpLikeMediaUrl, isLikelyHlsUrl, isLikelyPlayableMediaUrl } from "@/lib/mediaUrl";
import { makeOriginStreamId } from "@/lib/origin";
import { getNostrRelays } from "@/lib/config";
import { formatXmrAtomic, resolveVodPolicy, vodModeLabel } from "@/lib/vodPolicy";
import { P2PSwarm, type P2PSwarmStats } from "@/lib/p2p/swarm";
import { createLocalSignalIdentity, type SignalIdentity } from "@/lib/p2p/localIdentity";
import { buildP2PBytesReceiptEvent } from "@dstream/protocol";

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

export default function WatchPage() {
  const routeParams = useParams<Record<string, string | string[]>>();
  const pubkeyParamRaw = routeParams?.pubkey;
  const streamIdRaw = routeParams?.streamId;
  const pubkeyParam = typeof pubkeyParamRaw === "string" ? pubkeyParamRaw : Array.isArray(pubkeyParamRaw) ? pubkeyParamRaw[0] ?? "" : "";
  const streamId = typeof streamIdRaw === "string" ? streamIdRaw : Array.isArray(streamIdRaw) ? streamIdRaw[0] ?? "" : "";
  const searchParams = useSearchParams();
  const e2e = searchParams.get("e2e") === "1";
  const manifestSignerQuery = normalizeHex64(searchParams.get("manifest"));
  const hlsOverrideQuery = searchParams.get("hls");
  const e2eHlsOverride = (() => {
    if (!hlsOverrideQuery) return null;
    const value = hlsOverrideQuery.trim();
    return isHttpLikeMediaUrl(value) ? value : null;
  })();
  const e2eSentRef = useRef({ loaded: false, player: false, chat: false, integrityVerified: false, integrityTamper: false });
  const { identity, signEvent, nip04 } = useIdentity();
  const social = useSocial();
  const relays = useMemo(() => getNostrRelays(), []);
  const pubkey = useMemo(() => pubkeyParamToHex(pubkeyParam), [pubkeyParam]);
  const npub = useMemo(() => (pubkey ? pubkeyHexToNpub(pubkey) : null), [pubkey]);
  const originStreamId = useMemo(() => (pubkey ? makeOriginStreamId(pubkey, streamId) : null), [pubkey, streamId]);

  const { announce } = useStreamAnnounce(pubkey ?? "", streamId);
  const manifestSignerPubkey = announce?.manifestSignerPubkey ?? manifestSignerQuery;
  const { viewerCount, viewerPubkeys } = useStreamPresence({ streamPubkey: pubkey ?? "", streamId });
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
  const vodPolicy = useMemo(() => (announce ? resolveVodPolicy(announce) : { mode: "off" as const }), [announce]);
  const vodPriceAtomic = useMemo(() => {
    const raw = vodPolicy.priceAtomic;
    if (!raw || !/^\d+$/.test(raw)) return null;
    try {
      const value = BigInt(raw);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [vodPolicy.priceAtomic]);
  const vodPaidRequiresUnlock = useMemo(() => {
    if (!announce || announce.status !== "ended") return false;
    if (vodPolicy.mode !== "paid") return false;
    const currency = (vodPolicy.currency ?? "xmr").toLowerCase();
    return currency === "xmr" && vodPriceAtomic !== null;
  }, [announce, vodPolicy, vodPriceAtomic]);
  const vodPlaylistId = useMemo(() => (vodPolicy.playlistId ?? "").trim(), [vodPolicy.playlistId]);
  const vodEntitlementScope = useMemo<"stream" | "playlist">(
    () => (vodPolicy.accessScope === "playlist" && vodPlaylistId ? "playlist" : "stream"),
    [vodPlaylistId, vodPolicy.accessScope]
  );
  const [vodUnlocked, setVodUnlocked] = useState(false);
  const [vodUnlockExpiresAtMs, setVodUnlockExpiresAtMs] = useState<number | null>(null);
  const [vodAccessToken, setVodAccessToken] = useState<string | null>(null);
  const [vodUnlockSession, setVodUnlockSession] = useState<{ session: string; address: string } | null>(null);
  const [vodUnlockQr, setVodUnlockQr] = useState<string | null>(null);
  const [vodUnlockCopyStatus, setVodUnlockCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [vodUnlockBusy, setVodUnlockBusy] = useState<"idle" | "creating" | "checking">("idle");
  const [vodUnlockError, setVodUnlockError] = useState<string | null>(null);
  const [vodUnlockStatus, setVodUnlockStatus] = useState<{
    found: boolean;
    amountAtomic: string | null;
    confirmed: boolean | null;
    observedAtMs: number | null;
  } | null>(null);
  const [vodNowMs, setVodNowMs] = useState(() => Date.now());

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
  const [mobileLayoutMode, setMobileLayoutMode] = useState<"portrait" | "landscape" | "desktop">("portrait");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateLayout = () => {
      const width = window.innerWidth;
      const height = Math.max(window.innerHeight, 1);
      const ratio = width / height;
      const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
      const hoverNone = window.matchMedia("(hover: none)").matches;
      const touchPoints = navigator.maxTouchPoints ?? 0;
      const touchCapable = coarsePointer || hoverNone || touchPoints > 0;
      const mobileSized = width <= 1366;
      if (!touchCapable || !mobileSized) {
        setMobileLayoutMode("desktop");
        return;
      }

      const orientationLandscape = window.matchMedia("(orientation: landscape)").matches;
      const isLandscape = orientationLandscape || (ratio > 1.05 && width >= 560);
      setMobileLayoutMode(isLandscape ? "landscape" : "portrait");
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);
    window.visualViewport?.addEventListener("resize", updateLayout);
    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
      window.visualViewport?.removeEventListener("resize", updateLayout);
    };
  }, []);

  const mobileLandscapeLayout = mobileLayoutMode === "landscape";

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

  const fallbackUrl = originStreamId ? `/api/hls/${originStreamId}/index.m3u8` : `/api/hls/${streamId}/index.m3u8`;
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
      .filter((rendition) => rendition.id && isLikelyPlayableMediaUrl(rendition.url))
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

  const streamUrl = useMemo(() => {
    if (e2eHlsOverride) return e2eHlsOverride;
    const streamingHint = announce?.streaming?.trim() ?? "";
    if (renditionMasterUrl) return renditionMasterUrl;
    if (renditionHints[0]?.url) return renditionHints[0].url;
    if (isLikelyPlayableMediaUrl(streamingHint)) return streamingHint;
    return fallbackUrl;
  }, [announce?.streaming, e2eHlsOverride, fallbackUrl, renditionHints, renditionMasterUrl]);
  const playbackStreamUrl = useMemo(() => {
    if (!vodPaidRequiresUnlock || !vodAccessToken) return streamUrl;
    return withQueryParam(streamUrl, "vat", vodAccessToken);
  }, [streamUrl, vodAccessToken, vodPaidRequiresUnlock]);

  const shouldTryWhep = useMemo(() => {
    if (!originStreamId) return false;
    return isLikelyHlsUrl(streamUrl);
  }, [originStreamId, streamUrl]);

  const whepSrc = useMemo(() => {
    if (!originStreamId || !shouldTryWhep) return null;
    return `/api/whep/${encodeURIComponent(originStreamId)}/whep`;
  }, [originStreamId, shouldTryWhep]);

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

  const [verifiedTipCopyStatus, setVerifiedTipCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const needsXmrRpc = !!(announce?.xmr || stakeRequiredAtomic || vodPaidRequiresUnlock);
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

  const vodEntitlementKey = useMemo(
    () => (pubkey && streamId ? `dstream_vod_access_v1:${pubkey}:${streamId}` : null),
    [pubkey, streamId]
  );
  const vodPlaylistEntitlementKey = useMemo(
    () => (pubkey && vodPlaylistId ? `dstream_vod_playlist_access_v1:${pubkey}:${vodPlaylistId}` : null),
    [pubkey, vodPlaylistId]
  );

  const persistVodUnlock = useCallback(
    (params: {
      observedAtMs?: number | null;
      accessToken?: string | null;
      expiresAtMs?: number | null;
      accessScope?: "stream" | "playlist";
      playlistId?: string | null;
    }) => {
      const unlockedAtMs = params.observedAtMs && Number.isFinite(params.observedAtMs) ? params.observedAtMs : Date.now();
      const accessSeconds = vodPolicy.accessSeconds && vodPolicy.accessSeconds > 0 ? vodPolicy.accessSeconds : null;
      const expiresAtMs = params.expiresAtMs ?? (accessSeconds ? unlockedAtMs + accessSeconds * 1000 : null);
      const accessToken = params.accessToken?.trim() || null;
      const accessScope = params.accessScope === "playlist" && vodPlaylistId ? "playlist" : "stream";
      const playlistId = (params.playlistId ?? vodPlaylistId ?? "").trim() || null;

      if (vodPaidRequiresUnlock && !accessToken) {
        setVodUnlocked(false);
        setVodAccessToken(null);
        setVodUnlockExpiresAtMs(null);
        return;
      }

      setVodUnlocked(true);
      setVodAccessToken(accessToken);
      setVodUnlockExpiresAtMs(expiresAtMs);
      if (!vodEntitlementKey) return;
      try {
        const payload = JSON.stringify({
          unlockedAtMs,
          expiresAtMs,
          accessToken,
          accessScope,
          playlistId
        });
        localStorage.setItem(vodEntitlementKey, payload);
        if (accessScope === "playlist" && vodPlaylistEntitlementKey) {
          localStorage.setItem(vodPlaylistEntitlementKey, payload);
        }
      } catch {
        // ignore storage errors
      }
    },
    [vodEntitlementKey, vodPaidRequiresUnlock, vodPlaylistEntitlementKey, vodPlaylistId, vodPolicy.accessSeconds]
  );

  useEffect(() => {
    if (!vodPaidRequiresUnlock) {
      setVodUnlocked(true);
      setVodUnlockExpiresAtMs(null);
      setVodAccessToken(null);
      return;
    }
    setVodUnlocked(false);
    setVodUnlockExpiresAtMs(null);
    setVodAccessToken(null);
    if (!vodEntitlementKey) return;

    const candidateKeys = [vodEntitlementKey];
    if (vodEntitlementScope === "playlist" && vodPlaylistEntitlementKey) {
      candidateKeys.push(vodPlaylistEntitlementKey);
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
        if (vodEntitlementScope === "playlist") {
          const scope = parsed?.accessScope === "playlist" ? "playlist" : "stream";
          const playlistId = typeof parsed?.playlistId === "string" ? parsed.playlistId.trim() : "";
          if (scope !== "playlist" || !vodPlaylistId || playlistId !== vodPlaylistId) continue;
        }
        setVodUnlocked(true);
        setVodAccessToken(accessToken);
        setVodUnlockExpiresAtMs(expiresAtMs);
        break;
      }
    } catch {
      // ignore parse errors
    }
  }, [vodEntitlementKey, vodEntitlementScope, vodPaidRequiresUnlock, vodPlaylistEntitlementKey, vodPlaylistId]);

  useEffect(() => {
    if (!vodUnlockExpiresAtMs || !vodEntitlementKey) return;
    const remaining = vodUnlockExpiresAtMs - Date.now();
    const clearKeys = () => {
      try {
        localStorage.removeItem(vodEntitlementKey);
        if (vodPlaylistEntitlementKey) localStorage.removeItem(vodPlaylistEntitlementKey);
      } catch {
        // ignore
      }
    };
    if (remaining <= 0) {
      setVodUnlocked(false);
      setVodAccessToken(null);
      setVodUnlockExpiresAtMs(null);
      clearKeys();
      return;
    }

    const timer = setTimeout(() => {
      setVodUnlocked(false);
      setVodAccessToken(null);
      setVodUnlockExpiresAtMs(null);
      clearKeys();
    }, remaining);
    return () => clearTimeout(timer);
  }, [vodEntitlementKey, vodPlaylistEntitlementKey, vodUnlockExpiresAtMs]);

  const claimVodAccess = useCallback(
    async (tipSession: string, observedAtMs: number | null): Promise<boolean> => {
      const res = await fetch("/api/vod/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tipSession })
      });

      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        if (res.status === 402) {
          if (data?.reason === "amount_insufficient") {
            setVodUnlockError("Payment detected but below VOD unlock price.");
          } else if (data?.reason === "payment_not_confirmed") {
            setVodUnlockError("Payment detected but still waiting for confirmations.");
          } else {
            setVodUnlockError("Unlock is not available yet. Confirm payment and retry.");
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

      persistVodUnlock({
        observedAtMs,
        accessToken,
        expiresAtMs,
        accessScope,
        playlistId
      });
      return true;
    },
    [persistVodUnlock]
  );

  const startVodUnlockSession = useCallback(async () => {
    if (!pubkey || !streamId || !vodPaidRequiresUnlock) return;
    setVodUnlockBusy("creating");
    setVodUnlockError(null);
    setVodUnlockStatus(null);
    setVodUnlockSession(null);
    setVodUnlockQr(null);

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
      setVodUnlockSession({ session, address });
    } catch (err: any) {
      setVodUnlockError(err?.message ?? "Failed to create unlock session.");
    } finally {
      setVodUnlockBusy("idle");
    }
  }, [pubkey, streamId, vodPaidRequiresUnlock]);

  const checkVodUnlockStatus = useCallback(async () => {
    if (vodUnlockBusy !== "idle") return;
    const token = vodUnlockSession?.session;
    if (!token || !vodPaidRequiresUnlock || vodPriceAtomic === null) return;
    setVodUnlockBusy("checking");
    setVodUnlockError(null);
    try {
      const res = await fetch(`/api/xmr/tip/session/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as any;
      const amountAtomic = typeof data?.amountAtomic === "string" ? data.amountAtomic : null;
      const confirmed = typeof data?.confirmed === "boolean" ? data.confirmed : null;
      const found = !!data?.found;
      const observedAtMs = typeof data?.observedAtMs === "number" ? data.observedAtMs : null;
      setVodUnlockStatus({ found, amountAtomic, confirmed, observedAtMs });

      if (found && confirmed && amountAtomic && /^\d+$/.test(amountAtomic) && BigInt(amountAtomic) >= vodPriceAtomic) {
        await claimVodAccess(token, observedAtMs);
      }
    } catch (err: any) {
      setVodUnlockError(err?.message ?? "Failed to check unlock status.");
    } finally {
      setVodUnlockBusy("idle");
    }
  }, [claimVodAccess, vodPaidRequiresUnlock, vodPriceAtomic, vodUnlockBusy, vodUnlockSession?.session]);

  useEffect(() => {
    if (!vodUnlockSession?.session || !vodPaidRequiresUnlock || !xmrRpcAvailable || vodUnlocked) return;
    void checkVodUnlockStatus();
    const interval = setInterval(() => {
      void checkVodUnlockStatus();
    }, 12_000);
    return () => clearInterval(interval);
  }, [checkVodUnlockStatus, vodPaidRequiresUnlock, vodUnlockSession?.session, vodUnlocked, xmrRpcAvailable]);

  useEffect(() => {
    if (!vodPaidRequiresUnlock && !vodUnlockExpiresAtMs && !vodUnlockSession?.session) return;
    const interval = setInterval(() => setVodNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [vodPaidRequiresUnlock, vodUnlockExpiresAtMs, vodUnlockSession?.session]);

  const copyVodUnlockAddress = useCallback(async () => {
    setVodUnlockCopyStatus("idle");
    try {
      const address = vodUnlockSession?.address?.trim();
      if (!address) return;
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(address);
      setVodUnlockCopyStatus("copied");
      setTimeout(() => setVodUnlockCopyStatus("idle"), 1200);
    } catch {
      setVodUnlockCopyStatus("error");
      setTimeout(() => setVodUnlockCopyStatus("idle"), 1800);
    }
  }, [vodUnlockSession?.address]);

  useEffect(() => {
    let cancelled = false;
    const address = vodUnlockSession?.address?.trim();
    if (!address) {
      setVodUnlockQr(null);
      return;
    }

    void (async () => {
      try {
        const uri = `monero:${address}`;
        const dataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 176 });
        if (cancelled) return;
        setVodUnlockQr(dataUrl);
      } catch {
        if (cancelled) return;
        setVodUnlockQr(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [vodUnlockSession?.address]);

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
    setVodUnlockSession(null);
    setVodUnlockQr(null);
    setVodUnlockCopyStatus("idle");
    setVodUnlockBusy("idle");
    setVodUnlockError(null);
    setVodUnlockStatus(null);
    setVodAccessToken(null);
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

  const showVodUnlockGate = vodPaidRequiresUnlock && !vodUnlocked;
  const vodAccessExpiryLabel = useMemo(() => {
    if (!vodUnlockExpiresAtMs) return null;
    return new Date(vodUnlockExpiresAtMs).toLocaleString();
  }, [vodUnlockExpiresAtMs]);
  const vodAccessRemainingLabel = useMemo(() => {
    if (!vodUnlockExpiresAtMs) return null;
    return formatRemainingMs(vodUnlockExpiresAtMs - vodNowMs);
  }, [vodNowMs, vodUnlockExpiresAtMs]);
  const vodUnlockDeepLink = useMemo(() => {
    const address = vodUnlockSession?.address?.trim();
    return address ? `monero:${address}` : null;
  }, [vodUnlockSession?.address]);
  const vodUnlockSatisfied = useMemo(() => {
    if (!vodUnlockStatus?.found || !vodUnlockStatus.confirmed || !vodUnlockStatus.amountAtomic || vodPriceAtomic === null) {
      return false;
    }
    if (!/^\d+$/.test(vodUnlockStatus.amountAtomic)) return false;
    try {
      return BigInt(vodUnlockStatus.amountAtomic) >= vodPriceAtomic;
    } catch {
      return false;
    }
  }, [vodPriceAtomic, vodUnlockStatus]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-7xl mx-auto p-6">
        {!pubkey && (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
            Invalid pubkey in route. Expected a 64-hex pubkey or an <span className="font-mono">npub…</span>.
          </div>
        )}
        <header className="flex items-center justify-between mb-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">{announce?.title ?? "Live Stream"}</h1>
            {pubkey && (
              <div className="text-xs text-neutral-500 font-mono">
                {social.getAlias(pubkey) && <span className="text-neutral-300">{social.getAlias(pubkey)}</span>}
                {social.getAlias(pubkey) && <span className="text-neutral-600"> · </span>}
                {npub ? shortenText(npub, { head: 14, tail: 8 }) : shortenText(pubkey, { head: 14, tail: 8 })} / {streamId}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {pubkey && (
              <button
                type="button"
                onClick={() => social.toggleFavoriteStream(pubkey, streamId)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200"
                title={social.isFavoriteStream(pubkey, streamId) ? "Unfavorite" : "Favorite"}
                aria-label={social.isFavoriteStream(pubkey, streamId) ? "Unfavorite stream" : "Favorite stream"}
              >
                <Star
                  className={`w-4 h-4 ${
                    social.isFavoriteStream(pubkey, streamId) ? "fill-yellow-400 text-yellow-400" : "text-neutral-400"
                  }`}
                />
              </button>
            )}
            <Link className="text-sm text-neutral-300 hover:text-white" href="/browse">
              Back to Browse
            </Link>
          </div>
        </header>

        {pubkey && (
          <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
            <div className="text-sm text-neutral-200">
              <span className="text-neutral-400">Viewers</span> <span className="font-mono">≈ {viewerCount}</span>
              <span className="ml-2 text-xs text-neutral-500">presence (approx)</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={presenceEnabled}
                    onChange={(e) => social.updateSettings({ presenceEnabled: e.target.checked })}
                    className="accent-blue-500"
                  />
                  Share presence
                </label>
                <label
                  className={`flex items-center gap-2 select-none ${
                    p2pAllowed ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={p2pEnabled}
                    onChange={(e) => social.updateSettings({ p2pAssistEnabled: e.target.checked })}
                    className="accent-blue-500"
                    disabled={!p2pAllowed}
                  />
                  P2P assist
                </label>
                {p2pBlockedReason && <span className="w-full text-[11px] text-neutral-500">{p2pBlockedReason}</span>}
                {integritySnapshot && manifestSignerPubkey && (
                  <span
                    className={`font-mono ${
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
                  </span>
                )}
                {identity ? (
                  <span className="font-mono text-neutral-500">
                    {presenceStatus === "sending"
                      ? "publishing…"
                      : presenceStatus === "ok"
                      ? lastSentAt
                        ? `ok (${new Date(lastSentAt).toLocaleTimeString()})`
                        : "ok"
                      : presenceStatus === "fail"
                        ? "failed"
                        : "idle"}
                </span>
              ) : (
                <span className="text-neutral-500">Connect identity to publish.</span>
              )}
            </div>
          </div>
        )}

        {showP2PPanel && (
          <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
            <div className="text-sm text-neutral-200">
              <span className="text-neutral-400">P2P</span>{" "}
              <span className="font-mono">
                {p2pStats?.peersConnected ?? 0} peers / {Math.round((p2pStats?.cacheBytes ?? 0) / 1024)} KiB cache
              </span>
              <span className="ml-2 text-xs text-neutral-500 font-mono">
                hit-rate {p2pHitRatePct === null ? "n/a" : `${p2pHitRatePct}%`} · contribution{" "}
                {p2pContributionPct === null ? "n/a" : `${p2pContributionPct}%`}
              </span>
            </div>
            <div className="text-xs text-neutral-400 font-mono">
              in: {Math.round((p2pStats?.bytesFromPeers ?? 0) / 1024)} KiB · out:{" "}
              {Math.round((p2pStats?.bytesToPeers ?? 0) / 1024)} KiB · hits: {p2pStats?.hitsFromPeers ?? 0}/
              {p2pStats?.requestsToPeers ?? 0}
            </div>
          </div>
        )}

        <div
          className={`grid gap-6 ${
            mobileLandscapeLayout
              ? "grid-cols-[minmax(0,1fr)_minmax(14rem,38vw)] items-stretch"
              : "grid-cols-1 lg:grid-cols-3"
          }`}
        >
          <div className={mobileLandscapeLayout ? "min-w-0 space-y-6" : "lg:col-span-2 space-y-6"}>
            {showVodUnlockGate ? (
              <div className="rounded-2xl border border-amber-700/40 bg-amber-950/15 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <MoneroLogo className="w-5 h-5 text-orange-400" />
                    <div className="text-xs font-mono text-amber-200 uppercase tracking-wider font-bold">Paid VOD</div>
                  </div>
                  <div className="text-xs text-amber-300">{vodModeLabel(vodPolicy)} unlock required</div>
                </div>

                <div className="text-sm text-neutral-200">
                  Unlock price:{" "}
                  <span className="font-mono text-amber-300">
                    {vodPriceAtomic ? formatXmrAtomic(vodPriceAtomic.toString()) : "unknown"}
                  </span>
                </div>
                <div className="text-xs text-neutral-500">
                  Scope:{" "}
                  <span className="text-neutral-300">
                    {vodEntitlementScope === "playlist" && vodPlaylistId
                      ? `playlist bundle (${vodPlaylistId})`
                      : "single stream replay"}
                  </span>
                </div>

                {vodAccessExpiryLabel && (
                  <div className="text-xs text-neutral-500">
                    Current unlock expires at {vodAccessExpiryLabel}
                    {vodAccessRemainingLabel ? ` (in ${vodAccessRemainingLabel})` : ""}.
                  </div>
                )}

                {!xmrRpcAvailable && (
                  <div className="text-xs text-neutral-500">Unlock verification unavailable (origin wallet RPC not configured).</div>
                )}
                {vodUnlockError && <div className="text-xs text-red-300">{vodUnlockError}</div>}
                {vodUnlockStatus && (
                  <div className={`text-xs ${vodUnlockSatisfied ? "text-emerald-300" : "text-neutral-500"}`}>
                    {vodUnlockStatus.found
                      ? `Detected ${vodUnlockStatus.amountAtomic ? formatXmrAtomic(vodUnlockStatus.amountAtomic) : "a payment"}${
                          vodUnlockStatus.confirmed ? " (confirmed)" : " (unconfirmed)"
                        }`
                      : "Waiting for payment…"}
                  </div>
                )}
                {!!vodUnlockSession?.session && !vodUnlockSatisfied && (
                  <div className="text-[11px] text-neutral-500">Auto-checking unlock status every 12 seconds.</div>
                )}

                {!vodUnlockSession ? (
                  <button
                    type="button"
                    onClick={() => void startVodUnlockSession()}
                    disabled={vodUnlockBusy !== "idle" || !xmrRpcAvailable}
                    className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                  >
                    {vodUnlockBusy === "creating" ? "Creating…" : "Get unlock address"}
                  </button>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
                    <div className="space-y-2">
                      <div className="text-xs text-neutral-500">Payment subaddress</div>
                      <div className="text-sm text-neutral-200 font-mono break-all">{vodUnlockSession.address}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={copyVodUnlockAddress}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
                        >
                          <Copy className="w-4 h-4" />
                          {vodUnlockCopyStatus === "copied"
                            ? "Copied"
                            : vodUnlockCopyStatus === "error"
                              ? "Error"
                              : "Copy"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void checkVodUnlockStatus()}
                          disabled={vodUnlockBusy !== "idle"}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                        >
                          {vodUnlockBusy === "checking" ? "Checking…" : "Check unlock"}
                        </button>
                        {vodUnlockDeepLink && (
                          <a
                            href={vodUnlockDeepLink}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
                          >
                            Open wallet
                          </a>
                        )}
                      </div>
                    </div>
                    {vodUnlockQr && (
                      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-2 w-fit">
                        <img src={vodUnlockQr} alt="Unlock QR" className="w-44 h-44" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Player
                src={playbackStreamUrl}
                whepSrc={whepSrc}
                p2pSwarm={p2pSwarm}
                integrity={integritySession}
                captionTracks={captionTracks}
                autoplayMuted={e2e ? true : social.settings.playbackAutoplayMuted}
                onReady={() => {
                  if (!e2e || e2eSentRef.current.player) return;
                  e2eSentRef.current.player = true;
                  postE2E({ type: "dstream:e2e", t: "watch_player_ready", streamPubkey: pubkey ?? "", streamId });
                }}
              />
            )}

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold mb-2">About</div>
              <p className="text-sm text-neutral-300 leading-relaxed">
                {announce?.summary ??
                  "This stream is discoverable via Nostr and delivered via HLS (with optional peer assist when available)."}
              </p>
              <div className="mt-4 text-xs text-neutral-500">
                VOD:{" "}
                <span className="text-neutral-300">
                  {vodModeLabel(vodPolicy)}
                  {vodPolicy.mode === "paid" && vodPolicy.priceAtomic ? ` · ${formatXmrAtomic(vodPolicy.priceAtomic)}` : ""}
                  {vodPolicy.mode === "paid" ? ` · ${vodEntitlementScope === "playlist" ? "playlist unlock" : "stream unlock"}` : ""}
                  {vodPolicy.accessSeconds ? ` · ${Math.ceil(vodPolicy.accessSeconds / 3600)}h access` : ""}
                </span>
              </div>
              <div className="mt-4 text-xs text-neutral-500">
                Playback URL: <span className="font-mono break-all">{streamUrl}</span>
              </div>
              {captionTracks.length > 0 && (
                <div className="mt-2 text-xs text-neutral-500">
                  Captions:{" "}
                  <span className="text-neutral-300">
                    {captionTracks.map((track) => `${track.label} (${track.lang})`).join(", ")}
                  </span>
                </div>
              )}
            </div>

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
          </div>

          <div className={mobileLandscapeLayout ? "h-[min(72dvh,27rem)] min-h-[15rem]" : "h-[70vh] lg:h-auto"}>
            <ChatBox
              streamPubkey={pubkey ?? ""}
              streamId={streamId}
              onMessageCountChange={(count) => {
                if (!e2e || e2eSentRef.current.chat) return;
                if (count <= 0) return;
                e2eSentRef.current.chat = true;
                postE2E({ type: "dstream:e2e", t: "watch_chat_ready", streamPubkey: pubkey ?? "", streamId });
              }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
