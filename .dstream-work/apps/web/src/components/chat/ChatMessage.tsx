"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSocial } from "@/context/SocialContext";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { BadgeCheck, CheckCircle2, EllipsisVertical, Flag, Gem, RadioTower, ShieldCheck } from "lucide-react";
import type { StreamChatMessage, StreamModerationAction } from "@dstream/protocol";
import type { ReactNode } from "react";

function renderContentWithEmotes(content: string, emotesDict?: Record<string, { url: string; tier: "free" | "subscriber" }>, isApproved?: boolean): ReactNode[] {
  if (!emotesDict || Object.keys(emotesDict).length === 0) {
    return [content];
  }

  const parts = content.split(/(:[a-zA-Z0-9_-]+:)/g);
  return parts.map((part, i) => {
    if (part.startsWith(":") && part.endsWith(":")) {
      const code = part.slice(1, -1);
      const emote = emotesDict[code];
      if (emote) {
        if (emote.tier === "subscriber" && !isApproved) {
          return part;
        }
        return (
          <img 
            key={i} 
            src={emote.url} 
            alt={part} 
            title={part} 
            className="inline-block h-6 w-auto align-middle px-[1px] pointer-events-none" 
          />
        );
      }
    }
    return part;
  });
}

export function ChatMessage({
  msg,
  emotesDict,
  isBroadcaster,
  canModerate = false,
  canManageRoles = false,
  profileName,
  isModerator = false,
  isSubscriber = false,
  isVerified = false,
  isWhisper = false,
  whisperLabel,
  remoteMuted = false,
  remoteBlocked = false,
  moderationBusy = false,
  roleBusy = false,
  subscriberRoleBusy = false,
  reportBusy = false,
  onModerationAction,
  onToggleModerator,
  onToggleSubscriber,
  onReportUser,
  onReportMessage,
  onReplyToUser,
  onWhisperToUser
}: {
  msg: StreamChatMessage;
  emotesDict?: Record<string, { url: string; tier: "free" | "subscriber" }>;
  isBroadcaster: boolean;
  canModerate?: boolean;
  canManageRoles?: boolean;
  profileName?: string | null;
  isModerator?: boolean;
  isSubscriber?: boolean;
  isVerified?: boolean;
  isWhisper?: boolean;
  whisperLabel?: string;
  remoteMuted?: boolean;
  remoteBlocked?: boolean;
  moderationBusy?: boolean;
  roleBusy?: boolean;
  subscriberRoleBusy?: boolean;
  reportBusy?: boolean;
  onModerationAction?: (action: StreamModerationAction) => void;
  onToggleModerator?: () => void;
  onToggleSubscriber?: () => void;
  onReportUser?: () => void;
  onReportMessage?: () => void;
  onReplyToUser?: () => void;
  onWhisperToUser?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const time = mounted ? new Date(msg.createdAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--";
  const social = useSocial();
  const alias = social.getAlias(msg.pubkey);
  const trusted = social.isTrusted(msg.pubkey);
  const localMuted = social.isMuted(msg.pubkey);
  const localBlocked = social.isBlocked(msg.pubkey);
  const muted = localMuted || remoteMuted;
  const blocked = localBlocked || remoteBlocked;
  const npub = pubkeyHexToNpub(msg.pubkey);
  const pubkeyLabel = npub ? shortenText(npub, { head: 14, tail: 8 }) : shortenText(msg.pubkey, { head: 14, tail: 8 });
  const normalizedProfileName = (profileName ?? "").trim();
  const displayLabel = normalizedProfileName || alias || pubkeyLabel;
  const showModeration = canModerate && !isBroadcaster;
  const showRoleControl = canManageRoles && !isBroadcaster;
  const showReply = typeof onReplyToUser === "function";
  const showWhisper = typeof onWhisperToUser === "function";
  const reportAction = onReportMessage ?? onReportUser;
  const showReport = typeof reportAction === "function";
  const showActions = showModeration || showReply || showWhisper || showReport;
  const profileHref = `/profile/${npub ?? msg.pubkey}`;
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!actionsOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (actionsMenuRef.current?.contains(target)) return;
      setActionsOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [actionsOpen]);

  return (
    <div className={`flex gap-2 py-1.5 px-3 hover:bg-neutral-800/50 ${isWhisper ? "bg-purple-950/10" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Link href={profileHref} className={`font-medium text-sm truncate hover:underline ${isBroadcaster ? "text-red-400" : "text-neutral-200"}`}>
            {displayLabel}
          </Link>
          {displayLabel !== pubkeyLabel && <span className="text-[10px] text-neutral-500 font-mono truncate">{pubkeyLabel}</span>}
          {normalizedProfileName && alias && alias !== normalizedProfileName && (
            <span className="text-[10px] text-neutral-500 truncate">local: {alias}</span>
          )}
          {trusted && (
            <span className="text-[10px] bg-emerald-950/50 border border-emerald-700/30 text-emerald-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              FRIEND
            </span>
          )}
          {isVerified && (
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-cyan-950/60 border border-cyan-700/40 text-cyan-200"
              title="Verified"
              aria-label="Verified"
            >
              <BadgeCheck className="w-3 h-3" />
            </span>
          )}
          {isModerator && (
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-950/60 border border-blue-700/40 text-blue-200"
              title="Admin"
              aria-label="Admin"
            >
              <ShieldCheck className="w-3 h-3" />
            </span>
          )}
          {isSubscriber && (
            <span className="text-[10px] bg-amber-950/50 border border-amber-700/30 text-amber-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
              <Gem className="w-3 h-3" />
              SUB
            </span>
          )}
          {isBroadcaster && (
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-950/70 border border-red-700/40 text-red-200"
              title="Streamer"
              aria-label="Streamer"
            >
              <RadioTower className="w-3 h-3" />
            </span>
          )}
          {isWhisper && (
            <span className="text-[10px] bg-purple-950/50 border border-purple-700/30 text-purple-200 px-1.5 py-0.5 rounded">WHISPER</span>
          )}
          <span className="text-[10px] text-neutral-500">{time}</span>
        </div>
        {isWhisper && whisperLabel && <div className="text-[11px] text-purple-200/80 mb-0.5">{whisperLabel}</div>}
        <p className={`text-sm break-words ${isWhisper ? "text-purple-100/90" : "text-neutral-300"}`}>
          {renderContentWithEmotes(msg.content, emotesDict, isBroadcaster || isModerator || isSubscriber)}
        </p>
      </div>

      {showActions && (
        <div ref={actionsMenuRef} className="relative flex items-start gap-1 pt-0.5">
          <button
            type="button"
            onClick={() => setActionsOpen((current) => !current)}
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl border bg-neutral-950/30 border-neutral-800 text-neutral-400 hover:text-white"
            title="Message actions"
            aria-label="Message actions"
            aria-expanded={actionsOpen}
            aria-haspopup="menu"
          >
            <EllipsisVertical className="w-4 h-4" />
          </button>

          {actionsOpen && (
            <div className="absolute right-0 top-10 z-20 min-w-[12rem] rounded-xl border border-neutral-800 bg-neutral-950/95 shadow-xl overflow-hidden">
              {showReply && (
                <button
                  type="button"
                  onClick={() => {
                    onReplyToUser?.();
                    setActionsOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-neutral-200 hover:bg-neutral-800"
                >
                  Reply to user
                </button>
              )}

              {showWhisper && (
                <button
                  type="button"
                  onClick={() => {
                    onWhisperToUser?.();
                    setActionsOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-neutral-200 hover:bg-neutral-800"
                >
                  Whisper to user
                </button>
              )}

              {showModeration && (
                <button
                  type="button"
                  onClick={() => {
                    onModerationAction?.(remoteMuted || muted ? "clear" : "mute");
                    setActionsOpen(false);
                  }}
                  disabled={moderationBusy}
                  className="w-full px-3 py-2 text-left text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {remoteMuted || muted ? "Unmute user" : "Mute user"}
                </button>
              )}

              {showModeration && (
                <button
                  type="button"
                  onClick={() => {
                    onModerationAction?.(remoteBlocked || blocked ? "clear" : "block");
                    setActionsOpen(false);
                  }}
                  disabled={moderationBusy}
                  className="w-full px-3 py-2 text-left text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {remoteBlocked || blocked ? "Unblock user" : "Block user"}
                </button>
              )}

              {showRoleControl && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleModerator?.();
                    setActionsOpen(false);
                  }}
                  disabled={roleBusy}
                  className="w-full px-3 py-2 text-left text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {isModerator ? "Remove moderator" : "Make moderator"}
                </button>
              )}

              {showRoleControl && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleSubscriber?.();
                    setActionsOpen(false);
                  }}
                  disabled={subscriberRoleBusy}
                  className="w-full px-3 py-2 text-left text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {isSubscriber ? "Remove subscriber badge" : "Add subscriber badge"}
                </button>
              )}

              {showReport && (
                <button
                  type="button"
                  onClick={() => {
                    reportAction?.();
                    setActionsOpen(false);
                  }}
                  disabled={reportBusy}
                  className="w-full px-3 py-2 text-left text-xs text-red-200 hover:bg-red-950/30 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <Flag className="w-3.5 h-3.5" />
                  Report
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
