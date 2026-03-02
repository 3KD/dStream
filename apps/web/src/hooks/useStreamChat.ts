"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { validateEvent, verifyEvent } from "nostr-tools";
import {
  buildStreamChatEvent,
  makeATag,
  parseStreamChatEvent,
  type NostrEvent,
  type StreamChatMessage
} from "@dstream/protocol";
import { useIdentity } from "@/context/IdentityContext";
import { getNostrRelays } from "@/lib/config";
import { getDmPeerPubkey, getFirstTagValue } from "@/lib/inbox/dm";
import { subscribeMany } from "@/lib/nostr";
import { publishEvent } from "@/lib/publish";

export interface StreamChatFeedMessage extends StreamChatMessage {
  visibility: "public" | "whisper";
  whisperRecipients?: string[];
}

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

export function useStreamChat(scope: { streamPubkey: string; streamId: string; limit?: number }) {
  const { identity, nip04, signEvent } = useIdentity();
  const [messages, setMessages] = useState<StreamChatFeedMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  const relays = useMemo(() => getNostrRelays(), []);
  const streamPubkey = scope.streamPubkey;
  const streamId = scope.streamId;
  const limit = scope.limit ?? 200;

  useEffect(() => {
    if (!streamPubkey || !streamId) return;

    setMessages([]);
    setIsConnected(false);
    seenIds.current.clear();

    const filter: Filter = {
      kinds: [1311],
      "#a": [makeATag(streamPubkey, streamId)],
      since: Math.floor(Date.now() / 1000) - 3600,
      limit: 200
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        if (event?.id && seenIds.current.has(event.id)) return;
        const parsed = parseStreamChatEvent(event, { streamPubkey, streamId });
        if (!parsed) return;
        if (parsed.id) seenIds.current.add(parsed.id);

        setMessages((prev) => {
          return appendMessageWithLimit(prev, { ...parsed, visibility: "public" }, limit);
        });
      },
      oneose: () => setIsConnected(true)
    });

    return () => {
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
      setIsConnected(false);
    };
  }, [relays, streamPubkey, streamId, limit]);

  useEffect(() => {
    if (!streamPubkey || !streamId) return;
    if (!identity?.pubkey || !nip04) return;

    const aTag = makeATag(streamPubkey, streamId);
    const filter: Filter[] = [
      { kinds: [4], "#p": [identity.pubkey], since: Math.floor(Date.now() / 1000) - 3600, limit: 1000 },
      { kinds: [4], authors: [identity.pubkey], since: Math.floor(Date.now() / 1000) - 3600, limit: 1000 }
    ];

    const sub = subscribeMany(relays, filter, {
      onevent: (event: any) => {
        if (!event || event.kind !== 4) return;
        if (!validateEvent(event) || !verifyEvent(event)) return;
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
  }, [identity?.pubkey, limit, nip04, relays, streamId, streamPubkey]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!identity) return false;
      const text = content.trim();
      if (!text) return false;

      setIsSending(true);
      try {
        const createdAt = Math.floor(Date.now() / 1000);
        const unsigned = buildStreamChatEvent({
          pubkey: identity.pubkey,
          createdAt,
          streamPubkey,
          streamId,
          content: text
        }) as any;

        const signed = await signEvent(unsigned);
        const ok = await publishEvent(relays, signed);
        return ok;
      } finally {
        setIsSending(false);
      }
    },
    [identity, relays, signEvent, streamId, streamPubkey]
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

      setIsSending(true);
      try {
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
      } finally {
        setIsSending(false);
      }
    },
    [identity, limit, nip04, relays, signEvent, streamId, streamPubkey]
  );

  return {
    messages,
    isConnected,
    isSending,
    canSend: !!identity,
    canWhisper: !!identity && !!nip04,
    sendMessage,
    sendWhisper
  };
}
