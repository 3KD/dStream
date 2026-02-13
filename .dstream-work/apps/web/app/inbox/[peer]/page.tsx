"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Shield, ShieldOff, Ban, CheckCircle2, Volume2, VolumeX } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { ChatInput } from "@/components/chat/ChatInput";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { useDmInbox } from "@/hooks/useDmInbox";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";

export default function InboxThreadPage() {
  const params = useParams<Record<string, string | string[]>>();
  const peerParamRaw = params?.peer;
  const peerParam = typeof peerParamRaw === "string" ? peerParamRaw : Array.isArray(peerParamRaw) ? peerParamRaw[0] ?? "" : "";
  const peerHex = useMemo(() => pubkeyParamToHex(peerParam), [peerParam]);

  const { identity, nip04 } = useIdentity();
  const social = useSocial();
  const { messages, readState, markThreadRead, sendDm, canUseDm } = useDmInbox();

  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const threadMessages = useMemo(() => {
    if (!peerHex) return [];
    return messages.filter((m) => m.peerPubkey === peerHex).sort((a, b) => a.createdAt - b.createdAt);
  }, [messages, peerHex]);

  const lastInboundAt = useMemo(() => {
    let max = 0;
    for (const m of threadMessages) {
      if (m.direction !== "in") continue;
      if (m.createdAt > max) max = m.createdAt;
    }
    return max;
  }, [threadMessages]);

  useEffect(() => {
    if (!peerHex) return;
    const current = readState[peerHex] ?? 0;
    if (lastInboundAt > current) markThreadRead(peerHex, lastInboundAt);
  }, [lastInboundAt, markThreadRead, peerHex, readState]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [threadMessages.length]);

  const alias = peerHex ? social.getAlias(peerHex) : null;
  const trusted = peerHex ? social.isTrusted(peerHex) : false;
  const muted = peerHex ? social.isMuted(peerHex) : false;
  const blocked = peerHex ? social.isBlocked(peerHex) : false;
  const npub = peerHex ? pubkeyHexToNpub(peerHex) : null;
  const peerLabel = alias ?? (npub ? shortenText(npub, { head: 18, tail: 10 }) : peerHex ? shortenText(peerHex, { head: 18, tail: 10 }) : peerParam);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <Link href="/inbox" className="inline-flex items-center gap-2 text-sm text-neutral-300 hover:text-white">
              <ArrowLeft className="w-4 h-4" />
              Inbox
            </Link>
            <h1 className="text-2xl font-bold">{peerLabel}</h1>
            {alias && peerHex && (
              <div className="text-xs text-neutral-500 font-mono">
                {shortenText(npub ?? peerHex, { head: 22, tail: 12 })}
              </div>
            )}
          </div>

          {peerHex && (
            <div className="flex flex-wrap items-center gap-2">
              {trusted ? (
                <button
                  type="button"
                  onClick={() => social.removeTrusted(peerHex)}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
                >
                  <ShieldOff className="w-4 h-4" />
                  Untrust
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => social.addTrusted(peerHex)}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
                >
                  <Shield className="w-4 h-4" />
                  Trust
                </button>
              )}

              {muted ? (
                <button
                  type="button"
                  onClick={() => social.removeMuted(peerHex)}
                  className="px-3 py-1.5 rounded-lg bg-neutral-950/60 hover:bg-neutral-950/80 border border-neutral-700 text-xs text-neutral-200 inline-flex items-center gap-2"
                >
                  <Volume2 className="w-4 h-4" />
                  Unmute
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => social.addMuted(peerHex)}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
                >
                  <VolumeX className="w-4 h-4" />
                  Mute
                </button>
              )}

              {blocked ? (
                <button
                  type="button"
                  onClick={() => social.removeBlocked(peerHex)}
                  className="px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-950/60 border border-red-800/40 text-xs text-red-200 inline-flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Unblock
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => social.addBlocked(peerHex)}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
                >
                  <Ban className="w-4 h-4" />
                  Block
                </button>
              )}
            </div>
          )}
        </header>

        {!peerHex ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300 space-y-2">
            <div className="font-semibold text-neutral-200">Invalid peer</div>
            <div className="text-neutral-400">Expected an `npub…` or 64-hex pubkey in the URL.</div>
            <Link href="/inbox" className="text-blue-300 hover:text-blue-200 text-sm">
              Back to Inbox
            </Link>
          </div>
        ) : !identity ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300">
            Connect an identity to view and send DMs.
          </div>
        ) : !nip04 ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300">
            NIP-04 is unavailable for your identity provider.
          </div>
        ) : (
          <div className="flex flex-col h-[72vh] bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
            {blocked && (
              <div className="px-4 py-3 border-b border-neutral-800 bg-red-950/30 text-sm text-red-200">
                This peer is blocked. Unblock to send messages.
              </div>
            )}
            {!blocked && muted && (
              <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-950/40 text-sm text-neutral-200">
                This peer is muted. Muted peers are hidden from the inbox list by default.
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
              {threadMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-neutral-500 text-sm">No messages yet</div>
              ) : (
                <div className="py-4 space-y-2">
                  {threadMessages.map((m) => {
                    const time = new Date(m.createdAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    const isOut = m.direction === "out";
                    return (
                      <div key={m.id} className={`px-4 flex ${isOut ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2 border ${
                            isOut
                              ? "bg-blue-600/15 border-blue-500/30 text-blue-100"
                              : "bg-neutral-950/40 border-neutral-800 text-neutral-200"
                          }`}
                        >
                          <div className="text-sm whitespace-pre-wrap break-words">{m.content}</div>
                          <div className="mt-1 text-[10px] text-neutral-400 text-right">{time}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {sendError && <div className="px-4 py-2 text-sm text-red-300 border-t border-neutral-800">{sendError}</div>}

            {!canUseDm ? (
              <div className="p-3 border-t border-neutral-800 bg-neutral-900 text-center text-sm text-neutral-500">
                Connect an identity with NIP-04 to send DMs.
              </div>
            ) : (
              <ChatInput
                placeholder={blocked ? "Unblock to send…" : "Send a DM…"}
                disabled={blocked}
                onSend={async (text) => {
                  setSendError(null);
                  const ok = await sendDm(peerHex, text);
                  if (!ok) setSendError("Failed to publish DM to relays.");
                  return ok;
                }}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
