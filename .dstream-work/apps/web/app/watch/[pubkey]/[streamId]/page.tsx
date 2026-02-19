"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { Copy, ExternalLink, Flag, Star } from "lucide-react";
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
import { makeOriginStreamId } from "@/lib/origin";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";
import { buildSignedScopeProof, submitModerationReport } from "@/lib/moderation/reportClient";
import {
  PAYMENT_ASSET_META,
  assetLabel,
  buildPaymentUri,
  comparePaymentAssetOrder,
  getWalletIntegrationById,
  getWalletIntegrationsForAsset
} from "@/lib/payments/catalog";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import { P2PSwarm, type P2PSwarmStats } from "@/lib/p2p/swarm";
import { createLocalSignalIdentity, type SignalIdentity } from "@/lib/p2p/localIdentity";
import {
  NOSTR_KINDS,
  buildP2PBytesReceiptEvent,
  makeGuildATag,
  makeGuildKey,
  parseGuildMembershipEvent,
  parseGuildRoleEvent,
  type StreamGuildFeeWaiver,
  type StreamHostMode,
  type StreamPaymentAsset
} from "@dstream/protocol";
import type { ReportReasonCode, ReportTargetType } from "@/lib/moderation/reportTypes";

function formatXmrAtomic(amountAtomic: string): string {
  try {
    const v = BigInt(amountAtomic);
    const denom = 1_000_000_000_000n;
    const whole = v / denom;
    const frac = v % denom;
    return `${whole.toString()}.${frac.toString().padStart(12, "0")}`;
  } catch {
    return amountAtomic;
  }
}

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

function isPlaybackUrl(input: string | null | undefined): input is string {
  if (!input) return false;
  const value = input.trim();
  return /^https?:\/\//i.test(value) || value.startsWith("/");
}

function appendPlaybackAccessToken(url: string, accessToken: string | null): string {
  if (!accessToken) return url;
  const token = accessToken.trim();
  if (!token) return url;
  try {
    const parsed = new URL(url, "http://dstream.local");
    parsed.searchParams.set("access", token);
    if (parsed.origin === "http://dstream.local") {
      return `${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}access=${encodeURIComponent(token)}`;
  }
}

function normalizeHostMode(input: string | null | undefined): StreamHostMode {
  const value = (input ?? "").trim().toLowerCase();
  if (value === "host_only") return "host_only";
  return "p2p_economy";
}

function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

interface VodRecordingEntry {
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  url: string;
}

interface WatchReportTarget {
  targetType: ReportTargetType;
  targetPubkey: string;
  targetStreamId: string;
  summary: string;
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
    return isPlaybackUrl(value) ? value : null;
  })();
  const e2eSentRef = useRef({ loaded: false, player: false, chat: false, integrityVerified: false, integrityTamper: false });
  const { identity, signEvent, nip04 } = useIdentity();
  const social = useSocial();
  const relays = useMemo(() => getNostrRelays(), []);
  const pubkey = useMemo(() => pubkeyParamToHex(pubkeyParam), [pubkeyParam]);
  const npub = useMemo(() => (pubkey ? pubkeyHexToNpub(pubkey) : null), [pubkey]);
  const originStreamId = useMemo(() => (pubkey ? makeOriginStreamId(pubkey, streamId) : null), [pubkey, streamId]);

  const { announce } = useStreamAnnounce(pubkey ?? "", streamId);
  const vodArchiveEnabled = announce?.vodArchiveEnabled === true;
  const manifestSignerPubkey = announce?.manifestSignerPubkey ?? manifestSignerQuery;
  const integrityFallbackManifestUrl = e2e ? "/api/manifest/latest" : null;
  const { viewerCount, viewerPubkeys } = useStreamPresence({ streamPubkey: pubkey ?? "", streamId, windowSec: 180 });
  const { session: integritySession, snapshot: integritySnapshot } = useStreamIntegrity({
    streamPubkey: pubkey ?? "",
    streamId,
    manifestSignerPubkey,
    fallbackManifestUrl: integrityFallbackManifestUrl
  });
  const hostMode = useMemo<StreamHostMode>(() => normalizeHostMode(announce?.hostMode), [announce?.hostMode]);
  const chatSlowModeSec = useMemo(() => {
    const value = announce?.streamChatSlowModeSec;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return 0;
    return Math.max(1, Math.min(value, 120));
  }, [announce?.streamChatSlowModeSec]);
  const chatSubscriberOnly = announce?.streamChatSubscriberOnly === true;
  const chatFollowerOnly = announce?.streamChatFollowerOnly === true;
  const rebroadcastThreshold = useMemo(() => {
    const value = announce?.rebroadcastThreshold;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return 6;
    return Math.max(1, Math.min(value, 64));
  }, [announce?.rebroadcastThreshold]);
  const announcePayments = useMemo(() => announce?.payments ?? [], [announce?.payments]);
  const xmrPaymentAddress = useMemo(() => {
    const direct = announcePayments.find((method) => method.asset === "xmr")?.address?.trim();
    if (direct) return direct;
    const legacy = announce?.xmr?.trim();
    return legacy || null;
  }, [announce?.xmr, announcePayments]);
  const nonXmrPayments = useMemo(() => announcePayments.filter((method) => method.asset !== "xmr"), [announcePayments]);
  const payoutAssets = useMemo(() => {
    const set = new Set<StreamPaymentAsset>();
    if (xmrPaymentAddress) set.add("xmr");
    for (const method of nonXmrPayments) {
      set.add(method.asset);
    }
    return Array.from(set);
  }, [nonXmrPayments, xmrPaymentAddress]);
  const orderedPayoutAssets = useMemo(() => {
    const preferredWalletByAsset = social.settings.paymentDefaults.preferredWalletByAsset;
    return [...payoutAssets].sort((left, right) => {
      const leftWallet = getWalletIntegrationById(preferredWalletByAsset[left]);
      const rightWallet = getWalletIntegrationById(preferredWalletByAsset[right]);
      const leftPreferred = leftWallet && leftWallet.assets.includes(left) ? 0 : 1;
      const rightPreferred = rightWallet && rightWallet.assets.includes(right) ? 0 : 1;
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
      return comparePaymentAssetOrder(left, right);
    });
  }, [payoutAssets, social.settings.paymentDefaults.preferredWalletByAsset]);
  const autoSelectedPayoutAsset = orderedPayoutAssets[0] ?? null;
  const orderedNonXmrPayments = useMemo(() => {
    const assetRank = new Map<StreamPaymentAsset, number>(orderedPayoutAssets.map((asset, index) => [asset, index]));
    return nonXmrPayments
      .map((method, originalIndex) => ({
        method,
        originalIndex,
        rank: assetRank.get(method.asset) ?? Number.MAX_SAFE_INTEGER
      }))
      .sort((left, right) => {
        if (left.rank !== right.rank) return left.rank - right.rank;
        const byAssetOrder = comparePaymentAssetOrder(left.method.asset, right.method.asset);
        if (byAssetOrder !== 0) return byAssetOrder;
        return left.originalIndex - right.originalIndex;
      })
      .map((row) => row.method);
  }, [nonXmrPayments, orderedPayoutAssets]);
  const preferredWalletsForPayoutAssets = useMemo(() => {
    return orderedPayoutAssets
      .map((asset) => {
        const walletId = social.settings.paymentDefaults.preferredWalletByAsset[asset];
        const wallet = getWalletIntegrationById(walletId);
        if (!wallet) return null;
        return { asset, wallet };
      })
      .filter((row): row is { asset: StreamPaymentAsset; wallet: NonNullable<ReturnType<typeof getWalletIntegrationById>> } => !!row);
  }, [orderedPayoutAssets, social.settings.paymentDefaults.preferredWalletByAsset]);

  const feeWaiverGuilds = useMemo<StreamGuildFeeWaiver[]>(() => announce?.feeWaiverGuilds ?? [], [announce?.feeWaiverGuilds]);
  const feeWaiverVipPubkeys = useMemo(() => announce?.feeWaiverVipPubkeys ?? [], [announce?.feeWaiverVipPubkeys]);
  const viewerPubkey = identity?.pubkey?.trim().toLowerCase() ?? null;
  const privateViewerAllowPubkeys = useMemo(() => announce?.viewerAllowPubkeys ?? [], [announce?.viewerAllowPubkeys]);
  const privateStreamEnabled = privateViewerAllowPubkeys.length > 0;
  const viewerPrivateAllowed = useMemo(() => {
    if (!privateStreamEnabled || !pubkey) return true;
    if (!viewerPubkey) return false;
    if (viewerPubkey === pubkey.toLowerCase()) return true;
    return privateViewerAllowPubkeys.includes(viewerPubkey);
  }, [privateStreamEnabled, privateViewerAllowPubkeys, pubkey, viewerPubkey]);
  const [playbackAccessState, setPlaybackAccessState] = useState<"idle" | "issuing" | "ready" | "denied" | "error">("idle");
  const [playbackAccessToken, setPlaybackAccessToken] = useState<string | null>(null);
  const [playbackAccessError, setPlaybackAccessError] = useState<string | null>(null);
  const [playbackAccessRetryTick, setPlaybackAccessRetryTick] = useState(0);
  const vipFeeWaived = useMemo(() => {
    if (!viewerPubkey) return false;
    return feeWaiverVipPubkeys.some((pubkeyValue) => pubkeyValue.toLowerCase() === viewerPubkey);
  }, [feeWaiverVipPubkeys, viewerPubkey]);

  const [guildFeeWaiverMatches, setGuildFeeWaiverMatches] = useState<StreamGuildFeeWaiver[]>([]);
  const guildFeeWaived = guildFeeWaiverMatches.length > 0;

  useEffect(() => {
    if (!viewerPubkey || feeWaiverGuilds.length === 0) {
      setGuildFeeWaiverMatches([]);
      return;
    }

    const ownedGuildMatches = feeWaiverGuilds.filter((guild) => guild.guildPubkey.toLowerCase() === viewerPubkey);
    if (ownedGuildMatches.length > 0) {
      setGuildFeeWaiverMatches(ownedGuildMatches);
      return;
    }

    const guildTags = feeWaiverGuilds.map((guild) => makeGuildATag(guild.guildPubkey, guild.guildId));
    const membershipByGuild = new Map<string, { status: "joined" | "left"; createdAt: number }>();
    const roleByGuild = new Map<string, { role: "member" | "moderator" | "admin" | "none"; createdAt: number }>();

    const refreshMatches = () => {
      const matches: StreamGuildFeeWaiver[] = [];
      for (const guild of feeWaiverGuilds) {
        const key = makeGuildKey(guild.guildPubkey, guild.guildId);
        const membership = membershipByGuild.get(key);
        const role = roleByGuild.get(key);
        if (membership?.status === "joined") {
          matches.push(guild);
          continue;
        }
        if (role && role.role !== "none") {
          matches.push(guild);
        }
      }
      setGuildFeeWaiverMatches(matches);
    };

    const filters: Filter[] = [
      {
        kinds: [NOSTR_KINDS.GUILD_MEMBERSHIP],
        authors: [viewerPubkey],
        "#a": guildTags,
        since: nowSec() - 365 * 24 * 3600,
        limit: 1200
      },
      {
        kinds: [NOSTR_KINDS.GUILD_ROLE],
        "#p": [viewerPubkey],
        "#a": guildTags,
        since: nowSec() - 365 * 24 * 3600,
        limit: 1200
      }
    ];

    const sub = subscribeMany(relays, filters, {
      onevent: (event: any) => {
        const membership = parseGuildMembershipEvent(event);
        if (membership && membership.pubkey === viewerPubkey) {
          const key = makeGuildKey(membership.guildPubkey, membership.guildId);
          const previous = membershipByGuild.get(key);
          if (!previous || membership.createdAt > previous.createdAt) {
            membershipByGuild.set(key, { status: membership.status, createdAt: membership.createdAt });
            refreshMatches();
          }
          return;
        }

        const role = parseGuildRoleEvent(event);
        if (role && role.targetPubkey === viewerPubkey) {
          const key = makeGuildKey(role.guildPubkey, role.guildId);
          const previous = roleByGuild.get(key);
          if (!previous || role.createdAt > previous.createdAt) {
            roleByGuild.set(key, { role: role.role, createdAt: role.createdAt });
            refreshMatches();
          }
        }
      },
      oneose: () => refreshMatches()
    });

    const timeout = setTimeout(() => refreshMatches(), 4500);
    return () => {
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [feeWaiverGuilds, relays, viewerPubkey]);

  const stakeFeeWaived = vipFeeWaived || guildFeeWaived;
  const stakeWaiverReason = useMemo(() => {
    if (vipFeeWaived) return "VIP allowlist";
    if (guildFeeWaived) return "Guild allowlist";
    return null;
  }, [guildFeeWaived, vipFeeWaived]);

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
  const effectiveStakeRequiredAtomic = stakeFeeWaived ? null : stakeRequiredAtomic;

  useEffect(() => {
    setPlaybackAccessToken(null);
    setPlaybackAccessError(null);

    if (!originStreamId || !pubkey || !streamId || !announce?.raw) {
      setPlaybackAccessState("idle");
      return;
    }

    if (!privateStreamEnabled) {
      setPlaybackAccessState("ready");
      return;
    }

    if (!viewerPubkey) {
      setPlaybackAccessState("denied");
      setPlaybackAccessError("This stream is private. Connect your Nostr identity to request access.");
      return;
    }

    if (!viewerPrivateAllowed) {
      setPlaybackAccessState("denied");
      setPlaybackAccessError("This stream is private and your pubkey is not on the viewer allowlist.");
      return;
    }

    let cancelled = false;
    setPlaybackAccessState("issuing");

    void (async () => {
      try {
        const proofExpirySec = nowSec() + 15 * 60;
        const proofUnsigned = {
          kind: 27236,
          created_at: nowSec(),
          tags: [
            ["dstream", "watch_access"],
            ["stream", originStreamId],
            ["exp", String(proofExpirySec)]
          ],
          content: ""
        };
        const viewerProofEvent = await signEvent(proofUnsigned as any);

        const res = await fetch("/api/playback-access/issue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            streamPubkey: pubkey,
            streamId,
            originStreamId,
            announceEvent: announce.raw,
            viewerProofEvent
          })
        });
        if (!res.ok) {
          const message = (await res.text().catch(() => "")).trim();
          throw new Error(message || `Access request failed (${res.status}).`);
        }

        const data = (await res.json().catch(() => null)) as { token?: string } | null;
        const token = typeof data?.token === "string" ? data.token.trim() : "";
        if (!token) throw new Error("Access request succeeded, but no playback token was returned.");

        if (cancelled) return;
        setPlaybackAccessToken(token);
        setPlaybackAccessState("ready");
      } catch (err: any) {
        if (cancelled) return;
        setPlaybackAccessState("error");
        setPlaybackAccessError(err?.message ?? "Failed to request playback access for this private stream.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [announce?.raw, originStreamId, playbackAccessRetryTick, privateStreamEnabled, pubkey, signEvent, streamId, viewerPrivateAllowed, viewerPubkey]);

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
  const [reportTarget, setReportTarget] = useState<WatchReportTarget | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);

  const stakeSatisfied = useMemo(() => {
    if (!effectiveStakeRequiredAtomic) return true;
    if (!stakeStatus) return false;
    try {
      return BigInt(stakeStatus.confirmedAtomic) >= BigInt(effectiveStakeRequiredAtomic);
    } catch {
      return false;
    }
  }, [effectiveStakeRequiredAtomic, stakeStatus]);

  const ephemeralSignalIdentityRef = useRef<SignalIdentity | null>(null);
  const signalIdentity = useMemo<SignalIdentity | null>(() => {
    if (identity && nip04) {
      return {
        pubkey: identity.pubkey,
        signEvent,
        nip04
      };
    }
    if (effectiveStakeRequiredAtomic) return null;
    if (!ephemeralSignalIdentityRef.current) {
      try {
        ephemeralSignalIdentityRef.current = createLocalSignalIdentity();
      } catch {
        ephemeralSignalIdentityRef.current = null;
      }
    }
    return ephemeralSignalIdentityRef.current;
  }, [effectiveStakeRequiredAtomic, identity, nip04, signEvent]);
  const selfSignalPubkey = signalIdentity?.pubkey ?? null;
  const eligibleViewerPubkeys = useMemo(() => {
    let next = viewerPubkeys.filter((pk) => !social.isBlocked(pk));
    if (social.settings.p2pPeerMode === "trusted_only") {
      next = next.filter((pk) => pk === selfSignalPubkey || social.isTrusted(pk));
    }
    return next;
  }, [selfSignalPubkey, social.isBlocked, social.isTrusted, social.settings.p2pPeerMode, viewerPubkeys]);
  const activeViewerPubkeys = useMemo(() => {
    if (hostMode !== "p2p_economy") return [] as string[];
    return eligibleViewerPubkeys.slice(0, rebroadcastThreshold);
  }, [eligibleViewerPubkeys, hostMode, rebroadcastThreshold]);
  const queuedViewerPubkeys = useMemo(() => {
    if (hostMode !== "p2p_economy") return [] as string[];
    return eligibleViewerPubkeys.slice(rebroadcastThreshold);
  }, [eligibleViewerPubkeys, hostMode, rebroadcastThreshold]);
  const desiredPeerPubkeys = useMemo(() => {
    return activeViewerPubkeys.filter((pk) => pk !== selfSignalPubkey);
  }, [activeViewerPubkeys, selfSignalPubkey]);
  const selfQueuePosition = useMemo(() => {
    if (!selfSignalPubkey) return null;
    const index = queuedViewerPubkeys.indexOf(selfSignalPubkey);
    return index >= 0 ? index + 1 : null;
  }, [queuedViewerPubkeys, selfSignalPubkey]);
  const selfIsActiveRebroadcaster = useMemo(() => {
    if (!selfSignalPubkey) return false;
    return activeViewerPubkeys.includes(selfSignalPubkey);
  }, [activeViewerPubkeys, selfSignalPubkey]);
  const rawQueueStatusLabel = useMemo(() => {
    if (!selfSignalPubkey) return "Connect identity to track rebroadcast queue status.";
    if (selfIsActiveRebroadcaster) return "Queue status: ACTIVE rebroadcaster.";
    if (selfQueuePosition) return `Queue status: standby #${selfQueuePosition}.`;
    return "Queue status: not in active/standby set (enable presence to join FCFS queue).";
  }, [selfIsActiveRebroadcaster, selfQueuePosition, selfSignalPubkey]);
  const [queueStatusLabel, setQueueStatusLabel] = useState(rawQueueStatusLabel);
  const queueStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (queueStatusLabel === rawQueueStatusLabel) return;
    const nextIsActive = rawQueueStatusLabel.includes("ACTIVE rebroadcaster");
    const currentIsActive = queueStatusLabel.includes("ACTIVE rebroadcaster");
    const delayMs = currentIsActive && !nextIsActive ? 12000 : nextIsActive ? 350 : 900;
    if (queueStatusTimerRef.current) clearTimeout(queueStatusTimerRef.current);
    queueStatusTimerRef.current = setTimeout(() => {
      setQueueStatusLabel(rawQueueStatusLabel);
      queueStatusTimerRef.current = null;
    }, delayMs);
    return () => {
      if (queueStatusTimerRef.current) {
        clearTimeout(queueStatusTimerRef.current);
        queueStatusTimerRef.current = null;
      }
    };
  }, [queueStatusLabel, rawQueueStatusLabel]);
  useEffect(() => {
    return () => {
      if (queueStatusTimerRef.current) clearTimeout(queueStatusTimerRef.current);
    };
  }, []);
  const hostModeAllowsP2P = hostMode === "p2p_economy";

  const p2pAllowed = useMemo(() => {
    if (!hostModeAllowsP2P) return false;
    if (!signalIdentity) return false;
    if (!effectiveStakeRequiredAtomic) return true;
    return stakeSatisfied && !!identity && !!nip04;
  }, [effectiveStakeRequiredAtomic, hostModeAllowsP2P, identity, nip04, signalIdentity, stakeSatisfied]);

  const [p2pSwarm, setP2pSwarm] = useState<P2PSwarm | null>(null);
  const [p2pStats, setP2pStats] = useState<P2PSwarmStats | null>(null);

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
    p2pSwarm.setDesiredPeers(desiredPeerPubkeys);
  }, [desiredPeerPubkeys, p2pAllowed, p2pEnabled, p2pSwarm]);

  useEffect(() => {
    if (!p2pEnabled || !p2pAllowed || !p2pSwarm) return;
    const tick = () => setP2pStats(p2pSwarm.getStats());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [p2pAllowed, p2pEnabled, p2pSwarm]);

  const fallbackUrlBase = originStreamId ? `/api/hls/${originStreamId}/index.m3u8` : `/api/hls/${streamId}/index.m3u8`;
  const fallbackUrl = useMemo(
    () => appendPlaybackAccessToken(fallbackUrlBase, playbackAccessToken),
    [fallbackUrlBase, playbackAccessToken]
  );
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
      .filter((rendition) => rendition.id && isPlaybackUrl(rendition.url))
      .slice(0, 8);
  }, [announce?.renditions]);

  const renditionMasterUrl = useMemo(() => {
    if (renditionHints.length < 2) return null;
    const params = new URLSearchParams();
    renditionHints.forEach((rendition, index) => {
      params.set(`id${index}`, rendition.id);
      params.set(`u${index}`, appendPlaybackAccessToken(rendition.url, playbackAccessToken));
      if (rendition.bandwidth) params.set(`bw${index}`, String(rendition.bandwidth));
      if (rendition.width) params.set(`w${index}`, String(rendition.width));
      if (rendition.height) params.set(`h${index}`, String(rendition.height));
      if (rendition.codecs) params.set(`c${index}`, rendition.codecs);
    });
    return appendPlaybackAccessToken(`/api/hls-master?${params.toString()}`, playbackAccessToken);
  }, [playbackAccessToken, renditionHints]);

  const liveStreamUrl = useMemo(() => {
    if (e2eHlsOverride) return e2eHlsOverride;
    const streamingHint = announce?.streaming?.trim();
    if (privateStreamEnabled) {
      if (renditionMasterUrl) return renditionMasterUrl;
      return fallbackUrl;
    }
    if (renditionMasterUrl) return renditionMasterUrl;
    if (renditionHints[0]?.url) return appendPlaybackAccessToken(renditionHints[0].url, playbackAccessToken);
    if (isPlaybackUrl(streamingHint)) return streamingHint;
    return fallbackUrl;
  }, [announce?.streaming, e2eHlsOverride, fallbackUrl, playbackAccessToken, privateStreamEnabled, renditionHints, renditionMasterUrl]);

  const [vodRecordings, setVodRecordings] = useState<VodRecordingEntry[]>([]);
  const [vodLoading, setVodLoading] = useState(false);
  const [vodError, setVodError] = useState<string | null>(null);
  const [selectedVod, setSelectedVod] = useState<VodRecordingEntry | null>(null);

  useEffect(() => {
    setSelectedVod(null);
  }, [originStreamId, streamId]);

  useEffect(() => {
    if (!vodArchiveEnabled) {
      setSelectedVod(null);
    }
  }, [vodArchiveEnabled]);

  useEffect(() => {
    if (!originStreamId) {
      setVodRecordings([]);
      setVodLoading(false);
      setVodError(null);
      return;
    }
    if (!vodArchiveEnabled) {
      setVodRecordings([]);
      setVodLoading(false);
      setVodError(null);
      return;
    }

    let cancelled = false;
    setVodLoading(true);
    setVodError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/vod/list/${encodeURIComponent(originStreamId)}`, { cache: "no-store" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `VOD list failed (${res.status})`);
        }
        const data = (await res.json().catch(() => null)) as { ok?: boolean; files?: VodRecordingEntry[] } | null;
        const files = Array.isArray(data?.files)
          ? data.files.filter((entry) => !!entry && typeof entry.url === "string" && typeof entry.relativePath === "string")
          : [];
        if (cancelled) return;
        setVodRecordings(files);
      } catch (err: any) {
        if (cancelled) return;
        setVodRecordings([]);
        setVodError(err?.message ?? "Failed to load archived recordings.");
      } finally {
        if (!cancelled) setVodLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [originStreamId, vodArchiveEnabled]);

  const streamUrl = selectedVod?.url ?? liveStreamUrl;
  const isPlaybackLive = !selectedVod;
  const whepUrl = useMemo(() => {
    if (!isPlaybackLive || !originStreamId) return null;
    return appendPlaybackAccessToken(`/api/whep/${encodeURIComponent(originStreamId)}/whep`, playbackAccessToken);
  }, [isPlaybackLive, originStreamId, playbackAccessToken]);
  const playbackBlocked = privateStreamEnabled && playbackAccessState !== "ready";
  const playbackBlockedMessage = useMemo(() => {
    if (!privateStreamEnabled) return null;
    if (playbackAccessState === "issuing") return "Verifying private-stream access…";
    if (playbackAccessState === "denied") {
      return playbackAccessError ?? "This stream is private. Your pubkey is not currently allowlisted.";
    }
    if (playbackAccessState === "error") {
      return playbackAccessError ?? "Could not verify private-stream access.";
    }
    return null;
  }, [playbackAccessError, playbackAccessState, privateStreamEnabled]);

  const captionTracks = useMemo(() => {
    return (announce?.captions ?? [])
      .map((caption) => ({
        src: caption.url.trim(),
        lang: caption.lang.trim().toLowerCase(),
        label: caption.label.trim(),
        isDefault: !!caption.isDefault
      }))
      .filter((caption) => caption.src && caption.lang && caption.label && isPlaybackUrl(caption.src))
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
  const [paymentCopyKey, setPaymentCopyKey] = useState<string | null>(null);
  const [paymentCopyErrorKey, setPaymentCopyErrorKey] = useState<string | null>(null);
  const copyTipAddress = useCallback(async () => {
    setTipCopyStatus("idle");
    try {
      const address = xmrPaymentAddress?.trim();
      if (!address) return;
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(address);
      setTipCopyStatus("copied");
      setTimeout(() => setTipCopyStatus("idle"), 1200);
    } catch {
      setTipCopyStatus("error");
      setTimeout(() => setTipCopyStatus("idle"), 1800);
    }
  }, [xmrPaymentAddress]);

  const copyPaymentAddress = useCallback(async (key: string, address: string) => {
    setPaymentCopyKey(null);
    setPaymentCopyErrorKey(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(address);
      setPaymentCopyKey(key);
      setTimeout(() => setPaymentCopyKey((prev) => (prev === key ? null : prev)), 1200);
    } catch {
      setPaymentCopyErrorKey(key);
      setTimeout(() => setPaymentCopyErrorKey((prev) => (prev === key ? null : prev)), 1800);
    }
  }, []);

  const [verifiedTipCopyStatus, setVerifiedTipCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const needsXmrRpc = !!(xmrPaymentAddress || effectiveStakeRequiredAtomic);
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
    () => (effectiveStakeRequiredAtomic ? `${formatXmrAtomic(effectiveStakeRequiredAtomic)} XMR` : null),
    [effectiveStakeRequiredAtomic]
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
    if (!effectiveStakeRequiredAtomic) return;
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
  }, [effectiveStakeRequiredAtomic, makeNip98AuthHeader, pubkey, streamId, xmrRpcAvailable]);

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
    if (!hostModeAllowsP2P) return "Host policy: Host-Only mode (peer rebroadcast disabled).";
    if (!signalIdentity) return "P2P assist unavailable in this browser context.";
    if (!effectiveStakeRequiredAtomic || stakeSatisfied) return null;
    if (!identity || !nip04) return "Connect identity to enable stake-gated P2P assist.";
    if (!xmrRpcAvailable) return "Stake required, but Monero verification is unavailable (origin wallet RPC not configured).";
    if (!stake) return `Stake required: ${stakeRequiredXmr ?? "unknown amount"}. Get a stake address below.`;
    if (!stakeStatus) return `Stake required: ${stakeRequiredXmr ?? "unknown amount"} (confirmed). Send stake, then click Check.`;
    try {
      const required = BigInt(effectiveStakeRequiredAtomic);
      const confirmed = BigInt(stakeStatus.confirmedAtomic);
      const remaining = required > confirmed ? required - confirmed : 0n;
      if (remaining > 0n) {
        return `Stake required: ${stakeRequiredXmr ?? "unknown amount"} (confirmed). Confirmed so far: ${formatXmrAtomic(
          stakeStatus.confirmedAtomic
        )} XMR (need +${formatXmrAtomic(remaining.toString())} XMR).`;
      }
    } catch {
      // ignore
    }
    return `Stake required: ${stakeRequiredXmr ?? "unknown amount"} (confirmed).`;
  }, [
    effectiveStakeRequiredAtomic,
    hostModeAllowsP2P,
    identity,
    nip04,
    signalIdentity,
    stake,
    stakeRequiredXmr,
    stakeSatisfied,
    stakeStatus,
    xmrRpcAvailable
  ]);

  useEffect(() => {
    if (!effectiveStakeRequiredAtomic) return;
    if (stakeSatisfied) return;
    if (!p2pEnabled) return;
    social.updateSettings({ p2pAssistEnabled: false });
  }, [effectiveStakeRequiredAtomic, p2pEnabled, social.updateSettings, stakeSatisfied]);

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

  const closeReportDialog = () => {
    if (reportBusy) return;
    setReportTarget(null);
    setReportError(null);
  };

  const submitWatchReport = async (input: { reasonCode: ReportReasonCode; note: string }) => {
    if (!reportTarget) return;
    setReportBusy(true);
    setReportError(null);
    try {
      const streamScope = pubkey ? `${pubkey}--${streamId}` : streamId;
      const proof = await buildSignedScopeProof(signEvent as any, identity?.pubkey ?? null, "report_submit", [["stream", streamScope]]);
      await submitModerationReport({
        report: {
          reasonCode: input.reasonCode,
          note: input.note,
          reporterPubkey: identity?.pubkey ?? undefined,
          targetType: reportTarget.targetType,
          targetPubkey: reportTarget.targetPubkey,
          targetStreamId: reportTarget.targetStreamId,
          contextPage: "watch",
          contextUrl: typeof window !== "undefined" ? window.location.href : undefined
        },
        reporterProofEvent: proof
      });
      setReportTarget(null);
      setReportNotice("Report submitted. Operators can review it in Moderation.");
      setTimeout(() => {
        setReportNotice((current) => (current === "Report submitted. Operators can review it in Moderation." ? null : current));
      }, 3500);
    } catch (error: any) {
      setReportError(error?.message ?? "Failed to submit report.");
    } finally {
      setReportBusy(false);
    }
  };

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
            {pubkey && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setReportError(null);
                    setReportTarget({
                      targetType: "stream",
                      targetPubkey: pubkey,
                      targetStreamId: streamId,
                      summary: `Report stream ${announce?.title ?? streamId}`
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
                  title="Report stream"
                  aria-label="Report stream"
                >
                  <Flag className="w-3.5 h-3.5" />
                  Stream
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const npubLabel = npub ?? pubkey;
                    setReportError(null);
                    setReportTarget({
                      targetType: "user",
                      targetPubkey: pubkey,
                      targetStreamId: streamId,
                      summary: `Report creator ${shortenText(npubLabel, { head: 14, tail: 8 })}`
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
                  title="Report creator"
                  aria-label="Report creator"
                >
                  <Flag className="w-3.5 h-3.5" />
                  Creator
                </button>
              </>
            )}
            <Link className="text-sm text-neutral-300 hover:text-white" href="/browse">
              Back to Browse
            </Link>
          </div>
        </header>

        {reportNotice ? (
          <div className="mb-6 rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">{reportNotice}</div>
        ) : null}
        {announce?.matureContent ? (
          <div className="mb-6 rounded-xl border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
            Mature-content label set by streamer. Viewer discretion is advised.
          </div>
        ) : null}

        {pubkey && (
          <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
            <div className="text-sm text-neutral-200 space-y-1">
              <div>
                <span className="text-neutral-400">Viewers</span> <span className="font-mono">≈ {viewerCount}</span>
                <span className="ml-2 text-xs text-neutral-500">presence (approx)</span>
              </div>
              <div className="text-xs text-neutral-500">
                Host mode:{" "}
                <span className="text-neutral-300">
                  {hostMode === "host_only" ? "Host-Only" : `P2P Economy (T=${rebroadcastThreshold})`}
                </span>
                {hostMode === "p2p_economy" && (
                  <span className="ml-2 text-neutral-500">
                    active {activeViewerPubkeys.length} · queued {queuedViewerPubkeys.length}
                  </span>
                )}
              </div>
              {stakeRequiredAtomic && stakeFeeWaived && (
                <div className="text-xs text-emerald-300">
                  Stake waived for this viewer ({stakeWaiverReason ?? "allowlist"}).
                </div>
              )}
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
                {hostMode === "p2p_economy" && (
                  <span className="w-full text-[11px] text-neutral-500">
                    {queueStatusLabel}
                  </span>
                )}
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
                  <span
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
              {p2pStats?.requestsToPeers ?? 0} · evictions: {p2pStats?.evictedPeers ?? 0}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {playbackBlocked ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-3">
                <div className="text-sm font-semibold text-amber-200">Private stream access required</div>
                <div className="text-sm text-amber-100/90">{playbackBlockedMessage ?? "Checking private-stream access…"}</div>
                {playbackAccessState === "denied" && !viewerPubkey && (
                  <div className="text-xs text-amber-200/80">
                    Connect identity in dStream, then reload this watch page to request access.
                  </div>
                )}
                {playbackAccessState === "error" && (
                  <button
                    type="button"
                    onClick={() => {
                      setPlaybackAccessRetryTick((value) => value + 1);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs text-amber-100"
                  >
                    Retry access check
                  </button>
                )}
              </div>
            ) : (
              <Player
                src={streamUrl}
                fallbackSrc={isPlaybackLive ? fallbackUrl : null}
                whepSrc={whepUrl}
                p2pSwarm={p2pSwarm}
                integrity={integritySession}
                isLiveStream={isPlaybackLive && announce?.status !== "ended"}
                showTimelineControls={vodArchiveEnabled}
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
              {selectedVod ? (
                <div className="mt-3 text-xs text-amber-300">
                  Playing archived recording: <span className="font-mono text-amber-200">{selectedVod.name}</span>
                </div>
              ) : (
                <div className="mt-3 text-xs text-emerald-300">Playing live stream path.</div>
              )}
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Archived Broadcasts (VOD)</div>
                {!isPlaybackLive && (
                  <button
                    type="button"
                    onClick={() => setSelectedVod(null)}
                    className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
                  >
                    Back to live
                  </button>
                )}
              </div>

              {!vodArchiveEnabled ? (
                <div className="text-xs text-neutral-500">
                  Broadcaster disabled VOD archive and DVR controls for this stream.
                </div>
              ) : vodLoading ? (
                <div className="text-xs text-neutral-500">Loading archive list…</div>
              ) : vodError ? (
                <div className="text-xs text-red-300">{vodError}</div>
              ) : vodRecordings.length === 0 ? (
                <div className="text-xs text-neutral-500">
                  No archived files yet. Recording starts when origin receives a live publish and writes to `/recordings`.
                </div>
              ) : (
                <div className="space-y-2">
                  {vodRecordings.slice(0, 30).map((entry) => {
                    const selected = selectedVod?.relativePath === entry.relativePath;
                    return (
                      <div
                        key={entry.relativePath}
                        className={`rounded-xl border px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ${
                          selected ? "border-blue-500/50 bg-blue-950/20" : "border-neutral-800 bg-neutral-950/40"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-200 font-mono truncate">{entry.name}</div>
                          <div className="text-[11px] text-neutral-500">
                            {new Date(entry.modifiedAtMs).toLocaleString()} · {formatBytesCompact(entry.sizeBytes)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedVod(entry)}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
                          >
                            {selected ? "Playing" : "Play"}
                          </button>
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-1"
                          >
                            Open file
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {payoutAssets.length > 0 && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Wallet usage for this stream</div>
                <ol className="list-decimal pl-5 text-xs text-neutral-300 space-y-1.5">
                  <li>Only assets configured by this streamer are shown below.</li>
                  <li>Asset order is automatic: preferred wallet matches first, then defaults (XMR → BTC → ...).</li>
                  <li>If URI cannot open, paste copied address directly into your wallet app or CLI wallet.</li>
                  <li>For verified Monero tips/stake, use generated session subaddresses and re-check status in this page.</li>
                </ol>
                {autoSelectedPayoutAsset && (
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3 text-xs text-neutral-400">
                    Default payment rail for this stream:{" "}
                    <span className="text-neutral-200 font-semibold">{PAYMENT_ASSET_META[autoSelectedPayoutAsset].symbol}</span>
                  </div>
                )}
                {preferredWalletsForPayoutAssets.length > 0 && (
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3 text-xs text-neutral-400">
                    Preferred wallets in this browser:{" "}
                    <span className="text-neutral-300">
                      {preferredWalletsForPayoutAssets
                        .map(({ asset, wallet }) => `${PAYMENT_ASSET_META[asset].symbol}→${wallet.name}`)
                        .join(" · ")}
                    </span>
                  </div>
                )}
                <div className="text-xs text-neutral-500">
                  Configure defaults at{" "}
                  <Link href="/settings#wallet-integrations" className="text-blue-300 hover:text-blue-200">
                    Settings → Wallet Integrations
                  </Link>
                  .
                </div>
              </div>
            )}

            {stakeRequiredAtomic && stakeFeeWaived && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                Stake requirement ({formatXmrAtomic(stakeRequiredAtomic)} XMR) is waived for this viewer via{" "}
                <span className="font-semibold">{stakeWaiverReason ?? "allowlist"}</span>.
              </div>
            )}

            {stakeRequiredAtomic && !stakeFeeWaived && (
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
                            {formatXmrAtomic(stakeStatus.confirmedAtomic)} XMR
                          </span>{" "}
                          / Required{" "}
                          <span className="font-mono text-neutral-200">{formatXmrAtomic(stakeRequiredAtomic)} XMR</span>{" "}
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
                            <span className="font-mono">{formatXmrAtomic(stakeRefundResult.amountAtomic)} XMR</span>
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

            {xmrPaymentAddress && (
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
                <div className="text-sm text-neutral-200 font-mono break-all">{xmrPaymentAddress}</div>
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
                                {verifiedTipStatus.amountAtomic ? `${formatXmrAtomic(verifiedTipStatus.amountAtomic)} XMR` : "a tip"}
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

            {orderedNonXmrPayments.length > 0 && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Additional payment methods (streamer-configured)</div>
                <div className="space-y-3">
                  {orderedNonXmrPayments.map((method, index) => {
                    const key = `${method.asset}:${method.address}:${method.network ?? ""}:${index}`;
                    const uri = buildPaymentUri(method);
                    const preferredWalletId = social.settings.paymentDefaults.preferredWalletByAsset[method.asset];
                    const preferredWallet = getWalletIntegrationById(preferredWalletId);
                    const wallets = getWalletIntegrationsForAsset(method.asset);
                    return (
                      <div key={key} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-neutral-400 uppercase font-bold tracking-wider">{assetLabel(method.asset)}</div>
                          <button
                            type="button"
                            onClick={() => void copyPaymentAddress(key, method.address)}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
                          >
                            <Copy className="w-4 h-4" />
                            {paymentCopyKey === key ? "Copied" : paymentCopyErrorKey === key ? "Error" : "Copy"}
                          </button>
                        </div>
                        <div className="text-sm text-neutral-200 font-mono break-all">{method.address}</div>
                        <div className="text-xs text-neutral-500">
                          {method.network ? `Network: ${method.network}` : "Network: default"} {method.label ? `· ${method.label}` : ""}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {uri ? (
                            <a
                              href={uri}
                              className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 inline-flex items-center gap-2"
                            >
                              Open Wallet URI <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <span className="text-neutral-500">Wallet URI unavailable for this asset.</span>
                          )}
                          {preferredWallet ? (
                            <a href={preferredWallet.website} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200">
                              Preferred wallet: {preferredWallet.name}
                            </a>
                          ) : wallets.length > 0 ? (
                            <span className="text-neutral-500">
                              Compatible: {wallets.slice(0, 3).map((wallet) => wallet.name).join(", ")}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="h-[70vh] lg:h-auto">
            {playbackBlocked ? (
              <div className="h-full rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-400">
                Chat is available after private-stream access is granted.
              </div>
            ) : (
              <ChatBox
                streamPubkey={pubkey ?? ""}
                streamId={streamId}
                slowModeSec={chatSlowModeSec}
                subscriberOnly={chatSubscriberOnly}
                followerOnly={chatFollowerOnly}
                onMessageCountChange={(count) => {
                  if (!e2e || e2eSentRef.current.chat) return;
                  if (count <= 0) return;
                  e2eSentRef.current.chat = true;
                  postE2E({ type: "dstream:e2e", t: "watch_chat_ready", streamPubkey: pubkey ?? "", streamId });
                }}
              />
            )}
          </div>
        </div>

        <ReportDialog
          open={!!reportTarget}
          busy={reportBusy}
          title="Report Content"
          targetSummary={reportTarget?.summary ?? ""}
          error={reportError}
          onClose={closeReportDialog}
          onSubmit={submitWatchReport}
        />
      </main>
    </div>
  );
}
