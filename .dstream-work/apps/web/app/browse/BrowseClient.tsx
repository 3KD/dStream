"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useStreamAnnounces } from "@/hooks/useStreamAnnounces";
import { useGuild } from "@/hooks/useGuild";
import { useGuilds } from "@/hooks/useGuilds";
import { makeStreamKey } from "@dstream/protocol";
import { Star } from "lucide-react";
import { useSocial } from "@/context/SocialContext";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";
import { useEffect, useMemo, useState } from "react";
import { LiveStreamPreview } from "@/components/stream/LiveStreamPreview";

function parseGuildQuery(value: string | null): { pubkeyParam: string; guildId: string } | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const first = raw.indexOf(":");
  if (first < 0) return null;
  const pubkeyParam = raw.slice(0, first).trim();
  const guildId = raw.slice(first + 1).trim();
  if (!pubkeyParam || !guildId) return null;
  return { pubkeyParam, guildId };
}

export default function BrowseClient() {
  const social = useSocial();
  const searchParams = useSearchParams();
  const guildQueryRaw = searchParams.get("guild");
  const guildQuery = useMemo(() => parseGuildQuery(guildQueryRaw), [guildQueryRaw]);
  const guildPubkeyHex = useMemo(() => (guildQuery ? pubkeyParamToHex(guildQuery.pubkeyParam) : null), [guildQuery]);
  const { streams, isLoading } = useStreamAnnounces({ liveOnly: true, limit: 120 });
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [curatedOnly, setCuratedOnly] = useState(false);

  useEffect(() => {
    if (guildQuery) setCuratedOnly(true);
  }, [guildQuery]);

  const { guilds, isLoading: guildsLoading } = useGuilds({ limit: 80 });
  const { guild: selectedGuild, isLoading: selectedGuildLoading } = useGuild({
    pubkey: guildPubkeyHex ?? "",
    guildId: guildQuery?.guildId ?? ""
  });

  const curatedKeys = useMemo(() => {
    const keys = new Set<string>();
    const refs = selectedGuild ? selectedGuild.featuredStreams : guilds.flatMap((g) => g.featuredStreams);
    for (const r of refs) keys.add(makeStreamKey(r.streamPubkey, r.streamId));
    return keys;
  }, [guilds, selectedGuild]);

  const visibleStreams = useMemo(() => {
    const base = streams.filter((s) => !social.isBlocked(s.pubkey));
    const favFiltered = favoritesOnly
      ? base.filter((s) => social.isFavoriteCreator(s.pubkey) || social.isFavoriteStream(s.pubkey, s.streamId))
      : base;
    if (!curatedOnly) return favFiltered;
    return favFiltered.filter((s) => curatedKeys.has(makeStreamKey(s.pubkey, s.streamId)));
  }, [curatedKeys, curatedOnly, favoritesOnly, social, streams]);

  const curatedLabel = !guildQuery
    ? "Curated only"
    : selectedGuild?.name
      ? `Curated: ${selectedGuild.name}`
      : guildQuery.guildId
        ? `Curated: ${guildQuery.guildId}`
        : "Curated only";

  const curatedInfo = useMemo(() => {
    if (!curatedOnly) return null;
    if (guildQuery) {
      const href = `/guilds/${encodeURIComponent(guildQuery.pubkeyParam)}/${encodeURIComponent(guildQuery.guildId)}`;
      return (
        <div className="text-xs text-neutral-500">
          Source:{" "}
          <Link href={href} className="text-neutral-300 hover:text-white">
            {selectedGuild?.name ?? guildQuery.guildId}
          </Link>
          {selectedGuildLoading && <span className="text-neutral-600"> (loading…)</span>}
        </div>
      );
    }
    if (guildsLoading) return <div className="text-xs text-neutral-600">Loading guilds…</div>;
    return <div className="text-xs text-neutral-500">Curated by {guilds.length} guild(s).</div>;
  }, [curatedOnly, guildQuery, guilds.length, guildsLoading, selectedGuild?.name, selectedGuildLoading]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto p-8 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Browse</h1>
          <div className="flex items-center gap-4">
            <label className="text-xs text-neutral-400 inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(e) => setFavoritesOnly(e.target.checked)}
                className="accent-blue-500"
              />
              Favorites only
            </label>
            <label className="text-xs text-neutral-400 inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={curatedOnly}
                onChange={(e) => setCuratedOnly(e.target.checked)}
                className="accent-blue-500"
              />
              {curatedLabel}
            </label>
            <Link className="text-sm text-neutral-300 hover:text-white" href="/guilds">
              Guilds
            </Link>
            <Link className="text-sm text-neutral-300 hover:text-white" href="/">
              Home
            </Link>
          </div>
        </header>

        {curatedInfo}

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="aspect-video bg-neutral-900 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : visibleStreams.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 p-8 text-neutral-400 text-center">
            {favoritesOnly && curatedOnly
              ? "No favorite curated streams are live right now."
              : favoritesOnly
                ? "No favorite streams are live right now."
                : curatedOnly
                  ? "No curated streams are live right now."
                  : "No live streams found."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visibleStreams.map((s, index) => {
              const alias = social.getAlias(s.pubkey);
              const npub = pubkeyHexToNpub(s.pubkey);
              const pubkeyParam = npub ?? s.pubkey;
              const pubkeyLabel = npub
                ? shortenText(npub, { head: 14, tail: 8 })
                : shortenText(s.pubkey, { head: 14, tail: 8 });
              const favorite = social.isFavoriteCreator(s.pubkey) || social.isFavoriteStream(s.pubkey, s.streamId);

              return (
                <Link
                  href={`/watch/${pubkeyParam}/${s.streamId}`}
                  key={`${s.pubkey}:${s.streamId}`}
                  className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition"
                >
                  <div className="aspect-video bg-neutral-800 flex items-center justify-center relative">
                    <LiveStreamPreview
                      streamPubkey={s.pubkey}
                      streamId={s.streamId}
                      title={s.title || "Live stream preview"}
                      fallbackImage={s.image}
                      enabled={index < 16}
                    />
                    <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                      Live
                    </div>
                    {s.stakeAmountAtomic && s.stakeAmountAtomic !== "0" && (
                      <div className="absolute top-2 right-2 bg-neutral-950/70 border border-neutral-700 text-neutral-200 text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                        Stake
                      </div>
                    )}
                  </div>
                  <div className="p-4 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-bold text-base line-clamp-1 min-w-0">{s.title || "Untitled Stream"}</h3>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          social.toggleFavoriteStream(s.pubkey, s.streamId);
                        }}
                        className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl bg-neutral-950/40 hover:bg-neutral-950/70 border border-neutral-800 text-neutral-200"
                        title={favorite ? "Unfavorite" : "Favorite"}
                        aria-label={favorite ? "Unfavorite stream" : "Favorite stream"}
                      >
                        <Star className={`w-4 h-4 ${favorite ? "fill-yellow-400 text-yellow-400" : "text-neutral-400"}`} />
                      </button>
                    </div>
                    <p className="text-xs text-neutral-500 font-mono">
                      {alias ? (
                        <>
                          <span className="text-neutral-300">{alias}</span>{" "}
                          <span className="text-neutral-600">({pubkeyLabel})</span>
                        </>
                      ) : (
                        pubkeyLabel
                      )}
                    </p>
                    {(social.isTrusted(s.pubkey) || social.isFavoriteCreator(s.pubkey)) && (
                      <div className="flex items-center gap-2">
                        {social.isTrusted(s.pubkey) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/50 border border-emerald-700/30 text-emerald-200">
                            Trusted
                          </span>
                        )}
                        {social.isFavoriteCreator(s.pubkey) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-950/40 border border-yellow-700/20 text-yellow-200">
                            Favorite creator
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
