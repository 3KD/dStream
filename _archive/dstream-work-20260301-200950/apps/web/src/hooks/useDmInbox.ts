"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter } from "nostr-tools";
import { validateEvent, verifyEvent } from "nostr-tools";
import { useIdentity } from "@/context/IdentityContext";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";
import { publishEvent } from "@/lib/publish";
import { getDmDirection, getDmPeerPubkey, getDmRecipientPubkey, type DmMessage, type DmThreadReadState } from "@/lib/inbox/dm";

type InboxStatus = "idle" | "connecting" | "connected";

const READ_STATE_KEY = "dstream_inbox_reads_v1";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function normalizeMaybeHexPubkey(input: string | null | undefined): string {
  const raw = (input ?? "").trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) return raw.toLowerCase();
  return raw;
}

function readReadState(): DmThreadReadState {
  try {
    const raw = localStorage.getItem(READ_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const next: DmThreadReadState = {};
    for (const [k, v] of Object.entries(parsed as any)) {
      const pk = normalizeMaybeHexPubkey(k);
      const ts = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
      if (!pk || ts <= 0) continue;
      next[pk] = ts;
    }
    return next;
  } catch {
    return {};
  }
}

function writeReadState(next: DmThreadReadState) {
  try {
    localStorage.setItem(READ_STATE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function useDmInbox(opts?: { sinceSec?: number; limit?: number }) {
  const { identity, nip04, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);

  const [status, setStatus] = useState<InboxStatus>("idle");
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [readState, setReadState] = useState<DmThreadReadState>({});
  const [isSending, setIsSending] = useState(false);

  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setReadState(readReadState());
  }, []);

  const markThreadRead = useCallback((peerPubkeyInput: string, createdAt: number) => {
    const peerPubkey = normalizeMaybeHexPubkey(peerPubkeyInput);
    const ts = Math.floor(createdAt);
    if (!peerPubkey || !Number.isFinite(ts) || ts <= 0) return;

    setReadState((prev) => {
      const current = prev[peerPubkey] ?? 0;
      const nextTs = Math.max(current, ts);
      if (nextTs === current) return prev;
      const next = { ...prev, [peerPubkey]: nextTs };
      writeReadState(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!identity?.pubkey || !nip04) {
      setStatus("idle");
      setMessages([]);
      seenIdsRef.current = new Set();
      return;
    }

    setStatus("connecting");
    setMessages([]);
    seenIdsRef.current = new Set();

    const since = opts?.sinceSec ?? nowSec() - 30 * 24 * 3600;
    const limit = opts?.limit ?? 2000;

    const filters: Filter[] = [
      { kinds: [4], "#p": [identity.pubkey], since, limit },
      { kinds: [4], authors: [identity.pubkey], since, limit }
    ];

    const sub = subscribeMany(relays, filters, {
      onevent: (event: any) => {
        if (!event || typeof event !== "object") return;
        if (event.kind !== 4) return;
        if (typeof event.pubkey !== "string" || typeof event.content !== "string") return;
        if (typeof event.created_at !== "number") return;
        if (typeof event.id === "string" && seenIdsRef.current.has(event.id)) return;
        if (!validateEvent(event) || !verifyEvent(event)) return;

        const peerPubkey = getDmPeerPubkey(event, identity.pubkey);
        const direction = getDmDirection(event, identity.pubkey);
        const recipientPubkey = getDmRecipientPubkey(event);
        if (!peerPubkey || !direction || !recipientPubkey) return;

        const id = typeof event.id === "string" ? event.id : `${event.pubkey}:${event.created_at}:${Math.random()}`;
        seenIdsRef.current.add(id);

        void (async () => {
          let plaintext = "";
          try {
            plaintext = await nip04.decrypt(peerPubkey, event.content);
          } catch {
            plaintext = "[Unable to decrypt]";
          }

          const senderPubkey = normalizeMaybeHexPubkey(event.pubkey);
          const msg: DmMessage = {
            id,
            peerPubkey,
            senderPubkey: senderPubkey || event.pubkey,
            recipientPubkey,
            createdAt: Math.floor(event.created_at),
            direction,
            content: plaintext
          };

          setMessages((prev) => {
            if (prev.some((m) => m.id === id)) return prev;
            const next = [...prev, msg].sort((a, b) => a.createdAt - b.createdAt);
            return next.slice(-limit);
          });
        })();
      },
      oneose: () => setStatus("connected")
    });

    return () => {
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
      setStatus("idle");
    };
  }, [identity?.pubkey, nip04, opts?.limit, opts?.sinceSec, relays]);

  const sendDm = useCallback(
    async (peerPubkeyInput: string, contentRaw: string) => {
      if (!identity || !nip04) return false;
      const peerPubkey = normalizeMaybeHexPubkey(peerPubkeyInput);
      if (!/^[a-f0-9]{64}$/.test(peerPubkey)) return false;
      const content = (contentRaw ?? "").trim();
      if (!content) return false;

      setIsSending(true);
      try {
        const ciphertext = await nip04.encrypt(peerPubkey, content);
        const unsigned: any = {
          kind: 4,
          created_at: nowSec(),
          pubkey: identity.pubkey,
          tags: [["p", peerPubkey]],
          content: ciphertext
        };

        const signed = await signEvent(unsigned);
        const ok = await publishEvent(relays, signed);
        if (!ok) return false;

        // Optimistically append plaintext so the UI updates instantly.
        seenIdsRef.current.add(signed.id);
        const msg: DmMessage = {
          id: signed.id,
          peerPubkey,
          senderPubkey: identity.pubkey,
          recipientPubkey: peerPubkey,
          createdAt: signed.created_at,
          direction: "out",
          content
        };
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          const next = [...prev, msg].sort((a, b) => a.createdAt - b.createdAt);
          return next.slice(-2000);
        });

        return true;
      } finally {
        setIsSending(false);
      }
    },
    [identity, nip04, relays, signEvent]
  );

  return {
    status,
    messages,
    readState,
    markThreadRead,
    sendDm,
    canUseDm: !!identity && !!nip04,
    isSending
  };
}

