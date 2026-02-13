"use client";

import Link from "next/link";
import { useSocial } from "@/context/SocialContext";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { BadgeCheck, Ban, CheckCircle2, Gem, Shield, ShieldCheck, Volume2, VolumeX } from "lucide-react";
import type { StreamChatMessage, StreamModerationAction } from "@dstream/protocol";

export function ChatMessage({
  msg,
  isBroadcaster,
  canModerate = false,
  canManageRoles = false,
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
  onModerationAction,
  onToggleModerator,
  onToggleSubscriber
}: {
  msg: StreamChatMessage;
  isBroadcaster: boolean;
  canModerate?: boolean;
  canManageRoles?: boolean;
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
  onModerationAction?: (action: StreamModerationAction) => void;
  onToggleModerator?: () => void;
  onToggleSubscriber?: () => void;
}) {
  const time = new Date(msg.createdAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const social = useSocial();
  const alias = social.getAlias(msg.pubkey);
  const trusted = social.isTrusted(msg.pubkey);
  const localMuted = social.isMuted(msg.pubkey);
  const localBlocked = social.isBlocked(msg.pubkey);
  const muted = localMuted || remoteMuted;
  const blocked = localBlocked || remoteBlocked;
  const npub = pubkeyHexToNpub(msg.pubkey);
  const pubkeyLabel = npub ? shortenText(npub, { head: 14, tail: 8 }) : shortenText(msg.pubkey, { head: 14, tail: 8 });
  const showModeration = canModerate && !isBroadcaster;
  const showRoleControl = canManageRoles && !isBroadcaster;
  const profileHref = `/profile/${npub ?? msg.pubkey}`;

  return (
    <div className={`flex gap-2 py-1.5 px-3 hover:bg-neutral-800/50 ${isWhisper ? "bg-purple-950/10" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Link href={profileHref} className={`font-medium text-sm truncate hover:underline ${isBroadcaster ? "text-red-400" : "text-neutral-200"}`}>
            {alias ?? pubkeyLabel}
          </Link>
          {alias && <span className="text-[10px] text-neutral-500 font-mono truncate">{pubkeyLabel}</span>}
          {trusted && (
            <span className="text-[10px] bg-emerald-950/50 border border-emerald-700/30 text-emerald-200 px-1.5 py-0.5 rounded">
              TRUSTED
            </span>
          )}
          {isVerified && (
            <span className="text-[10px] bg-cyan-950/50 border border-cyan-700/30 text-cyan-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
              <BadgeCheck className="w-3 h-3" />
              VERIFIED
            </span>
          )}
          {isModerator && (
            <span className="text-[10px] bg-blue-950/50 border border-blue-700/30 text-blue-200 px-1.5 py-0.5 rounded">MOD</span>
          )}
          {isSubscriber && (
            <span className="text-[10px] bg-amber-950/50 border border-amber-700/30 text-amber-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
              <Gem className="w-3 h-3" />
              SUB
            </span>
          )}
          {isBroadcaster && <span className="text-[10px] bg-red-900 text-red-200 px-1.5 py-0.5 rounded">STREAMER</span>}
          {isWhisper && (
            <span className="text-[10px] bg-purple-950/50 border border-purple-700/30 text-purple-200 px-1.5 py-0.5 rounded">WHISPER</span>
          )}
          <span className="text-[10px] text-neutral-500">{time}</span>
        </div>
        {isWhisper && whisperLabel && <div className="text-[11px] text-purple-200/80 mb-0.5">{whisperLabel}</div>}
        <p className={`text-sm break-words ${isWhisper ? "text-purple-100/90" : "text-neutral-300"}`}>{msg.content}</p>
      </div>

      {showModeration && (
        <div className="flex items-start gap-1 pt-0.5">
          <button
            type="button"
            onClick={() => onModerationAction?.(remoteMuted ? "clear" : "mute")}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border ${
              muted ? "bg-neutral-950/60 border-neutral-700 text-neutral-200" : "bg-neutral-950/30 border-neutral-800 text-neutral-400 hover:text-white"
            }`}
            title={remoteMuted ? "Clear mute" : "Mute user"}
            aria-label={remoteMuted ? "Clear mute" : "Mute user"}
            disabled={moderationBusy}
          >
            {muted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => onModerationAction?.(remoteBlocked ? "clear" : "block")}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border ${
              blocked
                ? "bg-red-950/40 border-red-800/40 text-red-200"
                : "bg-neutral-950/30 border-neutral-800 text-neutral-400 hover:text-white"
            }`}
            title={remoteBlocked ? "Clear block" : "Block user"}
            aria-label={remoteBlocked ? "Clear block" : "Block user"}
            disabled={moderationBusy}
          >
            {blocked ? <CheckCircle2 className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
          </button>
          {showRoleControl && (
            <>
              <button
                type="button"
                onClick={() => onToggleModerator?.()}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border ${
                  isModerator
                    ? "bg-blue-950/40 border-blue-800/40 text-blue-200"
                    : "bg-neutral-950/30 border-neutral-800 text-neutral-400 hover:text-white"
                }`}
                title={isModerator ? "Remove moderator" : "Make moderator"}
                aria-label={isModerator ? "Remove moderator" : "Make moderator"}
                disabled={roleBusy}
              >
                {isModerator ? <ShieldCheck className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => onToggleSubscriber?.()}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border ${
                  isSubscriber
                    ? "bg-amber-950/40 border-amber-800/40 text-amber-200"
                    : "bg-neutral-950/30 border-neutral-800 text-neutral-400 hover:text-white"
                }`}
                title={isSubscriber ? "Remove subscriber badge" : "Add subscriber badge"}
                aria-label={isSubscriber ? "Remove subscriber badge" : "Add subscriber badge"}
                disabled={subscriberRoleBusy}
              >
                <Gem className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
