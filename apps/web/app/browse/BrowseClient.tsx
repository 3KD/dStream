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
import { formatXmrAtomic, resolveVodPolicy, vodModeLabel } from "@/lib/vodPolicy";

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
  const { streams: liveStreams, isLoading: liveLoading } = useStreamAnnounces({ liveOnly: true, limit: 180 });
  const { streams: allStreams, isLoading: archiveLoading } = useStreamAnnounces({ liveOnly: false, limit: 260 });
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
    for (const ref of refs) keys.add(makeStreamKey(ref.streamPubkey, ref.streamId));
    return keys;
  }, [guilds, selectedGuild]);

  const vodStreams = useMemo(
    () =>
      allStreams
        .filter((stream) => stream.status === "ended")
        .filter((stream) => resolveVodPolicy(stream).mode !== "off")
        .sort((a, b) => b.createdAt - a.createdAt),
    [allStreams]
  );

  const visibleLiveStreams = useMemo(() => {
    const base = liveStreams.filter((stream) => !social.isBlocked(stream.pubkey));
    const favoriteFiltered = favoritesOnly
      ? base.filter((stream) => social.isFavoriteCreator(stream.pubkey) || social.isFavoriteStream(stream.pubkey, stream.streamId))
      : base;
    if (!curatedOnly) return favoriteFiltered;
    return favoriteFiltered.filter((stream) => curatedKeys.has(makeStreamKey(stream.pubkey, stream.streamId)));
  }, [curatedKeys, curatedOnly, favoritesOnly, liveStreams, social]);

  const visibleVodStreams = useMemo(() => {
    const base = vodStreams.filter((stream) => !social.isBlocked(stream.pubkey));
    const favoriteFiltered = favoritesOnly
      ? base.filter((stream) => social.isFavoriteCreator(stream.pubkey) || social.isFavoriteStream(stream.pubkey, stream.streamId))
      : base;
    if (!curatedOnly) return favoriteFiltered;
    return favoriteFiltered.filter((stream) => curatedKeys.has(makeStreamKey(stream.pubkey, stream.streamId)));
  }, [curatedKeys, curatedOnly, favoritesOnly, social, vodStreams]);

  const isLoading = liveLoading || archiveLoading;

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
      <main id="vod" className="max-w-[1800px] mx-auto p-8 space-y-8">
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
            <Link className="text-sm text-neutral-300 hover:text-white" href="/vod">
              VOD
            </Link>
            <Link className="text-sm text-neutral-300 hover:text-white" href="/">
              Home
            </Link>
          </div>
        </header>

        {curatedInfo}

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="aspect-video bg-neutral-900 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : visibleLiveStreams.length === 0 && visibleVodStreams.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 p-8 text-neutral-400 text-center">
            {favoritesOnly && curatedOnly
              ? "No favorite curated streams or replays found."
              : favoritesOnly
                ? "No favorite streams or replays found."
                : curatedOnly
                  ? "No curated streams or replays found."
                  : "No streams or replays found."}
          </div>
        ) : (
          <>
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Live Now ({visibleLiveStreams.length})</h2>
              {visibleLiveStreams.length === 0 ? (
                <div className="rounded-xl border border-neutral-800 p-8 text-neutral-400 text-center">
                  No live streams match current filters.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                  {visibleLiveStreams.map((stream, index) => {
                    const alias = social.getAlias(stream.pubkey);
                    const npub = pubkeyHexToNpub(stream.pubkey);
                    const pubkeyParam = npub ?? stream.pubkey;
                    const pubkeyLabel = npub
                      ? shortenText(npub, { head: 14, tail: 8 })
                      : shortenText(stream.pubkey, { head: 14, tail: 8 });
                    const favorite =
                      social.isFavoriteCreator(stream.pubkey) || social.isFavoriteStream(stream.pubkey, stream.streamId);

                    return (
                      <Link
                        href={`/watch/${pubkeyParam}/${stream.streamId}`}
                        key={`live:${stream.pubkey}:${stream.streamId}`}
                        className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition"
                      >
                        <div className="aspect-video bg-neutral-800 flex items-center justify-center relative">
                          <LiveStreamPreview
                            streamPubkey={stream.pubkey}
                            streamId={stream.streamId}
                            title={stream.title || "Live stream preview"}
                            fallbackImage={stream.image}
                            enabled={index < 16}
                          />
                          <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                            Live
                          </div>
                          {stream.stakeAmountAtomic && stream.stakeAmountAtomic !== "0" && (
                            <div className="absolute top-2 right-2 bg-neutral-950/70 border border-neutral-700 text-neutral-200 text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                              Stake
                            </div>
                          )}
                        </div>
                        <div className="p-4 space-y-1">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-bold text-base line-clamp-1 min-w-0">{stream.title || "Untitled Stream"}</h3>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                social.toggleFavoriteStream(stream.pubkey, stream.streamId);
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
                          {(social.isTrusted(stream.pubkey) || social.isFavoriteCreator(stream.pubkey)) && (
                            <div className="flex items-center gap-2">
                              {social.isTrusted(stream.pubkey) && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/50 border border-emerald-700/30 text-emerald-200">
                                  Trusted
                                </span>
                              )}
                              {social.isFavoriteCreator(stream.pubkey) && (
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
            </section>

            <section className="space-y-4" id="vod-section">
              <h2 className="text-lg font-semibold">Replays (VOD) ({visibleVodStreams.length})</h2>
              {visibleVodStreams.length === 0 ? (
                <div className="rounded-xl border border-neutral-800 p-8 text-neutral-400 text-center">
                  No replay streams match current filters.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                  {visibleVodStreams.map((stream) => {
                    const alias = social.getAlias(stream.pubkey);
                    const npub = pubkeyHexToNpub(stream.pubkey);
                    const pubkeyParam = npub ?? stream.pubkey;
                    const pubkeyLabel = npub
                      ? shortenText(npub, { head: 14, tail: 8 })
                      : shortenText(stream.pubkey, { head: 14, tail: 8 });
                    const favorite =
                      social.isFavoriteCreator(stream.pubkey) || social.isFavoriteStream(stream.pubkey, stream.streamId);
                    const vodPolicy = resolveVodPolicy(stream);

                    return (
                      <Link
                        href={`/watch/${pubkeyParam}/${stream.streamId}`}
                        key={`vod:${stream.pubkey}:${stream.streamId}:${stream.createdAt}`}
                        className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition"
                      >
                        <div className="aspect-video bg-neutral-800 relative overflow-hidden">
                          {stream.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={stream.image}
                              alt={stream.title || "Replay thumbnail"}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-500 text-sm">No thumbnail</div>
                          )}
                          <div className="absolute top-2 left-2 bg-neutral-950/80 border border-neutral-700 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                            {vodModeLabel(vodPolicy)}
                          </div>
                        </div>
                        <div className="p-4 space-y-1">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-bold text-base line-clamp-1 min-w-0">{stream.title || "Untitled Replay"}</h3>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                social.toggleFavoriteStream(stream.pubkey, stream.streamId);
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
                          {vodPolicy.mode === "paid" && vodPolicy.priceAtomic && (
                            <p className="text-xs text-amber-300">Unlock: {formatXmrAtomic(vodPolicy.priceAtomic)}</p>
                          )}
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
