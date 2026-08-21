"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { canonicalStreamKey } from "@/hooks/useStreamAnnounces";
import { LiveStreamPreview } from "@/components/stream/LiveStreamPreview";

import { formatXmrAtomic, isReplayEligibleStream, resolveVideoPolicy, videoModeLabel } from "@/lib/videoPolicy";
import { buildWatchHref } from "@/lib/watchHref";

function streamCanonicalId(s: { pubkey: string; streamId: string; streaming?: string | null }) {
  return `${s.pubkey.toLowerCase()}::${canonicalStreamKey(s as any)}`;
}

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const guildQueryRaw = searchParams.get("guild");
  const tabQuery = searchParams.get("tab");
  const guildQuery = useMemo(() => parseGuildQuery(guildQueryRaw), [guildQueryRaw]);
  const guildPubkeyHex = useMemo(() => (guildQuery ? pubkeyParamToHex(guildQuery.pubkeyParam) : null), [guildQuery]);
  const { streams: liveStreams, isLoading: liveLoading } = useStreamAnnounces({ liveOnly: true, limit: 180 });
  const { streams: allStreams, isLoading: archiveLoading } = useStreamAnnounces({ liveOnly: false, limit: 260 });
  const favoritesOnly = tabQuery === "following";
  const [curatedOnly, setCuratedOnly] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);

  const setBrowseTab = (tab: "browse" | "following") => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (tab === "following") {
      nextParams.set("tab", "following");
    } else {
      nextParams.delete("tab");
    }
    const nextQuery = nextParams.toString();
    router.push(nextQuery ? `/browse?${nextQuery}` : "/browse");
  };

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

  const videoStreams = useMemo(
    () =>
      allStreams
        .filter((stream) => isReplayEligibleStream(stream))
        .sort((a, b) => b.createdAt - a.createdAt),
    [allStreams]
  );

  const offlineStreams = useMemo(
    () =>
      allStreams
        .filter((stream) => stream.status !== "live" && !isReplayEligibleStream(stream))
        .sort((a, b) => b.createdAt - a.createdAt),
    [allStreams]
  );

  const visibleLiveStreams = useMemo(() => {
    const base = liveStreams
      .filter((stream) => !social.isBlocked(stream.pubkey));
    const favoriteFiltered = favoritesOnly
      ? base.filter((stream) => social.isFavoriteCreator(stream.pubkey) || social.isFavoriteStream(stream.pubkey, stream.streamId))
      : base;
    if (!curatedOnly) return favoriteFiltered;
    return favoriteFiltered.filter((stream) => curatedKeys.has(makeStreamKey(stream.pubkey, stream.streamId)));
  }, [curatedKeys, curatedOnly, favoritesOnly, liveStreams, social]);

  const visibleVideoStreams = useMemo(() => {
    if (liveOnly) return [];
    const base = videoStreams.filter((stream) => !social.isBlocked(stream.pubkey));
    const favoriteFiltered = favoritesOnly
      ? base.filter((stream) => social.isFavoriteCreator(stream.pubkey) || social.isFavoriteStream(stream.pubkey, stream.streamId))
      : base;
    if (!curatedOnly) return favoriteFiltered;
    return favoriteFiltered.filter((stream) => curatedKeys.has(makeStreamKey(stream.pubkey, stream.streamId)));
  }, [curatedKeys, curatedOnly, favoritesOnly, liveOnly, social, videoStreams]);

  const visibleOfflineStreams = useMemo(() => {
    if (liveOnly) return [];
    const base = offlineStreams.filter((stream) => !social.isBlocked(stream.pubkey));
    const favoriteFiltered = favoritesOnly
      ? base.filter((stream) => social.isFavoriteCreator(stream.pubkey) || social.isFavoriteStream(stream.pubkey, stream.streamId))
      : base;
    if (!curatedOnly) return favoriteFiltered;
    return favoriteFiltered.filter((stream) => curatedKeys.has(makeStreamKey(stream.pubkey, stream.streamId)));
  }, [curatedKeys, curatedOnly, favoritesOnly, liveOnly, offlineStreams, social]);

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
      <main id="video" className="mx-auto max-w-[1800px] space-y-6 px-3 py-5 sm:p-6 lg:p-8">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-bold sm:text-2xl">Browse</h1>
            <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&>*]:shrink-0 [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setBrowseTab("browse")}
                aria-pressed={!favoritesOnly}
                className={`text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-colors ${
                  favoritesOnly
                    ? "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                    : "bg-blue-500/20 border-blue-500/50 text-blue-200"
                }`}
              >
                Browse
              </button>
              <button
                type="button"
                onClick={() => setBrowseTab("following")}
                aria-pressed={favoritesOnly}
                className={`text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-colors ${
                  favoritesOnly
                    ? "bg-blue-500/20 border-blue-500/50 text-blue-200"
                    : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                }`}
              >
                Following
              </button>
              <Link
                className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                href="/guilds"
              >
                Guilds
              </Link>
              <Link
                className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
                href="/video"
              >
                Video
              </Link>
              <Link
                className="hidden text-xs items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300 sm:inline-flex"
                href="/"
              >
                Home
              </Link>
            </div>
          </div>
          <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&>*]:shrink-0 [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setCuratedOnly((current) => !current)}
              aria-pressed={curatedOnly}
              className={`text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-colors ${
                curatedOnly
                  ? "bg-blue-500/20 border-blue-500/50 text-blue-200"
                  : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
              }`}
            >
              {curatedLabel}
            </button>
            <button
              type="button"
              onClick={() => setLiveOnly((current) => !current)}
              aria-pressed={liveOnly}
              className={`text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-colors ${
                liveOnly
                  ? "bg-blue-500/20 border-blue-500/50 text-blue-200"
                  : "bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-300"
              }`}
            >
              Live only
            </button>
          </div>
        </header>

        {curatedInfo}

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-3 rounded-lg border border-neutral-900 bg-neutral-900/40 p-2 sm:rounded-xl">
                <div className="aspect-video rounded-md bg-neutral-900 animate-pulse" />
                <div className="h-4 w-3/4 rounded bg-neutral-900 animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-neutral-900 animate-pulse" />
              </div>
            ))}
          </div>
        ) : visibleLiveStreams.length === 0 && visibleVideoStreams.length === 0 && visibleOfflineStreams.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 p-8 text-neutral-400 text-center">
            {favoritesOnly && curatedOnly
              ? "No followed curated streams found."
              : favoritesOnly
                ? "No followed streams found."
                : curatedOnly
                  ? "No curated streams found."
                  : "No streams found."}
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
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
                        href={buildWatchHref(pubkeyParam, stream.streamId, stream.streaming)}
                        prefetch={false}
                        key={`live:${streamCanonicalId(stream)}`}
                        className="group block overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 transition hover:border-blue-500/50 sm:rounded-xl"
                      >
                        <div className="aspect-video bg-neutral-800 flex items-center justify-center relative overflow-hidden">
                          <div className={`w-full h-full ${stream.contentWarningReason ? 'blur-xl grayscale' : ''}`}>
                            <LiveStreamPreview
                            streamPubkey={stream.pubkey}
                            streamId={stream.streamId}
                            title={stream.title || "Live stream preview"}
                            streamingUrl={stream.streaming}
                            fallbackImage={stream.image}
                            enabled={index < 12}
                          />
                          </div>
                          {stream.contentWarningReason && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-neutral-950/60 transition-colors pointer-events-none p-4 text-center">
                              <span className="bg-red-900/80 border border-red-500 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded shadow-xl mb-2">18+ NSFW</span>
                              <span className="text-[10px] text-neutral-400 font-medium leading-tight line-clamp-2">{stream.contentWarningReason}</span>
                            </div>
                          )}
                          <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                            Live
                          </div>
                          {stream.stakeAmountAtomic && stream.stakeAmountAtomic !== "0" && (
                            <div className="absolute top-2 right-2 bg-neutral-950/70 border border-neutral-700 text-neutral-200 text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                              Stake
                            </div>
                          )}
                        </div>
                        <div className="space-y-1 p-3 sm:p-4">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="min-w-0 line-clamp-2 text-sm font-bold leading-snug sm:line-clamp-1 sm:text-base">{stream.title || "Untitled Stream"}</h3>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                social.toggleFavoriteStream(stream.pubkey, stream.streamId);
                              }}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/40 text-neutral-200 hover:bg-neutral-950/70 sm:h-9 sm:w-9 sm:rounded-xl"
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

            <section className="space-y-4" id="video-section">
              <h2 className="text-lg font-semibold">Replays (Video) ({visibleVideoStreams.length})</h2>
              {visibleVideoStreams.length === 0 ? (
                <div className="rounded-xl border border-neutral-800 p-8 text-neutral-400 text-center">
                  No replay streams match current filters.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
                  {visibleVideoStreams.map((stream) => {
                    const alias = social.getAlias(stream.pubkey);
                    const npub = pubkeyHexToNpub(stream.pubkey);
                    const pubkeyParam = npub ?? stream.pubkey;
                    const pubkeyLabel = npub
                      ? shortenText(npub, { head: 14, tail: 8 })
                      : shortenText(stream.pubkey, { head: 14, tail: 8 });
                    const favorite =
                      social.isFavoriteCreator(stream.pubkey) || social.isFavoriteStream(stream.pubkey, stream.streamId);
                    const videoPolicy = resolveVideoPolicy(stream);

                    return (
                      <Link
                        href={buildWatchHref(pubkeyParam, stream.streamId, stream.streaming)}
                        key={`video:${streamCanonicalId(stream)}:${stream.createdAt}`}
                        className="group block overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 transition hover:border-blue-500/50 sm:rounded-xl"
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
                            <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 gap-2">
                              <img src="/logo_trimmed.png" alt="" className="w-14 h-14 object-contain opacity-15 grayscale" />
                              <span className="text-[11px] font-semibold tracking-wider uppercase text-neutral-700">dStream</span>
                            </div>
                          )}
                          <div className="absolute top-2 left-2 bg-neutral-950/80 border border-neutral-700 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                            {videoModeLabel(videoPolicy)}
                          </div>
                        </div>
                        <div className="space-y-1 p-3 sm:p-4">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="min-w-0 line-clamp-2 text-sm font-bold leading-snug sm:line-clamp-1 sm:text-base">{stream.title || "Untitled Replay"}</h3>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                social.toggleFavoriteStream(stream.pubkey, stream.streamId);
                              }}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/40 text-neutral-200 hover:bg-neutral-950/70 sm:h-9 sm:w-9 sm:rounded-xl"
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
                          {videoPolicy.mode === "paid" && videoPolicy.priceAtomic && (
                            <p className="text-xs text-amber-300">Unlock: {formatXmrAtomic(videoPolicy.priceAtomic)}</p>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Offline Streams ({visibleOfflineStreams.length})</h2>
              {visibleOfflineStreams.length === 0 ? (
                <div className="rounded-xl border border-neutral-800 p-8 text-neutral-400 text-center">
                  No offline streams match current filters.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
                  {visibleOfflineStreams.map((stream) => {
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
                        href={buildWatchHref(pubkeyParam, stream.streamId, stream.streaming)}
                        key={`offline:${streamCanonicalId(stream)}:${stream.createdAt}`}
                        className="group block overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 transition hover:border-blue-500/50 sm:rounded-xl"
                      >
                        <div className="aspect-video bg-neutral-800 relative overflow-hidden">
                          {stream.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={stream.image}
                              alt={stream.title || "Offline stream thumbnail"}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 gap-2">
                              <img src="/logo_trimmed.png" alt="" className="w-14 h-14 object-contain opacity-15 grayscale" />
                              <span className="text-[11px] font-semibold tracking-wider uppercase text-neutral-700">dStream</span>
                            </div>
                          )}
                          <div className="absolute top-2 left-2 bg-neutral-950/80 border border-neutral-700 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                            Offline
                          </div>
                        </div>
                        <div className="space-y-1 p-3 sm:p-4">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="min-w-0 line-clamp-2 text-sm font-bold leading-snug sm:line-clamp-1 sm:text-base">{stream.title || "Untitled Stream"}</h3>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                social.toggleFavoriteStream(stream.pubkey, stream.streamId);
                              }}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/40 text-neutral-200 hover:bg-neutral-950/70 sm:h-9 sm:w-9 sm:rounded-xl"
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
