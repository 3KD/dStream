import { makeATag, NOSTR_KINDS } from "@dstream/protocol";
import { getNostrRelays } from "./config";
import { subscribeMany } from "./nostr";
import { verifyNostrEvent } from "./nostrWasm";
import { pubkeyParamToHex } from "./nostr-ids";
import { STREAM_CHAT_RECENT_LIMIT, STREAM_CHAT_RECENT_LOOKBACK_SEC } from "./chatHistory";

interface BootstrapListener {
  onevent: (event: unknown) => void;
  oneose: () => void;
}

export interface EagerChatBootstrap {
  streamPubkey: string;
  streamId: string;
  source: "pool" | "pre-hydration";
  attach: (listener: BootstrapListener) => () => void;
  close: () => void;
}

interface EagerChatBootstrapState extends EagerChatBootstrap {
  claimed: boolean;
}

type DStreamChatBootstrapGlobal = typeof globalThis & {
  __dstreamEagerChatBootstrap?: EagerChatBootstrapState | null;
  __dstreamPreHydrationChatBootstrap?: PreHydrationChatBootstrap | null;
};

export interface PreHydrationChatBootstrap {
  version: 1;
  streamPubkey: string;
  streamId: string;
  attach: (listener: BootstrapListener) => () => void;
  close: () => void;
}

const bootstrapGlobal = globalThis as DStreamChatBootstrapGlobal;

function readWatchScope(): { streamPubkey: string; streamId: string } | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/watch\/([^/]+)\/(.+)$/);
  if (!match) return null;

  let pubkeyParam = match[1] ?? "";
  let streamId = match[2] ?? "";
  try {
    pubkeyParam = decodeURIComponent(pubkeyParam);
    streamId = streamId
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  } catch {
    return null;
  }

  const streamPubkey = pubkeyParamToHex(pubkeyParam);
  if (!streamPubkey || !streamId) return null;
  return { streamPubkey, streamId };
}

function startEagerChatBootstrap(scope: { streamPubkey: string; streamId: string }): EagerChatBootstrapState {
  const bufferedEvents: unknown[] = [];
  const seenEventIds = new Set<string>();
  const listeners = new Set<BootstrapListener>();
  let eose = false;
  let closed = false;

  const sub = subscribeMany(
    getNostrRelays(),
    [
      {
        kinds: [NOSTR_KINDS.STREAM_CHAT, 1],
        "#a": [makeATag(scope.streamPubkey, scope.streamId)],
        since: Math.floor(Date.now() / 1000) - STREAM_CHAT_RECENT_LOOKBACK_SEC,
        limit: STREAM_CHAT_RECENT_LIMIT
      }
    ],
    {
      onevent: (event: any) => {
        if (closed) return;
        const id = typeof event?.id === "string" ? event.id : "";
        if (id && seenEventIds.has(id)) return;
        if (id) seenEventIds.add(id);
        bufferedEvents.push(event);
        if (bufferedEvents.length > STREAM_CHAT_RECENT_LIMIT) bufferedEvents.shift();
        for (const listener of listeners) listener.onevent(event);
      },
      oneose: () => {
        if (closed || eose) return;
        eose = true;
        for (const listener of listeners) listener.oneose();
      }
    }
  );

  const state: EagerChatBootstrapState = {
    ...scope,
    source: "pool",
    claimed: false,
    attach(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      for (const event of bufferedEvents) listener.onevent(event);
      if (eose) listener.oneose();
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      sub.close();
      if (bootstrapGlobal.__dstreamEagerChatBootstrap === state) {
        bootstrapGlobal.__dstreamEagerChatBootstrap = null;
      }
    }
  };

  return state;
}

export function createVerifiedPreHydrationChatBootstrap(
  scope: { streamPubkey: string; streamId: string },
  rawBootstrap: PreHydrationChatBootstrap,
  verifyEvent: (event: unknown) => Promise<boolean> = verifyNostrEvent
): EagerChatBootstrapState {
  const bufferedEvents: unknown[] = [];
  const seenEventIds = new Set<string>();
  const listeners = new Set<BootstrapListener>();
  let verificationQueue = Promise.resolve();
  let rawEose = false;
  let eose = false;
  let closed = false;
  let detachRaw: (() => void) | null = null;

  const emitEoseWhenReady = () => {
    if (closed || eose || !rawEose) return;
    verificationQueue.then(() => {
      if (closed || eose || !rawEose) return;
      eose = true;
      for (const listener of listeners) listener.oneose();
    });
  };

  const state: EagerChatBootstrapState = {
    ...scope,
    source: "pre-hydration",
    claimed: false,
    attach(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      for (const event of bufferedEvents) listener.onevent(event);
      if (eose) listener.oneose();
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      detachRaw?.();
      rawBootstrap.close();
      if (bootstrapGlobal.__dstreamEagerChatBootstrap === state) {
        bootstrapGlobal.__dstreamEagerChatBootstrap = null;
      }
    }
  };

  detachRaw = rawBootstrap.attach({
    onevent: (event) => {
      verificationQueue = verificationQueue.then(async () => {
        if (closed) return;
        let verified = false;
        try {
          verified = await verifyEvent(event);
        } catch {
          return;
        }
        if (closed || !verified) return;
        const id = typeof (event as { id?: unknown })?.id === "string" ? (event as { id: string }).id : "";
        if (id && seenEventIds.has(id)) return;
        if (id) seenEventIds.add(id);
        bufferedEvents.push(event);
        if (bufferedEvents.length > STREAM_CHAT_RECENT_LIMIT) bufferedEvents.shift();
        for (const listener of listeners) listener.onevent(event);
      });
      emitEoseWhenReady();
    },
    oneose: () => {
      rawEose = true;
      emitEoseWhenReady();
    }
  });

  return state;
}

function ensureEagerChatBootstrap(): EagerChatBootstrapState | null {
  const scope = readWatchScope();
  if (!scope) return null;
  const current = bootstrapGlobal.__dstreamEagerChatBootstrap;
  if (current && current.streamPubkey === scope.streamPubkey && current.streamId === scope.streamId) {
    return current;
  }
  current?.close();
  const rawBootstrap = bootstrapGlobal.__dstreamPreHydrationChatBootstrap;
  const next =
    rawBootstrap &&
    rawBootstrap.version === 1 &&
    rawBootstrap.streamPubkey === scope.streamPubkey &&
    rawBootstrap.streamId === scope.streamId
      ? createVerifiedPreHydrationChatBootstrap(scope, rawBootstrap)
      : startEagerChatBootstrap(scope);
  bootstrapGlobal.__dstreamEagerChatBootstrap = next;
  return next;
}

export function takeEagerChatBootstrap(streamPubkey: string, streamId: string): EagerChatBootstrap | null {
  const current = ensureEagerChatBootstrap();
  if (!current || current.claimed) return null;
  if (current.streamPubkey !== streamPubkey || current.streamId !== streamId) return null;
  current.claimed = true;
  return current;
}

ensureEagerChatBootstrap();
