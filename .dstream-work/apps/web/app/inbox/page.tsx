"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Mail, Search } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { useDmInbox } from "@/hooks/useDmInbox";
import { buildDmThreadSummaries } from "@/lib/inbox/dm";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";

export default function InboxPage() {
  const router = useRouter();
  const { identity, nip04 } = useIdentity();
  const social = useSocial();
  const { messages, readState, status, canUseDm } = useDmInbox();

  const [peerInput, setPeerInput] = useState("");
  const [peerError, setPeerError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [trustedOnly, setTrustedOnly] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showMuted, setShowMuted] = useState(false);

  const threads = useMemo(() => buildDmThreadSummaries(messages, readState), [messages, readState]);

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads.filter((t) => {
      if (!showBlocked && social.isBlocked(t.peerPubkey)) return false;
      if (!showMuted && social.isMuted(t.peerPubkey)) return false;
      if (trustedOnly && !social.isTrusted(t.peerPubkey)) return false;

      if (!q) return true;
      const alias = social.getAlias(t.peerPubkey)?.toLowerCase() ?? "";
      const npub = pubkeyHexToNpub(t.peerPubkey)?.toLowerCase() ?? "";
      const hex = t.peerPubkey.toLowerCase();
      return alias.includes(q) || npub.includes(q) || hex.includes(q);
    });
  }, [search, showBlocked, showMuted, social, threads, trustedOnly]);

  const blockedThreadCount = useMemo(() => threads.filter((t) => social.isBlocked(t.peerPubkey)).length, [social, threads]);
  const mutedThreadCount = useMemo(() => threads.filter((t) => social.isMuted(t.peerPubkey)).length, [social, threads]);

  const openThread = () => {
    setPeerError(null);
    const peerHex = pubkeyParamToHex(peerInput);
    if (!peerHex) {
      setPeerError("Enter a valid npub… or 64-hex pubkey.");
      return;
    }
    const peerParam = pubkeyHexToNpub(peerHex) ?? peerHex;
    router.push(`/inbox/${peerParam}`);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Mail className="w-6 h-6 text-blue-500" />
              Inbox
            </h1>
            <p className="text-sm text-neutral-400">NIP-04 direct messages (kind 4) on configured Nostr relays.</p>
          </div>
          <Link className="text-sm text-neutral-300 hover:text-white" href="/">
            Home
          </Link>
        </header>

        {!identity ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300">
            Connect an identity to view and send DMs.
          </div>
        ) : !nip04 ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300 space-y-2">
            <div className="font-semibold text-neutral-200">NIP-04 unavailable</div>
            <div className="text-neutral-400">
              Your identity provider doesn’t expose NIP-04 encryption/decryption. Use a NIP-07 extension that supports
              NIP-04, or generate a local dev identity.
            </div>
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-neutral-200 font-semibold">Start a conversation</div>
                <div className="text-xs text-neutral-400 flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      status === "connected" ? "bg-emerald-400" : status === "connecting" ? "bg-blue-400" : "bg-neutral-600"
                    }`}
                    title={status}
                  />
                  {status}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  value={peerInput}
                  onChange={(e) => setPeerInput(e.target.value)}
                  placeholder="npub… or 64-hex pubkey"
                  className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={openThread}
                  disabled={!canUseDm}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-bold disabled:opacity-50"
                >
                  Open
                </button>
              </div>
              {peerError && <div className="text-sm text-red-300">{peerError}</div>}
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 min-w-[240px]">
                    <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by alias, npub, or hex…"
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <label className="text-xs text-neutral-300 inline-flex items-center gap-2 select-none">
                    <input type="checkbox" checked={trustedOnly} onChange={(e) => setTrustedOnly(e.target.checked)} />
                    Trusted only
                  </label>
                  {blockedThreadCount > 0 && (
                    <label className="text-xs text-neutral-300 inline-flex items-center gap-2 select-none">
                      <input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} />
                      Show blocked ({blockedThreadCount})
                    </label>
                  )}
                  {mutedThreadCount > 0 && (
                    <label className="text-xs text-neutral-300 inline-flex items-center gap-2 select-none">
                      <input type="checkbox" checked={showMuted} onChange={(e) => setShowMuted(e.target.checked)} />
                      Show muted ({mutedThreadCount})
                    </label>
                  )}
                </div>
                <div className="text-xs text-neutral-500">{filteredThreads.length} threads</div>
              </div>

              {filteredThreads.length === 0 ? (
                <div className="text-sm text-neutral-500 py-8 text-center">No DMs yet.</div>
              ) : (
                <div className="divide-y divide-neutral-800">
                  {filteredThreads.map((t) => {
                    const alias = social.getAlias(t.peerPubkey);
                    const trusted = social.isTrusted(t.peerPubkey);
                    const muted = social.isMuted(t.peerPubkey);
                    const blocked = social.isBlocked(t.peerPubkey);
                    const npub = pubkeyHexToNpub(t.peerPubkey);
                    const label =
                      alias ?? (npub ? shortenText(npub, { head: 16, tail: 10 }) : shortenText(t.peerPubkey, { head: 16, tail: 10 }));
                    const peerParam = npub ?? t.peerPubkey;

                    const preview = t.lastMessagePreview.replace(/\s+/g, " ").trim();
                    const previewShort = preview ? shortenText(preview, { head: 90, tail: 0 }) : "…";
                    const time = new Date(t.lastMessageAt * 1000).toLocaleString([], {
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit"
                    });

                    return (
                      <Link
                        key={t.peerPubkey}
                        href={`/inbox/${peerParam}`}
                        className="block px-3 py-3 hover:bg-neutral-800/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="font-semibold text-neutral-100 truncate">{label}</div>
                              {trusted && (
                                <span className="text-[10px] bg-emerald-950/50 border border-emerald-700/30 text-emerald-200 px-1.5 py-0.5 rounded">
                                  TRUSTED
                                </span>
                              )}
                              {blocked && (
                                <span className="text-[10px] bg-red-950/40 border border-red-700/30 text-red-200 px-1.5 py-0.5 rounded">
                                  BLOCKED
                                </span>
                              )}
                              {muted && (
                                <span className="text-[10px] bg-neutral-950/40 border border-neutral-700/30 text-neutral-200 px-1.5 py-0.5 rounded">
                                  MUTED
                                </span>
                              )}
                              {alias && (
                                <span className="text-[10px] text-neutral-500 font-mono truncate">
                                  {shortenText(peerParam, { head: 18, tail: 8 })}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-neutral-400 truncate">{previewShort}</div>
                          </div>

                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <div className="text-xs text-neutral-500">{time}</div>
                            {t.unreadCount > 0 && (
                              <span className="text-xs bg-blue-600/20 border border-blue-500/30 text-blue-200 px-2 py-0.5 rounded-full font-semibold">
                                {t.unreadCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
