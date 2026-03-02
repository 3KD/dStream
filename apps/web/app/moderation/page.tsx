"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Shield, ShieldCheck, Trash2, Volume2, VolumeX } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useIdentity } from "@/context/IdentityContext";
import { useStreamModeration } from "@/hooks/useStreamModeration";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";

const STREAM_ID_STORAGE_KEY = "dstream_moderation_stream_id_v1";

export default function ModerationPage() {
  const { identity, signEvent } = useIdentity();
  const [streamPubkey, setStreamPubkey] = useState("");
  const [streamId, setStreamId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!identity?.pubkey) return;
    setStreamPubkey(identity.pubkey);
  }, [identity?.pubkey]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STREAM_ID_STORAGE_KEY);
      if (saved) setStreamId(saved);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STREAM_ID_STORAGE_KEY, streamId);
    } catch {
      // ignore
    }
  }, [streamId]);

  const moderation = useStreamModeration({
    streamPubkey: streamPubkey.trim().toLowerCase(),
    streamId: streamId.trim(),
    identityPubkey: identity?.pubkey ?? null,
    signEvent
  });

  const participants = useMemo(() => {
    const set = new Set<string>();
    for (const pubkey of moderation.moderators) set.add(pubkey);
    for (const pubkey of moderation.subscribers) set.add(pubkey);
    for (const pubkey of moderation.remoteMuted) set.add(pubkey);
    for (const pubkey of moderation.remoteBlocked) set.add(pubkey);
    for (const pubkey of Object.keys(moderation.effectiveActionsByTarget)) set.add(pubkey);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [
    moderation.effectiveActionsByTarget,
    moderation.moderators,
    moderation.remoteBlocked,
    moderation.remoteMuted,
    moderation.subscribers
  ]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Moderation</h1>
            <p className="text-sm text-neutral-400">Manage relay-backed stream moderation actions and role assignments.</p>
          </div>
          <Link className="text-sm text-neutral-300 hover:text-white" href="/broadcast">
            Broadcast
          </Link>
        </header>

        {!identity ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300">
            Connect an identity to manage moderation.
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200">Stream Scope</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">Stream Pubkey</div>
                  <input
                    value={streamPubkey}
                    onChange={(e) => setStreamPubkey(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                    placeholder="64-hex pubkey"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">Stream ID</div>
                  <input
                    value={streamId}
                    onChange={(e) => setStreamId(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                    placeholder="live-20260210-2200"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-neutral-400">
                <span>Owner: {moderation.isOwner ? "yes" : "no"}</span>
                <span>Can moderate: {moderation.canModerate ? "yes" : "no"}</span>
                <span>Moderators: {moderation.moderators.size}</span>
                <span>Subscribers: {moderation.subscribers.size}</span>
                <span>Blocked: {moderation.remoteBlocked.size}</span>
                <span>Muted: {moderation.remoteMuted.size}</span>
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200">Participants</h2>
              {participants.length === 0 ? (
                <div className="text-sm text-neutral-500">No moderation records in scope yet.</div>
              ) : (
                <div className="space-y-2">
                  {participants.map((pubkey) => {
                    const npub = pubkeyHexToNpub(pubkey);
                    const label = shortenText(npub ?? pubkey, { head: 18, tail: 10 });
                    const isModerator = moderation.moderators.has(pubkey);
                    const isSubscriber = moderation.subscribers.has(pubkey);
                    const isMuted = moderation.remoteMuted.has(pubkey);
                    const isBlocked = moderation.remoteBlocked.has(pubkey);
                    return (
                      <div key={pubkey} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-200 font-mono truncate">{label}</div>
                          <div className="text-xs text-neutral-500 font-mono truncate">{pubkey}</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {isModerator && <span className="text-[10px] bg-blue-950/50 border border-blue-700/30 text-blue-200 px-1.5 py-0.5 rounded">MOD</span>}
                            {isSubscriber && <span className="text-[10px] bg-amber-950/50 border border-amber-700/30 text-amber-200 px-1.5 py-0.5 rounded">SUB</span>}
                            {isBlocked && <span className="text-[10px] bg-red-950/50 border border-red-700/30 text-red-200 px-1.5 py-0.5 rounded">BLOCKED</span>}
                            {isMuted && <span className="text-[10px] bg-neutral-950/50 border border-neutral-700/30 text-neutral-200 px-1.5 py-0.5 rounded">MUTED</span>}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {moderation.canModerate && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  void moderation.publishModerationAction(pubkey, isMuted ? "clear" : "mute").then((ok) => {
                                    setNotice(ok ? "Moderation action published." : "Failed to publish moderation action.");
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs inline-flex items-center gap-1.5"
                              >
                                {isMuted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                                {isMuted ? "Clear Mute" : "Mute"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void moderation.publishModerationAction(pubkey, isBlocked ? "clear" : "block").then((ok) => {
                                    setNotice(ok ? "Moderation action published." : "Failed to publish moderation action.");
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs inline-flex items-center gap-1.5"
                              >
                                {isBlocked ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                                {isBlocked ? "Clear Block" : "Block"}
                              </button>
                            </>
                          )}

                          {moderation.isOwner && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = isModerator ? "none" : "moderator";
                                  void moderation.publishModeratorRole(pubkey, next).then((ok) => {
                                    setNotice(ok ? "Role update published." : "Failed to publish role update.");
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs inline-flex items-center gap-1.5"
                              >
                                {isModerator ? <ShieldCheck className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                                {isModerator ? "Unset Mod" : "Set Mod"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = isSubscriber ? "none" : "subscriber";
                                  void moderation.publishModeratorRole(pubkey, next).then((ok) => {
                                    setNotice(ok ? "Role update published." : "Failed to publish role update.");
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                              >
                                {isSubscriber ? "Unset Sub" : "Set Sub"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {notice && <div className="text-xs text-neutral-300">{notice}</div>}
          </>
        )}
      </main>
    </div>
  );
}
