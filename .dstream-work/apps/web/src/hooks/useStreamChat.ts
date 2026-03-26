"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { validateEvent, verifyEvent } from "nostr-tools";
import {
  buildStreamChatEvent,
  makeATag,
  NOSTR_KINDS,
  parseStreamAnnounceEvent,
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

export interface StreamChatFeedMessage extends StreamChatMessage {
  visibility: "public" | "whisper";
  whisperRecipients?: string[];
}

const STREAM_CHAT_HISTORY_LOOKBACK_SEC = 30 * 24 * 60 * 60;
const STREAM_CHAT_HISTORY_LIMIT = 2_000;
const STREAM_CHAT_ANNOUNCE_LOOKBACK_SEC = 90 * 24 * 60 * 60;
const STREAM_CHAT_ANNOUNCE_LIMIT = 2_000;
const STREAM_CHAT_RELATED_STREAM_LIMIT = 64;
const STREAM_CHAT_HISTORY_TIMEOUT_MS = 5_000;
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
  if (!validateEvent(event) || !verifyEvent(event)) return null;

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

export function useStreamChat(scope: { streamPubkey: string; streamId: string; limit?: number }) {
  const { identity, nip04, signEvent } = useIdentity();
  const [messages, setMessages] = useState<StreamChatFeedMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [chatATags, setChatATags] = useState<string[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  const relays = useMemo(() => getNostrRelays(), []);
  const streamPubkey = scope.streamPubkey.trim().toLowerCase();
  const streamId = scope.streamId;
  const limit = scope.limit ?? 200;
  const streamScopeKey = `${streamPubkey}:${streamId}`;
  const chatATagsSet = useMemo(() => new Set(chatATags), [chatATags]);
  const chatATagsKey = useMemo(() => chatATags.join("|"), [chatATags]);

  useEffect(() => {
    if (!streamPubkey || !streamId) {
      setChatATags([]);
      return;
    }

    const streamByCreatedAt = new Map<string, number>();
    streamByCreatedAt.set(streamId, nowSec());

    const currentATag = makeATag(streamPubkey, streamId);
    setChatATags([currentATag]);

    let done = false;
    let cancelled = false;

    const finalize = () => {
      if (done || cancelled) return;
      done = true;
      const streamIds = Array.from(streamByCreatedAt.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([value]) => value)
        .slice(0, STREAM_CHAT_RELATED_STREAM_LIMIT);
      setChatATags(streamIds.map((value) => makeATag(streamPubkey, value)));
    };

    const filter: Filter = {
      kinds: [NOSTR_KINDS.STREAM_ANNOUNCE],
      authors: [streamPubkey],
      since: nowSec() - STREAM_CHAT_ANNOUNCE_LOOKBACK_SEC,
      limit: STREAM_CHAT_ANNOUNCE_LIMIT
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseStreamAnnounceEvent(event);
        if (!parsed || parsed.pubkey !== streamPubkey) return;
        const prevCreatedAt = streamByCreatedAt.get(parsed.streamId);
        if (!prevCreatedAt || parsed.createdAt > prevCreatedAt) {
          streamByCreatedAt.set(parsed.streamId, parsed.createdAt);
        }
      },
      oneose: finalize
    });

    const timeout = setTimeout(finalize, STREAM_CHAT_HISTORY_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [relays, streamScopeKey, streamId, streamPubkey]);

  useEffect(() => {
    if (!streamPubkey || !streamId) return;
    if (chatATags.length === 0) return;

    setMessages([]);
    setIsConnected(false);
    seenIds.current.clear();

    const filter: Filter = {
      kinds: PUBLIC_CHAT_KINDS,
      "#a": chatATags,
      since: Math.floor(Date.now() / 1000) - STREAM_CHAT_HISTORY_LOOKBACK_SEC,
      limit: STREAM_CHAT_HISTORY_LIMIT
    };

    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        if (event?.id && seenIds.current.has(event.id)) return;
        const parsed = parsePublicChatMessage(event, chatATagsSet, streamPubkey);
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
  }, [chatATagsKey, chatATagsSet, limit, relays, streamId, streamPubkey]);

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
        if (ok) {
          seenIds.current.add(signed.id);
          const optimistic: StreamChatFeedMessage = {
            id: signed.id,
            pubkey: identity.pubkey.toLowerCase(),
            streamPubkey,
            streamId,
            content: text,
            createdAt,
            raw: signed as NostrEvent,
            visibility: "public"
          };
          setMessages((prev) => appendMessageWithLimit(prev, optimistic, limit));
        }
        return ok;
      } finally {
        setIsSending(false);
      }
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
