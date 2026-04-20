"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useSocial } from "@/context/SocialContext";
import { parseStreamFavoriteKey } from "@/lib/social/store";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";

// Re-using the format helper from settings
function formatLabel(pubkeyHex: string, alias?: string | null) {
  const npub = pubkeyHexToNpub(pubkeyHex);
  const base = npub ? npub.substring(0, 14) + "..." + npub.substring(npub.length - 8) : pubkeyHex.substring(0, 14) + "..." + pubkeyHex.substring(pubkeyHex.length - 8);
  return alias ? `${alias} (${base})` : base;
}

export default function FollowingPage() {
  const social = useSocial();
  const [favoriteCreatorInput, setFavoriteCreatorInput] = useState("");
  const [favoriteCreatorError, setFavoriteCreatorError] = useState<string | null>(null);

  const favoriteStreams = useMemo(() => {
    return social.state.favorites.streams
      .map((k) => ({ k, parsed: parseStreamFavoriteKey(k) }))
      .filter((v) => !!v.parsed) as Array<{ k: string; parsed: { streamPubkeyHex: string; streamId: string } }>;
  }, [social.state.favorites.streams]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto p-8 space-y-8">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Following</h1>
            <p className="text-sm text-neutral-500">Your favorite creators and streams.</p>
          </div>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <div className="space-y-2">
            <div className="text-xs text-neutral-500">Add favorite creator manually</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={favoriteCreatorInput}
                onChange={(e) => setFavoriteCreatorInput(e.target.value)}
                placeholder="npub... or 64-hex"
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono text-neutral-200"
              />
              <button
                type="button"
                onClick={() => {
                  setFavoriteCreatorError(null);
                  const pk = pubkeyParamToHex(favoriteCreatorInput);
                  if (!pk) {
                    setFavoriteCreatorError("Invalid pubkey (expected npub... or 64-hex).");
                    return;
                  }
                  if (social.isFavoriteCreator(pk)) {
                    setFavoriteCreatorError("Already favorited.");
                    return;
                  }
                  social.toggleFavoriteCreator(pk);
                  setFavoriteCreatorInput("");
                }}
                className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm text-neutral-200"
              >
                Add
              </button>
            </div>
            {favoriteCreatorError && <div className="text-xs text-red-300">{favoriteCreatorError}</div>}
          </div>

          {social.state.favorites.creators.length === 0 && favoriteStreams.length === 0 ? (
            <div className="text-sm text-neutral-500 mt-4">No favorites yet. Favorite from Browse or Watch to see them here.</div>
          ) : (
            <div className="space-y-6 mt-4">
              {social.state.favorites.creators.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Creators</div>
                  <div className="flex flex-wrap gap-2">
                    {social.state.favorites.creators.map((pk) => (
                      <div key={pk} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-950 border border-neutral-800 text-xs text-neutral-200">
                        <span className="font-mono">{formatLabel(pk, social.getAlias(pk))}</span>
                        <button type="button" onClick={() => social.toggleFavoriteCreator(pk)} className="text-neutral-400 hover:text-white">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {favoriteStreams.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Saved Streams</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {favoriteStreams.map(({ k, parsed }) => (
                      <div
                        key={k}
                        className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 p-4"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-neutral-200 truncate">
                            {formatLabel(parsed.streamPubkeyHex, social.getAlias(parsed.streamPubkeyHex))}
                          </div>
                          <div className="text-xs font-mono text-neutral-500 mt-1 truncate">
                            {parsed.streamId}
                          </div>
                          <div className="text-xs text-blue-400 mt-2">
                            <Link
                              className="hover:text-blue-300"
                              href={`/watch/${pubkeyHexToNpub(parsed.streamPubkeyHex) ?? parsed.streamPubkeyHex}/${parsed.streamId}`}
                            >
                              Go to Watch Page
                            </Link>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => social.toggleFavoriteStream(parsed.streamPubkeyHex, parsed.streamId)}
                          className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-800"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
