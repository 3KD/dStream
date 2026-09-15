"use client";

import { Users, ArrowDownToLine, Bell, BellOff, Bitcoin } from "lucide-react";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StreamPaymentMethod } from "@dstream/protocol";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useStreamModeration } from "@/hooks/useStreamModeration";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { parseChatCommand } from "@/lib/chatCommands";
import { STREAM_CHAT_CLEAR_REASON } from "@/lib/chatModeration";
import {
  collectNewChatNotificationMessages,
  readChatNotificationSoundPreference,
  writeChatNotificationSoundPreference
} from "@/lib/chatNotificationSound";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { buildSignedScopeProof, submitModerationReport } from "@/lib/moderation/reportClient";
import { useNostrProfile, useNostrProfiles } from "@/hooks/useNostrProfiles";
import { useEmotes } from "@/hooks/useEmotes";
import { getNip05Policy } from "@/lib/config";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import { UnifiedTipDialog as TipDialog } from "./UnifiedTipDialog";
import type { ReportReasonCode, ReportTargetType } from "@/lib/moderation/reportTypes";

interface ChatReportTarget {
  type: ReportTargetType;
  targetPubkey: string;
  targetStreamId: string;
  targetMessageId?: string;
  targetMessagePreview?: string;
  summary: string;
}

const CHAT_RENDER_BATCH_SIZE = 60;

export function ChatBox({
  streamPubkey,
  streamId,
  viewerCount,
  slowModeSec,
  subscriberOnly,
  followerOnly,
  clearWindowRequestNonce,
  onClearWindowRequestHandled,
  onMessageCountChange,
  headerRightSlot,
  paymentMethods,
  draftStorageKey,
  liveDataEnabled = true,
  className
}: {
  streamPubkey: string;
  streamId: string;
  viewerCount?: number;
  slowModeSec?: number;
  subscriberOnly?: boolean;
  followerOnly?: boolean;
  clearWindowRequestNonce?: number;
  onClearWindowRequestHandled?: (ok: boolean) => void;
  onMessageCountChange?: (count: number) => void;
  headerRightSlot?: ReactNode;
  paymentMethods?: StreamPaymentMethod[];
  draftStorageKey?: string;
  liveDataEnabled?: boolean;
  className?: string;
}) {
  const { identity, ensureIdentity, signEvent } = useIdentity();
  const social = useSocial();
  const { messages, isConnected, sendMessage, sendWhisper, canSend, canWhisper } = useStreamChat({
    streamPubkey,
    streamId,
    enabled: liveDataEnabled
  });
  const globalEmotesMap = useEmotes(liveDataEnabled ? [streamPubkey, identity?.pubkey] : []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerScrollRef = useRef<HTMLDivElement>(null);
  const nip05Policy = useMemo(() => getNip05Policy(), []);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [moderationBusyByPubkey, setModerationBusyByPubkey] = useState<Record<string, boolean>>({});
  const [roleBusyByPubkey, setRoleBusyByPubkey] = useState<Record<string, boolean>>({});
  const [subscriberBusyByPubkey, setSubscriberBusyByPubkey] = useState<Record<string, boolean>>({});
  const [reportTarget, setReportTarget] = useState<ChatReportTarget | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [localChatClearedAt, setLocalChatClearedAt] = useState<number | null>(null);
  const [composerDraft, setComposerDraft] = useState("");
  const [composerDraftVersion, setComposerDraftVersion] = useState(0);
  const [tipDialogOpen, setTipDialogOpen] = useState(false);
  const [chatNotificationSoundEnabled, setChatNotificationSoundEnabled] = useState<boolean | null>(null);
  const [visibleHistoryLimit, setVisibleHistoryLimit] = useState(CHAT_RENDER_BATCH_SIZE);

  const lastMessageSentAtRef = useRef<number>(0);
  const clearRequestSeenRef = useRef<number>(0);
  const chatNotificationSeenIdsRef = useRef<Set<string>>(new Set());
  const chatNotificationActiveSinceRef = useRef(Date.now());
  const chatNotificationAudioContextRef = useRef<AudioContext | null>(null);
  const lastChatNotificationSoundAtRef = useRef(0);

  const moderation = useStreamModeration({
    streamPubkey: liveDataEnabled ? streamPubkey : "",
    streamId: liveDataEnabled ? streamId : "",
    identityPubkey: identity?.pubkey ?? null,
    signEvent
  });

  const selfProfile = useNostrProfile(liveDataEnabled ? identity?.pubkey ?? null : null);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(new Set());
  const isOwner = !!(identity && identity.pubkey === streamPubkey);
  const viewerPubkey = identity?.pubkey?.toLowerCase() ?? null;
  const isViewerModerator = !!(viewerPubkey && moderation.moderators.has(viewerPubkey));
  const isViewerSubscriber = !!(viewerPubkey && moderation.subscribers.has(viewerPubkey));
  const isViewerFollower = !!(viewerPubkey && social.isFavoriteCreator(streamPubkey));
  const bypassChatPolicy = isOwner || isViewerModerator;
  const resolvedSlowModeSec = Number.isInteger(slowModeSec) && (slowModeSec ?? 0) > 0 ? (slowModeSec as number) : 0;
  const slowModeEnabled = resolvedSlowModeSec > 0 && !bypassChatPolicy;
  const chatPolicyBlockReason = useMemo(() => {
    if (!identity) return null;
    if (subscriberOnly && !bypassChatPolicy && !isViewerSubscriber) {
      return "Subscriber-only chat is enabled for this stream.";
    }
    if (followerOnly && !bypassChatPolicy && !isViewerFollower) {
      return "Follower-only chat is enabled. Favorite this creator to chat.";
    }
    return null;
  }, [bypassChatPolicy, followerOnly, identity, isViewerFollower, isViewerSubscriber, subscriberOnly]);
  const nip05GateSatisfied = nip05Policy !== "require" || selfProfile?.nip05Verified === true;
  const canModerate = moderation.canModerate && nip05GateSatisfied;
  const canManageRoles = isOwner && nip05GateSatisfied;
  const effectiveChatClearedAt = useMemo(
    () => Math.max(localChatClearedAt ?? 0, moderation.streamChatClearedAt ?? 0),
    [localChatClearedAt, moderation.streamChatClearedAt]
  );

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message) =>
          message.createdAt > effectiveChatClearedAt &&
          !hiddenMessageIds.has(message.id as string) &&
          !social.isMuted(message.pubkey) &&
          !social.isBlocked(message.pubkey) &&
          !moderation.remoteMuted.has(message.pubkey) &&
          !moderation.remoteBlocked.has(message.pubkey)
      ),
    [effectiveChatClearedAt, hiddenMessageIds, messages, moderation.remoteBlocked, moderation.remoteMuted, social]
  );

  const renderedMessages = useMemo(
    () => visibleMessages.slice(-visibleHistoryLimit),
    [visibleHistoryLimit, visibleMessages]
  );
  const olderMessageCount = visibleMessages.length - renderedMessages.length;
  const hiddenCount = messages.length - visibleMessages.length;
  const normalizedViewerCount = typeof viewerCount === "number" && Number.isFinite(viewerCount) ? Math.max(0, viewerCount) : 0;
  const visiblePubkeys = useMemo(() => renderedMessages.map((message) => message.pubkey), [renderedMessages]);
  const profilesByPubkey = useNostrProfiles(liveDataEnabled ? visiblePubkeys : []);

  const [isAutoScroll, setIsAutoScroll] = useState(true);

  const getChatNotificationAudioContext = useCallback(async (): Promise<AudioContext | null> => {
    if (typeof window === "undefined") return null;
    const AudioContextClass = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    let audioContext = chatNotificationAudioContextRef.current;
    if (!audioContext || audioContext.state === "closed") {
      audioContext = new AudioContextClass();
      chatNotificationAudioContextRef.current = audioContext;
    }
    if (audioContext.state === "suspended") {
      try {
        await audioContext.resume();
      } catch {
        return null;
      }
    }
    return audioContext.state === "running" ? audioContext : null;
  }, []);

  const playChatNotificationSound = useCallback(async () => {
    const audioContext = await getChatNotificationAudioContext();
    if (!audioContext) return;

    const startAt = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(1_040, startAt + 0.09);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.055, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.19);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      gain.disconnect();
    });
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.2);
  }, [getChatNotificationAudioContext]);

  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = typeof window === "undefined" ? null : window.localStorage;
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    setChatNotificationSoundEnabled(readChatNotificationSoundPreference(storage));
  }, []);

  useEffect(() => {
    chatNotificationSeenIdsRef.current.clear();
    chatNotificationActiveSinceRef.current = Date.now();
    lastChatNotificationSoundAtRef.current = 0;
    setVisibleHistoryLimit(CHAT_RENDER_BATCH_SIZE);
  }, [streamId, streamPubkey]);

  useEffect(() => {
    const incomingMessages = collectNewChatNotificationMessages({
      messages: visibleMessages,
      seenIds: chatNotificationSeenIdsRef.current,
      viewerPubkey,
      activeSinceMs: chatNotificationActiveSinceRef.current
    });
    if (chatNotificationSoundEnabled !== true || incomingMessages.length === 0) return;

    const now = Date.now();
    if (now - lastChatNotificationSoundAtRef.current < 250) return;
    lastChatNotificationSoundAtRef.current = now;
    void playChatNotificationSound();
  }, [chatNotificationSoundEnabled, playChatNotificationSound, viewerPubkey, visibleMessages]);

  useEffect(() => {
    if (chatNotificationSoundEnabled !== true || typeof window === "undefined") return;
    const unlockAudio = () => void getChatNotificationAudioContext();
    window.addEventListener("pointerdown", unlockAudio, { capture: true, once: true });
    window.addEventListener("keydown", unlockAudio, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio, true);
      window.removeEventListener("keydown", unlockAudio, true);
    };
  }, [chatNotificationSoundEnabled, getChatNotificationAudioContext]);

  useEffect(
    () => () => {
      const audioContext = chatNotificationAudioContextRef.current;
      chatNotificationAudioContextRef.current = null;
      if (audioContext && audioContext.state !== "closed") void audioContext.close();
    },
    []
  );

  const toggleChatNotificationSound = useCallback(() => {
    const enabled = chatNotificationSoundEnabled !== true;
    let storage: Storage | null = null;
    try {
      storage = typeof window === "undefined" ? null : window.localStorage;
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    writeChatNotificationSoundPreference(storage, enabled);
    setChatNotificationSoundEnabled(enabled);
    if (enabled) void playChatNotificationSound();
  }, [chatNotificationSoundEnabled, playChatNotificationSound]);

  useEffect(() => {
    if (!scrollRef.current || !innerScrollRef.current) return;
    const scrollElement = scrollRef.current;
    const observer = new ResizeObserver(() => {
      if (isAutoScroll) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    });
    observer.observe(scrollElement);
    observer.observe(innerScrollRef.current);
    return () => observer.disconnect();
  }, [isAutoScroll]);

  // Execute synchronously on React re-render queueing to cover gaps where DOM resize doesn't trigger gracefully
  useEffect(() => {
    if (!scrollRef.current || !isAutoScroll) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visibleMessages.length, isAutoScroll]);

  useEffect(() => {
    try {
      onMessageCountChange?.(visibleMessages.length);
    } catch {
      // ignore
    }
  }, [onMessageCountChange, visibleMessages.length]);

  const setModerationBusy = useCallback((targetPubkey: string, busy: boolean) => {
    setModerationBusyByPubkey((prev) => ({ ...prev, [targetPubkey]: busy }));
  }, []);

  const setRoleBusy = useCallback((targetPubkey: string, busy: boolean) => {
    setRoleBusyByPubkey((prev) => ({ ...prev, [targetPubkey]: busy }));
  }, []);

  const setSubscriberBusy = useCallback((targetPubkey: string, busy: boolean) => {
    setSubscriberBusyByPubkey((prev) => ({ ...prev, [targetPubkey]: busy }));
  }, []);

  const handleModerationAction = useCallback(
    async (targetPubkey: string, action: "mute" | "block" | "clear") => {
      if (!canModerate) return;
      setModerationError(null);
      setModerationBusy(targetPubkey, true);

      if (action === "mute") {
        social.removeBlocked(targetPubkey);
        social.addMuted(targetPubkey);
      } else if (action === "block") {
        social.removeMuted(targetPubkey);
        social.addBlocked(targetPubkey);
      } else {
        social.removeMuted(targetPubkey);
        social.removeBlocked(targetPubkey);
      }

      const ok = await moderation.publishModerationAction(targetPubkey, action);
      if (!ok) {
        setModerationError("Failed to publish moderation action to relays.");
      }
      setModerationBusy(targetPubkey, false);
    },
    [canModerate, moderation, setModerationBusy, social]
  );

  const handleToggleModerator = useCallback(
    async (targetPubkey: string) => {
      if (!canManageRoles) return;
      const currentlyModerator = moderation.moderators.has(targetPubkey);
      const nextRole = currentlyModerator ? "none" : "moderator";
      setModerationError(null);
      setRoleBusy(targetPubkey, true);
      const ok = await moderation.publishModeratorRole(targetPubkey, nextRole);
      if (!ok) {
        setModerationError("Failed to publish moderator role update.");
      }
      setRoleBusy(targetPubkey, false);
    },
    [canManageRoles, moderation, setRoleBusy]
  );

  const handleToggleSubscriber = useCallback(
    async (targetPubkey: string) => {
      if (!canManageRoles) return;
      const currentlySubscriber = moderation.subscribers.has(targetPubkey);
      const nextRole = currentlySubscriber ? "none" : "subscriber";
      setModerationError(null);
      setSubscriberBusy(targetPubkey, true);
      const ok = await moderation.publishModeratorRole(targetPubkey, nextRole);
      if (!ok) {
        setModerationError("Failed to publish subscriber role update.");
      }
      setSubscriberBusy(targetPubkey, false);
    },
    [canManageRoles, moderation, setSubscriberBusy]
  );

  const showNotice = useCallback((value: string) => {
    setCommandNotice(value);
    setTimeout(() => {
      setCommandNotice((current) => (current === value ? null : current));
    }, 3000);
  }, []);

  const ensureChatIdentity = useCallback(() => {
    if (!identity) ensureIdentity();
  }, [ensureIdentity, identity]);

  const seedComposerDraft = useCallback(
    (value: string, notice?: string) => {
      setComposerDraft(value);
      setComposerDraftVersion((current) => current + 1);
      if (notice) showNotice(notice);
    },
    [showNotice]
  );

  const clearChatWindow = useCallback(async (): Promise<boolean> => {
    if (!canModerate) return false;
    setModerationError(null);
    const ok = await moderation.publishModerationAction(streamPubkey, "clear", STREAM_CHAT_CLEAR_REASON);
    if (!ok) {
      setModerationError("Failed to clear chat on relays.");
      return false;
    }
    setLocalChatClearedAt(Math.floor(Date.now() / 1000));
    showNotice("Chat window cleared.");
    return true;
  }, [canModerate, moderation, showNotice, streamPubkey]);

  useEffect(() => {
    if (!moderation.streamChatClearedAt) return;
    setLocalChatClearedAt((prev) => Math.max(prev ?? 0, moderation.streamChatClearedAt ?? 0));
  }, [moderation.streamChatClearedAt]);

  useEffect(() => {
    const requestNonce = clearWindowRequestNonce ?? 0;
    if (requestNonce <= 0) return;
    if (requestNonce === clearRequestSeenRef.current) return;
    clearRequestSeenRef.current = requestNonce;
    void (async () => {
      const ok = await clearChatWindow();
      onClearWindowRequestHandled?.(ok);
    })();
  }, [clearWindowRequestNonce, clearChatWindow, onClearWindowRequestHandled]);

  const closeReportDialog = useCallback(() => {
    if (reportBusy) return;
    setReportTarget(null);
    setReportError(null);
  }, [reportBusy]);

  const handleSubmitReport = useCallback(
    async (input: { reasonCode: ReportReasonCode; note: string }) => {
      if (!reportTarget) return;
      setReportBusy(true);
      setReportError(null);
      try {
        const proof = await buildSignedScopeProof(signEvent as any, identity?.pubkey ?? null, "report_submit", [["stream", `${streamPubkey}--${streamId}`]]);
        await submitModerationReport({
          report: {
            reasonCode: input.reasonCode,
            note: input.note,
            reporterPubkey: identity?.pubkey ?? undefined,
            targetType: reportTarget.type,
            targetPubkey: reportTarget.targetPubkey,
            targetStreamId: reportTarget.targetStreamId,
            targetMessageId: reportTarget.targetMessageId,
            targetMessagePreview: reportTarget.targetMessagePreview,
            contextPage: "watch_chat",
            contextUrl: typeof window !== "undefined" ? window.location.href : undefined
          },
          reporterProofEvent: proof
        });
        
        if (reportTarget.type === "message" && reportTarget.targetMessageId) {
            setHiddenMessageIds(prev => {
                const next = new Set(prev);
                next.add(reportTarget.targetMessageId as string);
                return next;
            });
        }
        
      } catch (error: any) {
        setReportError(error?.message ?? "Failed to submit report.");
        throw error;
      } finally {
        setReportBusy(false);
      }
    },
    [identity?.pubkey, reportTarget, signEvent, streamId, streamPubkey]
  );

  const handleSendInput = useCallback(
    async (input: string) => {
      setIsAutoScroll(true);
      if (scrollRef.current) {
        setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 0);
      }

      if (chatPolicyBlockReason) {
        showNotice(chatPolicyBlockReason);
        return false;
      }
      if (slowModeEnabled) {
        const elapsedSec = (Date.now() - lastMessageSentAtRef.current) / 1000;
        if (elapsedSec < resolvedSlowModeSec) {
          showNotice(`Slow mode: wait ${Math.ceil(resolvedSlowModeSec - elapsedSec)}s.`);
          return false;
        }
      }

      const parsed = parseChatCommand(input);
      if (!parsed) {
        const ok = await sendMessage(input);
        if (!ok) {
          showNotice("Failed to publish chat message to relays. Check relay connectivity in Settings → Nostr relays.");
        }
        if (ok && slowModeEnabled) lastMessageSentAtRef.current = Date.now();
        return ok;
      }
      if (!parsed.ok) {
        showNotice(parsed.error);
        return false;
      }

      const command = parsed.command;
      if (command.type === "help") {
        showNotice("Commands: /name, /mute, /unmute, /ban, /unban, /w, /wh(user1,user2)");
        return true;
      }

      if (command.type === "set_alias") {
        const res = social.setAlias(command.targetPubkey, command.alias);
        showNotice(res.ok ? `Alias saved for ${pubkeyHexToNpub(command.targetPubkey) ?? command.targetPubkey}` : res.error);
        return res.ok;
      }

      if (command.type === "whisper") {
        if (!canWhisper) {
          showNotice("Whispers require an identity with NIP-04 support.");
          return false;
        }
        const observers = [streamPubkey, ...Array.from(moderation.moderators)];
        const ok = await sendWhisper({
          recipients: command.recipients,
          content: command.message,
          observerPubkeys: observers
        });
        if (ok && slowModeEnabled) lastMessageSentAtRef.current = Date.now();
        if (!ok) showNotice("Failed to send whisper.");
        return ok;
      }

      const target = command.targetPubkey;

      if (command.type === "mute") {
        social.removeBlocked(target);
        social.addMuted(target);
        if (canModerate) {
          const ok = await moderation.publishModerationAction(target, "mute");
          if (!ok) showNotice("Muted locally, but failed to publish relay moderation action.");
          else showNotice("Muted.");
          return ok;
        }
        showNotice("Muted locally.");
        return true;
      }

      if (command.type === "unmute") {
        social.removeMuted(target);
        if (canModerate) {
          const ok = await moderation.publishModerationAction(target, "clear");
          if (!ok) showNotice("Unmuted locally, but failed to publish relay moderation clear.");
          else showNotice("Mute cleared.");
          return ok;
        }
        showNotice("Unmuted locally.");
        return true;
      }

      if (command.type === "ban") {
        social.removeMuted(target);
        social.addBlocked(target);
        if (canModerate) {
          const ok = await moderation.publishModerationAction(target, "block");
          if (!ok) showNotice("Blocked locally, but failed to publish relay moderation action.");
          else showNotice("Blocked.");
          return ok;
        }
        showNotice("Blocked locally.");
        return true;
      }

      social.removeBlocked(target);
      social.removeMuted(target);
      if (canModerate) {
        const ok = await moderation.publishModerationAction(target, "clear");
        if (!ok) showNotice("Unblocked locally, but failed to publish relay moderation clear.");
        else showNotice("Block cleared.");
        return ok;
      }
      showNotice("Unblocked locally.");
      return true;
    },
    [
      canModerate,
      canWhisper,
      chatPolicyBlockReason,
      moderation,
      resolvedSlowModeSec,
      sendMessage,
      sendWhisper,
      showNotice,
      slowModeEnabled,
      social,
      streamPubkey
    ]
  );

  return (
    <div className={`flex flex-col h-full min-h-0 bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden ${className ?? ""}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">Chat</span>
          {isConnected && <span className="w-2 h-2 bg-green-500 rounded-full" title="Connected" />}
          {normalizedViewerCount > 0 ? (
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-neutral-400">
              <Users className="w-3.5 h-3.5" />
              {normalizedViewerCount}
            </span>
          ) : null}
          {liveDataEnabled && !isConnected && moderation.isLoading && (
            <span className="text-[10px] text-neutral-500">syncing moderation…</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {headerRightSlot}
          <button
            type="button"
            onClick={toggleChatNotificationSound}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
            aria-label={chatNotificationSoundEnabled === true ? "Mute chat notifications" : "Enable chat sound notifications"}
            aria-pressed={chatNotificationSoundEnabled === true}
            title={chatNotificationSoundEnabled === true ? "Mute chat notifications" : "Enable chat sound notifications"}
          >
            {chatNotificationSoundEnabled === true ? (
              <Bell className="h-4 w-4" aria-hidden="true" />
            ) : (
              <BellOff className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setTipDialogOpen(true)}
            className="flex items-center justify-center gap-1.5 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 hover:text-orange-400 text-neutral-300 rounded-lg text-xs font-bold transition-all"
            title="Support Creator (Lightning/XMR)"
          >
            <Bitcoin className="w-3.5 h-3.5 text-orange-500" /> Support / Tip
          </button>
          <span className="text-xs text-neutral-500 hidden sm:inline-block">
            {visibleMessages.length} msgs{hiddenCount > 0 ? ` (+${hiddenCount} hidden)` : ""}
          </span>
        </div>
      </div>
      {moderationError && <div className="px-3 py-2 text-xs text-red-300 border-b border-neutral-800 bg-red-950/20">{moderationError}</div>}
      {identity && nip05Policy === "require" && !nip05GateSatisfied && (
        <div className="px-3 py-2 text-xs text-amber-200 border-b border-neutral-800 bg-amber-950/20">
          Moderation and role management require a verified NIP-05 identity on this deployment.
        </div>
      )}
      {chatPolicyBlockReason && (
        <div className="px-3 py-2 text-xs text-amber-200 border-b border-neutral-800 bg-amber-950/20">{chatPolicyBlockReason}</div>
      )}
      {slowModeEnabled && (
        <div className="px-3 py-2 text-xs text-neutral-300 border-b border-neutral-800 bg-neutral-950/30">
          Slow mode enabled: one message every {resolvedSlowModeSec}s.
        </div>
      )}
      {commandNotice && <div className="px-3 py-2 text-xs text-blue-200 border-b border-neutral-800 bg-blue-950/20">{commandNotice}</div>}
      {reportNotice && <div className="px-3 py-2 text-xs text-emerald-200 border-b border-neutral-800 bg-emerald-950/20">{reportNotice}</div>}

      <div className="relative flex-1 min-h-0">
        <div 
          ref={scrollRef} 
          data-testid="chat-message-list"
          className="absolute inset-0 min-h-0 touch-pan-y overflow-y-auto overscroll-contain p-1"
          onScroll={(e) => {
            const target = e.currentTarget;
            // Increased threshold to 150 to prevent bouncy scroll dropout on mobile
            const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 150;
            setIsAutoScroll(isAtBottom);
          }}
        >
          {visibleMessages.length === 0 ? (
            <div ref={innerScrollRef} className="flex items-center justify-center h-full text-neutral-500 text-sm">No messages yet</div>
          ) : (
            <div ref={innerScrollRef} className="py-2">
              {olderMessageCount > 0 ? (
                <div className="px-3 pb-2">
                  <button
                    type="button"
                    onClick={() => setVisibleHistoryLimit((current) => current + CHAT_RENDER_BATCH_SIZE)}
                    className="w-full rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                  >
                    Show {Math.min(CHAT_RENDER_BATCH_SIZE, olderMessageCount)} older messages
                  </button>
                </div>
              ) : null}
              {renderedMessages.map((m) => {
                const isWhisper = m.visibility === "whisper";
                const recipients = (m.whisperRecipients ?? []).filter(Boolean);
                const profileRecord = profilesByPubkey[m.pubkey];
                const profileName = profileRecord?.profile.displayName?.trim() || profileRecord?.profile.name?.trim() || null;
                let whisperLabel: string | undefined;
                if (isWhisper) {
                  const uniqueRecipients = Array.from(new Set(recipients));
                  const toLabel = uniqueRecipients
                    .slice(0, 3)
                    .map((value) => pubkeyHexToNpub(value) ?? `${value.slice(0, 8)}…`)
                    .join(", ");
                  whisperLabel = uniqueRecipients.length > 0 ? `to ${toLabel}` : "encrypted message";
                }
                return (
                  <ChatMessage
                    key={m.id ?? `${m.pubkey}:${m.createdAt}:${m.content}`}
                    msg={m}
                    emotesDict={globalEmotesMap}
                    isBroadcaster={m.pubkey === streamPubkey}
                    canModerate={canModerate}
                    canManageRoles={canManageRoles}
                    profileName={profileName}
                    isModerator={moderation.moderators.has(m.pubkey)}
                    isSubscriber={moderation.subscribers.has(m.pubkey)}
                    isVerified={profileRecord?.nip05Verified === true}
                    isWhisper={isWhisper}
                    whisperLabel={whisperLabel}
                    remoteMuted={moderation.remoteMuted.has(m.pubkey)}
                    remoteBlocked={moderation.remoteBlocked.has(m.pubkey)}
                    moderationBusy={!!moderationBusyByPubkey[m.pubkey]}
                    roleBusy={!!roleBusyByPubkey[m.pubkey]}
                    subscriberRoleBusy={!!subscriberBusyByPubkey[m.pubkey]}
                    reportBusy={reportBusy}
                    onModerationAction={(action) => void handleModerationAction(m.pubkey, action)}
                    onToggleModerator={() => void handleToggleModerator(m.pubkey)}
                    onToggleSubscriber={() => void handleToggleSubscriber(m.pubkey)}
                    onReportUser={() => {
                      const npub = pubkeyHexToNpub(m.pubkey) ?? m.pubkey;
                      setReportTarget({
                        type: "user",
                        targetPubkey: m.pubkey,
                        targetStreamId: streamId,
                        summary: `Report user ${npub}`
                      });
                    }}
                    onReplyToUser={() => {
                      const target = pubkeyHexToNpub(m.pubkey) ?? m.pubkey;
                      seedComposerDraft(`@${target} `, "Reply target inserted.");
                    }}
                    onWhisperToUser={() => {
                      const target = pubkeyHexToNpub(m.pubkey) ?? m.pubkey;
                      seedComposerDraft(`/w ${target} `, "Whisper target inserted.");
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
        {!isAutoScroll && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 w-full px-4 flex justify-center pointer-events-none">
            <button 
              type="button"
              onClick={() => {
                setIsAutoScroll(true);
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }}
              className="bg-neutral-800/95 text-neutral-300 text-[11px] font-bold px-3 py-1.5 rounded border border-neutral-700 shadow-xl flex items-center justify-center gap-1.5 hover:bg-neutral-700 hover:text-white transition pointer-events-auto"
            >
              <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-400" />
              Chat paused due to scroll
            </button>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-neutral-900 to-transparent" />
      </div>

      <ChatInput
        key={draftStorageKey}
        onSend={handleSendInput}
        onActivate={ensureChatIdentity}
        disabled={!!chatPolicyBlockReason}
        sendDisabled={!canSend}
        placeholder={chatPolicyBlockReason ? "Chat restricted by stream policy" : "Send a message…"}
        draftMessage={composerDraft}
        draftVersion={composerDraftVersion}
        draftStorageKey={draftStorageKey}
        emotesDict={globalEmotesMap}
      />

      <ReportDialog
        open={!!reportTarget}
        busy={reportBusy}
        title="Report Chat Content"
        targetSummary={reportTarget?.summary ?? ""}
        error={reportError}
        onClose={closeReportDialog}
        onSubmit={handleSubmitReport}
      />
      <TipDialog 
        open={tipDialogOpen} 
        streamPubkey={streamPubkey} 
        streamId={streamId} 
        paymentMethods={paymentMethods}
        onClose={() => setTipDialogOpen(false)} 
      />
    </div>
  );
}
