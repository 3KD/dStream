"use client";

import { useEffect, useRef } from "react";
import { useCallback, useMemo, useState } from "react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useStreamModeration } from "@/hooks/useStreamModeration";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { parseChatCommand } from "@/lib/chatCommands";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { useNostrProfile, useNostrProfiles } from "@/hooks/useNostrProfiles";
import { getNip05Policy } from "@/lib/config";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";

export function ChatBox({
  streamPubkey,
  streamId,
  onMessageCountChange
}: {
  streamPubkey: string;
  streamId: string;
  onMessageCountChange?: (count: number) => void;
}) {
  const { identity, signEvent } = useIdentity();
  const social = useSocial();
  const { messages, isConnected, sendMessage, sendWhisper, canSend, canWhisper } = useStreamChat({ streamPubkey, streamId });
  const scrollRef = useRef<HTMLDivElement>(null);
  const nip05Policy = useMemo(() => getNip05Policy(), []);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [moderationBusyByPubkey, setModerationBusyByPubkey] = useState<Record<string, boolean>>({});
  const [roleBusyByPubkey, setRoleBusyByPubkey] = useState<Record<string, boolean>>({});
  const [subscriberBusyByPubkey, setSubscriberBusyByPubkey] = useState<Record<string, boolean>>({});

  const moderation = useStreamModeration({
    streamPubkey,
    streamId,
    identityPubkey: identity?.pubkey ?? null,
    signEvent
  });

  const selfProfile = useNostrProfile(identity?.pubkey ?? null);
  const isOwner = !!(identity && identity.pubkey === streamPubkey);
  const nip05GateSatisfied = nip05Policy !== "require" || selfProfile?.nip05Verified === true;
  const canModerate = moderation.canModerate && nip05GateSatisfied;
  const canManageRoles = isOwner && nip05GateSatisfied;

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message) =>
          !social.isMuted(message.pubkey) &&
          !social.isBlocked(message.pubkey) &&
          !moderation.remoteMuted.has(message.pubkey) &&
          !moderation.remoteBlocked.has(message.pubkey)
      ),
    [messages, moderation.remoteBlocked, moderation.remoteMuted, social]
  );

  const hiddenCount = messages.length - visibleMessages.length;
  const visiblePubkeys = useMemo(() => visibleMessages.map((message) => message.pubkey), [visibleMessages]);
  const profilesByPubkey = useNostrProfiles(visiblePubkeys);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visibleMessages.length]);

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

  const handleSendInput = useCallback(
    async (input: string) => {
      const parsed = parseChatCommand(input);
      if (!parsed) return await sendMessage(input);
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
    [canModerate, canWhisper, moderation, sendMessage, sendWhisper, showNotice, social, streamPubkey]
  );

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">Chat</span>
          {isConnected && <span className="w-2 h-2 bg-green-500 rounded-full" title="Connected" />}
          {!isConnected && moderation.isLoading && <span className="text-[10px] text-neutral-500">syncing moderation…</span>}
        </div>
        <span className="text-xs text-neutral-500">
          {visibleMessages.length} msgs{hiddenCount > 0 ? ` (+${hiddenCount} hidden)` : ""}
        </span>
      </div>
      {moderationError && <div className="px-3 py-2 text-xs text-red-300 border-b border-neutral-800 bg-red-950/20">{moderationError}</div>}
      {identity && nip05Policy === "require" && !nip05GateSatisfied && (
        <div className="px-3 py-2 text-xs text-amber-200 border-b border-neutral-800 bg-amber-950/20">
          Moderation and role management require a verified NIP-05 identity on this deployment.
        </div>
      )}
      {commandNotice && <div className="px-3 py-2 text-xs text-blue-200 border-b border-neutral-800 bg-blue-950/20">{commandNotice}</div>}

      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {visibleMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">No messages yet</div>
        ) : (
          <div className="py-2">
            {visibleMessages.map((m) => {
              const isWhisper = m.visibility === "whisper";
              const recipients = (m.whisperRecipients ?? []).filter(Boolean);
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
                  isBroadcaster={m.pubkey === streamPubkey}
                  canModerate={canModerate}
                  canManageRoles={canManageRoles}
                  isModerator={moderation.moderators.has(m.pubkey)}
                  isSubscriber={moderation.subscribers.has(m.pubkey)}
                  isVerified={profilesByPubkey[m.pubkey]?.nip05Verified === true}
                  isWhisper={isWhisper}
                  whisperLabel={whisperLabel}
                  remoteMuted={moderation.remoteMuted.has(m.pubkey)}
                  remoteBlocked={moderation.remoteBlocked.has(m.pubkey)}
                  moderationBusy={!!moderationBusyByPubkey[m.pubkey]}
                  roleBusy={!!roleBusyByPubkey[m.pubkey]}
                  subscriberRoleBusy={!!subscriberBusyByPubkey[m.pubkey]}
                  onModerationAction={(action) => void handleModerationAction(m.pubkey, action)}
                  onToggleModerator={() => void handleToggleModerator(m.pubkey)}
                  onToggleSubscriber={() => void handleToggleSubscriber(m.pubkey)}
                />
              );
            })}
          </div>
        )}
      </div>

      {!identity ? (
        <div className="p-3 border-t border-neutral-800 bg-neutral-900 text-center text-sm text-neutral-500">
          Connect an identity to chat.
        </div>
      ) : (
        <ChatInput onSend={handleSendInput} disabled={!canSend} />
      )}
    </div>
  );
}
