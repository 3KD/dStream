"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useSocial } from "@/context/SocialContext";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";

function formatPubkeyLabel(pubkeyHex: string, alias?: string | null) {
  const npub = pubkeyHexToNpub(pubkeyHex);
  const base = npub ? shortenText(npub, { head: 14, tail: 8 }) : shortenText(pubkeyHex, { head: 14, tail: 8 });
  return alias ? `${alias} (${base})` : base;
}

export function TrustAndBlocksManager() {
  const social = useSocial();

  const [trustedInput, setTrustedInput] = useState("");
  const [trustedError, setTrustedError] = useState<string | null>(null);

  const [mutedInput, setMutedInput] = useState("");
  const [mutedError, setMutedError] = useState<string | null>(null);

  const [blockedInput, setBlockedInput] = useState("");
  const [blockedError, setBlockedError] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
      <h2 className="text-sm font-semibold text-neutral-200">Trust &amp; Blocks</h2>

      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <div className="text-xs text-neutral-500">Trusted peers</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={trustedInput}
              onChange={(e) => setTrustedInput(e.target.value)}
              placeholder="npub… or 64-hex"
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono text-neutral-200"
            />
            <button
              type="button"
              onClick={() => {
                setTrustedError(null);
                const res = social.addTrusted(trustedInput);
                if (!res.ok) setTrustedError(res.error);
                else setTrustedInput("");
              }}
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm text-neutral-200"
            >
              Add
            </button>
          </div>
          {trustedError && <div className="text-xs text-red-300">{trustedError}</div>}

          {social.state.trustedPubkeys.length === 0 ? (
            <div className="text-sm text-neutral-500">No trusted peers yet.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {social.state.trustedPubkeys.map((pk) => (
                <div key={pk} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-950 border border-neutral-800 text-xs text-neutral-200">
                  <span className="font-mono">{formatPubkeyLabel(pk, social.getAlias(pk))}</span>
                  <button type="button" onClick={() => social.removeTrusted(pk)} className="text-neutral-400 hover:text-white">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs text-neutral-500">Muted (chat/inbox filtering)</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={mutedInput}
              onChange={(e) => setMutedInput(e.target.value)}
              placeholder="npub… or 64-hex"
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono text-neutral-200"
            />
            <button
              type="button"
              onClick={() => {
                setMutedError(null);
                const res = social.addMuted(mutedInput);
                if (!res.ok) setMutedError(res.error);
                else setMutedInput("");
              }}
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm text-neutral-200"
            >
              Add
            </button>
          </div>
          {mutedError && <div className="text-xs text-red-300">{mutedError}</div>}

          {social.state.mutedPubkeys.length === 0 ? (
            <div className="text-sm text-neutral-500">No muted pubkeys.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {social.state.mutedPubkeys.map((pk) => (
                <div key={pk} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-950 border border-neutral-800 text-xs text-neutral-200">
                  <span className="font-mono">{formatPubkeyLabel(pk, social.getAlias(pk))}</span>
                  <button type="button" onClick={() => social.removeMuted(pk)} className="text-neutral-400 hover:text-white">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs text-neutral-500">Blocked (hide + exclude from P2P)</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={blockedInput}
              onChange={(e) => setBlockedInput(e.target.value)}
              placeholder="npub… or 64-hex"
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono text-neutral-200"
            />
            <button
              type="button"
              onClick={() => {
                setBlockedError(null);
                const res = social.addBlocked(blockedInput);
                if (!res.ok) setBlockedError(res.error);
                else setBlockedInput("");
              }}
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm text-neutral-200"
            >
              Add
            </button>
          </div>
          {blockedError && <div className="text-xs text-red-300">{blockedError}</div>}

          {social.state.blockedPubkeys.length === 0 ? (
            <div className="text-sm text-neutral-500">No blocked pubkeys.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {social.state.blockedPubkeys.map((pk) => (
                <div key={pk} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-950 border border-neutral-800 text-xs text-neutral-200">
                  <span className="font-mono">{formatPubkeyLabel(pk, social.getAlias(pk))}</span>
                  <button type="button" onClick={() => social.removeBlocked(pk)} className="text-neutral-400 hover:text-white">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
