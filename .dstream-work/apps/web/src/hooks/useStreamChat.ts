"use client";

import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { validateEvent, type Event as SignedNostrEvent } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import {
  buildStreamChatEvent,
  makeATag,
  NOSTR_KINDS,
  parseStreamATag,
  parseStreamChatEvent,
  type NostrEvent,
  type StreamChatMessage
} from "@dstream/protocol";
import { useIdentity } from "@/context/IdentityContext";
import { getNostrRelays } from "@/lib/config";
import { getDmPeerPubkey, getFirstTagValue } from "@/lib/inbox/dm";
import { subscribeMany } from "@/lib/nostr";
import { publishEvent } from "@/lib/publish";
import { takeEagerChatBootstrap } from "@/lib/chatBootstrap";
import { STREAM_CHAT_RECENT_LIMIT, STREAM_CHAT_RECENT_LOOKBACK_SEC } from "@/lib/chatHistory";
import {
  startChatDelivery,
  updateChatDeliveryStatus,
  type ChatDeliveryStatus
} from "@/lib/chatDelivery";

export interface StreamChatFeedMessage extends StreamChatMessage {
  visibility: "public" | "whisper";
  whisperRecipients?: string[];
  deliveryStatus?: ChatDeliveryStatus;
}

const PUBLIC_CHAT_KINDS: [number, number] = [NOSTR_KINDS.STREAM_CHAT, 1];

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function isHex64(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test((input ?? "").trim());
}

function parseRecipientsFromWhisperEvent(event: any): string[] {
  const explicit = getFirstTagValue(event?.tags, "whisper_to");
  if (explicit) {
    return explicit
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => isHex64(value));
  }

  if (!Array.isArray(event?.tags)) return [];
  return event.tags
    .filter((tag: unknown) => Array.isArray(tag) && tag[0] === "p" && typeof tag[1] === "string")
    .map((tag: any[]) => (tag[1] as string).trim().toLowerCase())
    .filter((value: string, index: number, arr: string[]) => isHex64(value) && arr.indexOf(value) === index);
}

function appendMessageWithLimit(list: StreamChatFeedMessage[], message: StreamChatFeedMessage, limit: number): StreamChatFeedMessage[] {
  if (message.id && list.some((item) => item.id === message.id)) return list;
  const next = [...list, message].sort((a, b) => a.createdAt - b.createdAt);
  return next.slice(-limit);
}

function messageKey(message: StreamChatFeedMessage): string {
  return message.id || `${message.pubkey}:${message.createdAt}:${message.streamId}:${message.visibility}:${message.content}`;
}

function mergeMessagesWithLimit(
  list: StreamChatFeedMessage[],
  incoming: StreamChatFeedMessage[],
  limit: number
): StreamChatFeedMessage[] {
  if (incoming.length === 0) return list;
  const byId = new Map(list.map((message) => [messageKey(message), message]));
  for (const message of incoming) byId.set(messageKey(message), message);
  return Array.from(byId.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-limit);
}

function getMatchingATag(event: any, allowedATags: Set<string>): string | null {
  if (!Array.isArray(event?.tags)) return null;
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== "a" || typeof tag[1] !== "string") continue;
    const value = tag[1].trim();
    if (allowedATags.has(value)) return value;
  }
  return null;
}

function parsePublicChatMessage(
  event: any,
  allowedATags: Set<string>,
  expectedStreamPubkey: string
): StreamChatFeedMessage | null {
  if (!event || (event.kind !== NOSTR_KINDS.STREAM_CHAT && event.kind !== 1)) return null;

  const matchedATag = getMatchingATag(event, allowedATags);
  if (!matchedATag) return null;

  const parsedATag = parseStreamATag(matchedATag);
  if (!parsedATag || parsedATag.streamPubkey !== expectedStreamPubkey) return null;

  const parsedStandard = parseStreamChatEvent(event, {
    streamPubkey: parsedATag.streamPubkey,
    streamId: parsedATag.streamId
  });
  if (parsedStandard) return { ...parsedStandard, visibility: "public" };

  const pubkey = typeof event.pubkey === "string" ? event.pubkey.trim().toLowerCase() : "";
  if (!isHex64(pubkey)) return null;

  const createdAt = typeof event.created_at === "number" && Number.isFinite(event.created_at) ? Math.floor(event.created_at) : nowSec();

  return {
    id: typeof event.id === "string" && event.id ? event.id : `${pubkey}:${createdAt}:${event.kind}`,
    pubkey,
    streamPubkey: parsedATag.streamPubkey,
    streamId: parsedATag.streamId,
    content: typeof event.content === "string" ? event.content : "",
    createdAt,
    raw: event as NostrEvent,
    visibility: "public"
  };
}

export function useStreamChat(scope: { streamPubkey: string; streamId: string; enabled?: boolean; limit?: number }) {
  const { identity, nip04, signEvent } = useIdentity();
  const [messages, setMessages] = useState<StreamChatFeedMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  const relays = useMemo(() => getNostrRelays(), []);
  const streamPubkey = scope.streamPubkey.trim().toLowerCase();
  const streamId = scope.streamId;
  const enabled = scope.enabled ?? true;
  const limit = scope.limit ?? 200;
  const streamScopeKey = `${streamPubkey}:${streamId}`;
  const currentATag = useMemo(
    () => (enabled && streamPubkey && streamId ? makeATag(streamPubkey, streamId) : ""),
    [enabled, streamId, streamPubkey]
  );
  const chatATags = useMemo(() => (currentATag ? [currentATag] : []), [currentATag]);
  const chatATagsSet = useMemo(() => new Set(chatATags), [chatATags]);

  useLayoutEffect(() => {
    setMessages([]);
    setIsConnected(false);
    seenIds.current.clear();
  }, [enabled, streamScopeKey]);

  useLayoutEffect(() => {
    if (!enabled || !streamPubkey || !streamId) return;
    if (chatATags.length === 0) return;

    setIsConnected(false);

    let cancelled = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Map<string, StreamChatFeedMessage>();
    const flush = () => {
      if (cancelled || pending.size === 0) return;
      const batch = Array.from(pending.values());
      pending.clear();
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      startTransition(() => {
        setMessages((current) => mergeMessagesWithLimit(current, batch, limit));
      });
    };
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, 100);
    };

    const filter: Filter = {
      kinds: PUBLIC_CHAT_KINDS,
      "#a": chatATags,
      since: Math.floor(Date.now() / 1000) - STREAM_CHAT_RECENT_LOOKBACK_SEC,
      limit: STREAM_CHAT_RECENT_LIMIT
    };

    const handleEvent = (event: any) => {
      if (event?.id && seenIds.current.has(event.id)) {
        setMessages((current) => updateChatDeliveryStatus(current, event.id, "sent"));
        return;
      }
      const parsed = parsePublicChatMessage(event, chatATagsSet, streamPubkey);
      if (!parsed) return;
      if (parsed.id) seenIds.current.add(parsed.id);

      const message = { ...parsed, visibility: "public" as const };
      pending.set(messageKey(message), message);
      scheduleFlush();
    };
    const handleEose = () => {
      flush();
      setIsConnected(true);
    };

    const eagerBootstrap =
      chatATags.length === 1 ? takeEagerChatBootstrap(streamPubkey, streamId) : null;
    const detachBootstrap = eagerBootstrap?.attach({
      onevent: handleEvent,
      oneose: handleEose
    });
    const sub = eagerBootstrap
      ? null
      : subscribeMany(relays, [filter], {
          onevent: handleEvent,
          oneose: handleEose
        });

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
      detachBootstrap?.();
      eagerBootstrap?.close();
      try {
        (sub as any)?.close?.();
      } catch {
        // ignore
      }
      setIsConnected(false);
    };
  }, [chatATags, chatATagsSet, enabled, limit, relays, streamId, streamPubkey]);

  useEffect(() => {
    if (!enabled || !streamPubkey || !streamId) return;
    if (!identity?.pubkey || !nip04) return;

    const aTag = makeATag(streamPubkey, streamId);
    const filter: Filter[] = [
      { kinds: [4], "#p": [identity.pubkey], since: Math.floor(Date.now() / 1000) - 3600, limit: 250 },
      { kinds: [4], authors: [identity.pubkey], since: Math.floor(Date.now() / 1000) - 3600, limit: 250 }
    ];

    const sub = subscribeMany(relays, filter, {
      onevent: (event: any) => {
        if (!event || event.kind !== 4) return;
        if (!validateEvent(event)) return;
        if (event?.id && seenIds.current.has(event.id)) return;

        const tagValue = getFirstTagValue(event.tags, "a");
        const whisperTag = getFirstTagValue(event.tags, "t");
        if (tagValue !== aTag || whisperTag !== "whisper") return;

        const authorPubkey = typeof event.pubkey === "string" ? event.pubkey.toLowerCase() : "";
        if (!isHex64(authorPubkey)) return;

        const peerPubkey = getDmPeerPubkey(event, identity.pubkey);
        if (!peerPubkey) return;
        if (authorPubkey === identity.pubkey.toLowerCase()) return;

        const recipients = parseRecipientsFromWhisperEvent(event);
        const messageId = typeof event.id === "string" && event.id ? event.id : `${authorPubkey}:${event.created_at}:whisper`;

        void (async () => {
          let plaintext = "";
          try {
            plaintext = await nip04.decrypt(peerPubkey, event.content ?? "");
          } catch {
            return;
          }
          if (!plaintext.trim()) return;

          seenIds.current.add(messageId);
          const parsed: StreamChatFeedMessage = {
            id: messageId,
            pubkey: authorPubkey,
            streamPubkey,
            streamId,
            content: plaintext,
            createdAt: Math.floor(event.created_at ?? nowSec()),
            raw: event as NostrEvent,
            visibility: "whisper",
            whisperRecipients: recipients
          };
          setMessages((prev) => appendMessageWithLimit(prev, parsed, limit));
        })();
      }
    });

    return () => {
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [enabled, identity?.pubkey, limit, nip04, relays, streamId, streamPubkey]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!identity) return false;
      const text = content.trim();
      if (!text) return false;

      const createdAt = Math.floor(Date.now() / 1000);
      const localId = `local-chat:${identity.pubkey}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      const unsigned = buildStreamChatEvent({
        pubkey: identity.pubkey,
        createdAt,
        streamPubkey,
        streamId,
        content: text
      }) as any;
      const optimistic: StreamChatFeedMessage = {
        id: localId,
        pubkey: identity.pubkey.toLowerCase(),
        streamPubkey,
        streamId,
        content: text,
        createdAt,
        raw: { ...unsigned, id: localId, sig: "" } as NostrEvent,
        visibility: "public",
        deliveryStatus: "sending"
      };
      flushSync(() => {
        setMessages((prev) => appendMessageWithLimit(prev, optimistic, limit));
      });

      const signAndPublish = async () => {
        let signed: SignedNostrEvent;
        try {
          signed = await signEvent(unsigned);
        } catch {
          setMessages((current) => updateChatDeliveryStatus(current, localId, "failed"));
          return;
        }

        seenIds.current.add(signed.id);
        setMessages((current) =>
          current.map((message) =>
            message.id === localId
              ? { ...message, id: signed.id, raw: signed as NostrEvent }
              : message
          )
        );
        startChatDelivery(
          () => publishEvent(relays, signed, { poolTimeoutMs: 3_000, fallbackTimeoutMs: 2_500 }),
          (deliveryStatus) => {
            setMessages((current) => updateChatDeliveryStatus(current, signed.id, deliveryStatus));
          }
        );
      };

      window.setTimeout(() => void signAndPublish(), 0);
      return true;
    },
    [identity, limit, relays, signEvent, streamId, streamPubkey]
  );

  const sendWhisper = useCallback(
    async (input: { recipients: string[]; content: string; observerPubkeys?: string[] }) => {
      if (!identity || !nip04) return false;
      const content = (input.content ?? "").trim();
      if (!content) return false;

      const baseRecipients = (input.recipients ?? [])
        .map((value) => value.trim().toLowerCase())
        .filter((value, index, arr) => isHex64(value) && arr.indexOf(value) === index);
      if (baseRecipients.length === 0) return false;

      const observerPubkeys = (input.observerPubkeys ?? [])
        .map((value) => value.trim().toLowerCase())
        .filter((value, index, arr) => isHex64(value) && arr.indexOf(value) === index);

      const sender = identity.pubkey.toLowerCase();
      const deliveryRecipients = Array.from(new Set([...baseRecipients, ...observerPubkeys])).filter((value) => value !== sender);
      if (deliveryRecipients.length === 0) return false;

      const aTag = makeATag(streamPubkey, streamId);
      const recipientsTag = baseRecipients.join(",");

      let okCount = 0;
      for (const recipient of deliveryRecipients) {
        const ciphertext = await nip04.encrypt(recipient, content);
        const unsigned: Omit<NostrEvent, "id" | "sig"> = {
          kind: 4,
          pubkey: identity.pubkey,
          created_at: nowSec(),
          tags: [
            ["p", recipient],
            ["a", aTag],
            ["t", "whisper"],
            ["whisper_to", recipientsTag]
          ],
          content: ciphertext
        };
        const signed = await signEvent(unsigned);
        const ok = await publishEvent(relays, signed);
        if (ok) okCount += 1;
      }

      if (okCount === 0) return false;
      const createdAt = nowSec();
      const optimistic: StreamChatFeedMessage = {
        id: `local-whisper:${identity.pubkey}:${createdAt}:${Math.random().toString(16).slice(2)}`,
        pubkey: identity.pubkey.toLowerCase(),
        streamPubkey,
        streamId,
        content,
        createdAt,
        raw: {
          kind: 4,
          pubkey: identity.pubkey.toLowerCase(),
          created_at: createdAt,
          tags: [
            ["a", aTag],
            ["t", "whisper"],
            ["whisper_to", recipientsTag]
          ],
          content: "",
          id: undefined,
          sig: undefined
        },
        visibility: "whisper",
        whisperRecipients: baseRecipients
      };
      setMessages((prev) => appendMessageWithLimit(prev, optimistic, limit));
      return true;
    },
    [identity, limit, nip04, relays, signEvent, streamId, streamPubkey]
  );

  return {
    messages,
    isConnected,
    canSend: !!identity,
    canWhisper: !!identity && !!nip04,
    sendMessage,
    sendWhisper
  };
}
