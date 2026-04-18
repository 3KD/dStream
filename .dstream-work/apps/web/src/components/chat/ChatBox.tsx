"use client";

import { Users, ArrowDownToLine } from "lucide-react";

import { useEffect, useRef } from "react";
import { useCallback, useMemo, useState } from "react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useStreamModeration } from "@/hooks/useStreamModeration";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { parseChatCommand } from "@/lib/chatCommands";
import { STREAM_CHAT_CLEAR_REASON } from "@/lib/chatModeration";
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
  className?: string;
}) {
  const { identity, signEvent } = useIdentity();
  const social = useSocial();
  const { messages, isConnected, sendMessage, sendWhisper, canSend, canWhisper } = useStreamChat({ streamPubkey, streamId });
  const globalEmotesMap = useEmotes(streamPubkey);
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

  const lastMessageSentAtRef = useRef<number>(0);
  const clearRequestSeenRef = useRef<number>(0);

  const moderation = useStreamModeration({
    streamPubkey,
    streamId,
    identityPubkey: identity?.pubkey ?? null,
    signEvent
  });

  const selfProfile = useNostrProfile(identity?.pubkey ?? null);
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

  const hiddenCount = messages.length - visibleMessages.length;
  const normalizedViewerCount = typeof viewerCount === "number" && Number.isFinite(viewerCount) ? Math.max(0, viewerCount) : 0;
  const visiblePubkeys = useMemo(() => visibleMessages.map((message) => message.pubkey), [visibleMessages]);
  const profilesByPubkey = useNostrProfiles(visiblePubkeys);

  const [isAutoScroll, setIsAutoScroll] = useState(true);

  useEffect(() => {
    if (!scrollRef.current || !innerScrollRef.current) return;
    const observer = new ResizeObserver(() => {
      if (isAutoScroll && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
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
          {!isConnected && moderation.isLoading && <span className="text-[10px] text-neutral-500">syncing moderation…</span>}
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setTipDialogOpen(true)}
            className="flex items-center justify-center gap-1.5 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 hover:text-orange-400 text-neutral-300 rounded-lg text-xs font-bold transition-all"
            title="Support Creator (Lightning/XMR)"
          >
            <span className="text-yellow-500 text-sm leading-none pt-0.5">⚡</span> Support / Tip
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
          className="absolute inset-0 overflow-y-auto min-h-0 p-1"
          onScroll={(e) => {
            const target = e.currentTarget;
            const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
            setIsAutoScroll(isAtBottom);
          }}
        >
          {visibleMessages.length === 0 ? (
            <div ref={innerScrollRef} className="flex items-center justify-center h-full text-neutral-500 text-sm">No messages yet</div>
          ) : (
            <div ref={innerScrollRef} className="py-2">
              {visibleMessages.map((m) => {
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

      {!identity ? (
        <div className="pt-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-neutral-800 bg-neutral-900 text-center text-sm text-neutral-500">
          Connect an identity to chat.
        </div>
      ) : (
        <ChatInput
          onSend={handleSendInput}
          disabled={!canSend || !!chatPolicyBlockReason}
          placeholder={chatPolicyBlockReason ? "Chat restricted by stream policy" : "Send a message…"}
          draftMessage={composerDraft}
          draftVersion={composerDraftVersion}
          emotesDict={globalEmotesMap}
        />
      )}

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
        onClose={() => setTipDialogOpen(false)} 
      />
    </div>
  );
}
