"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useStreamAnnounces } from "@/hooks/useStreamAnnounces";
import { useGuild } from "@/hooks/useGuild";
import { useGuilds } from "@/hooks/useGuilds";
import { makeStreamKey } from "@dstream/protocol";
import { Flag, Star } from "lucide-react";
import { useSocial } from "@/context/SocialContext";
import { useIdentity } from "@/context/IdentityContext";
import { useQuickPlay } from "@/context/QuickPlayContext";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";
import { deriveQuickPlaySources } from "@/lib/quickplay";
import { useEffect, useMemo, useState } from "react";
import { LiveStreamPreview } from "@/components/stream/LiveStreamPreview";
import { buildSignedScopeProof, submitModerationReport } from "@/lib/moderation/reportClient";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import type { ReportReasonCode } from "@/lib/moderation/reportTypes";

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
  const { identity, signEvent } = useIdentity();
  const { quickPlayStream, setQuickPlayStream, clearQuickPlayStream } = useQuickPlay();
  const searchParams = useSearchParams();
  const guildQueryRaw = searchParams.get("guild");
  const searchQuery = (searchParams.get("q") ?? "").trim();
  const normalizedSearchQuery = searchQuery.toLowerCase();
  const guildQuery = useMemo(() => parseGuildQuery(guildQueryRaw), [guildQueryRaw]);
  const guildPubkeyHex = useMemo(() => (guildQuery ? pubkeyParamToHex(guildQuery.pubkeyParam) : null), [guildQuery]);
  const showMatureContent = social.settings.showMatureContent;
  const [liveOnly, setLiveOnly] = useState(false);
  const { streams, isLoading } = useStreamAnnounces({
    liveOnly,
    limit: 120,
    includeMature: showMatureContent,
    viewerPubkey: identity?.pubkey ?? null
  });

  const dedupedStreams = useMemo(() => {
    const byCanonicalKey = new Map<string, (typeof streams)[number]>();
    for (const stream of streams) {
      const canonicalKey = makeStreamKey(stream.pubkey.toLowerCase(), stream.streamId.toLowerCase());
      const existing = byCanonicalKey.get(canonicalKey);
      if (!existing || stream.createdAt >= existing.createdAt) {
        byCanonicalKey.set(canonicalKey, stream);
      }
    }
    return Array.from(byCanonicalKey.values());
  }, [streams]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [curatedOnly, setCuratedOnly] = useState(false);
  const [hasSettledOnce, setHasSettledOnce] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    targetPubkey: string;
    targetStreamId: string;
    summary: string;
  } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);

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
    const base = dedupedStreams.filter((s) => !social.isBlocked(s.pubkey));
    const favFiltered = favoritesOnly
      ? base.filter((s) => social.isFavoriteCreator(s.pubkey) || social.isFavoriteStream(s.pubkey, s.streamId))
      : base;
    const liveFirst = favFiltered.slice().sort((a, b) => {
      const aLive = a.status === "live";
      const bLive = b.status === "live";
      if (aLive === bLive) return 0;
      return aLive ? -1 : 1;
    });
    const curatedFiltered = !curatedOnly ? liveFirst : liveFirst.filter((s) => curatedKeys.has(makeStreamKey(s.pubkey, s.streamId)));
    if (!normalizedSearchQuery) return curatedFiltered;
    return curatedFiltered.filter((stream) => {
      const alias = social.getAlias(stream.pubkey);
      const haystack = [stream.title, stream.summary, stream.streamId, stream.pubkey, alias, ...(stream.topics ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearchQuery);
    });
  }, [curatedKeys, curatedOnly, dedupedStreams, favoritesOnly, normalizedSearchQuery, social]);
  const showLoadingSkeleton = isLoading && !hasSettledOnce;
  const showRefreshingNotice = isLoading && visibleStreams.length > 0;

  useEffect(() => {
    if (!isLoading) setHasSettledOnce(true);
  }, [isLoading]);

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

  const submitStreamReport = async (input: { reasonCode: ReportReasonCode; note: string }) => {
    if (!reportTarget) return;
    setReportBusy(true);
    setReportError(null);
    try {
      const proof = await buildSignedScopeProof(signEvent as any, identity?.pubkey ?? null, "report_submit", [
        ["stream", `${reportTarget.targetPubkey}--${reportTarget.targetStreamId}`]
      ]);
      await submitModerationReport({
        report: {
          reasonCode: input.reasonCode,
          note: input.note,
          reporterPubkey: identity?.pubkey ?? undefined,
          targetType: "stream",
          targetPubkey: reportTarget.targetPubkey,
          targetStreamId: reportTarget.targetStreamId,
          contextPage: "browse",
          contextUrl: typeof window !== "undefined" ? window.location.href : undefined
        },
        reporterProofEvent: proof
      });
      setReportTarget(null);
      setReportNotice("Report submitted. Operators can review it in Moderation.");
      setTimeout(() => {
        setReportNotice((current) => (current === "Report submitted. Operators can review it in Moderation." ? null : current));
      }, 3500);
    } catch (error: any) {
      setReportError(error?.message ?? "Failed to submit report.");
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-6xl mx-auto p-6 md:p-8 space-y-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Browse</h1>
              <div className="text-xs text-neutral-500">
                {visibleStreams.length} stream{visibleStreams.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="ui-pill" data-active={favoritesOnly} onClick={() => setFavoritesOnly((prev) => !prev)}>
              Favorites
            </button>
            <button type="button" className="ui-pill" data-active={liveOnly} onClick={() => setLiveOnly((prev) => !prev)}>
              Live Only
            </button>
            <button type="button" className="ui-pill" data-active={curatedOnly} onClick={() => setCuratedOnly((prev) => !prev)}>
              {guildQuery ? "Guild Curated" : "Curated"}
            </button>
            <Link className="ui-pill" href="/guilds">
              Guilds
            </Link>
            <button
              type="button"
              className="ui-pill"
              data-active={showMatureContent}
              onClick={() => social.updateSettings({ showMatureContent: !showMatureContent })}
            >
              Mature
            </button>
          </div>
        </header>

        {reportNotice ? (
          <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">{reportNotice}</div>
        ) : null}

        {curatedInfo}
        {searchQuery ? <div className="text-xs text-neutral-500">Search: “{searchQuery}”</div> : null}
        {showRefreshingNotice ? <div className="text-xs text-neutral-500">Refreshing stream list…</div> : null}

        {showLoadingSkeleton ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="ui-surface overflow-hidden animate-pulse min-h-[280px]">
                <div className="aspect-video bg-neutral-800" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-neutral-800" />
                  <div className="h-3 w-2/3 rounded bg-neutral-800" />
                  <div className="h-3 w-1/2 rounded bg-neutral-800" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleStreams.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 p-8 text-neutral-400 text-center">
            {favoritesOnly && curatedOnly
              ? liveOnly
                ? "No favorite curated streams are live right now."
                : "No favorite curated channels found."
              : favoritesOnly
                ? liveOnly
                  ? "No favorite streams are live right now."
                  : "No favorite channels found."
                : curatedOnly
                  ? liveOnly
                    ? "No curated streams are live right now."
                    : "No curated channels found."
                  : liveOnly
                    ? "No live streams found."
                    : "No channels found."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleStreams.map((s, index) => {
              const alias = social.getAlias(s.pubkey);
              const npub = pubkeyHexToNpub(s.pubkey);
              const pubkeyParam = npub ?? s.pubkey;
              const pubkeyLabel = npub
                ? shortenText(npub, { head: 14, tail: 8 })
                : shortenText(s.pubkey, { head: 14, tail: 8 });
              const favorite = social.isFavoriteCreator(s.pubkey) || social.isFavoriteStream(s.pubkey, s.streamId);
              const isLive = s.status === "live";

              return (
                <Link
                  href={`/watch/${pubkeyParam}/${s.streamId}`}
                  key={`${s.pubkey}:${s.streamId}`}
                  className="group ui-surface block overflow-hidden hover:border-blue-500/50 transition min-h-[280px] flex flex-col"
                >
                  <div className="aspect-video bg-neutral-800 flex items-center justify-center relative">
                      <LiveStreamPreview
                        streamPubkey={s.pubkey}
                        streamId={s.streamId}
                        title={s.title || "Live stream preview"}
                        fallbackImage={s.image}
                        enabled={index < 16 && isLive}
                      />
                      <div
                        className={`absolute top-2 left-2 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                          s.status === "live" ? "bg-red-600" : "bg-neutral-700"
                        }`}
                      >
                        {s.status === "live" ? "Live" : "Offline"}
                      </div>
                      {s.matureContent ? (
                        <div className="absolute top-2 left-14 bg-amber-900/80 text-amber-100 text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-amber-700/40">
                          Mature
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!isLive) return;
                          if (quickPlayStream?.streamPubkey === s.pubkey && quickPlayStream?.streamId === s.streamId) {
                            clearQuickPlayStream();
                            return;
                          }
                          const quickPlaySources = deriveQuickPlaySources({
                            pubkey: s.pubkey,
                            streamId: s.streamId,
                            streaming: s.streaming,
                            renditions: s.renditions
                          });
                          setQuickPlayStream({
                            streamPubkey: s.pubkey,
                            streamId: s.streamId,
                            title: s.title || "Untitled Stream",
                            hlsUrl: quickPlaySources.hlsUrl,
                            whepUrl: quickPlaySources.whepUrl
                          });
                        }}
                        className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-neutral-950/70 border border-neutral-700 text-[10px] text-neutral-200 hover:text-white"
                        title={isLive ? "Quick play with PiP controls" : "Stream is offline"}
                        aria-label="Quick play with PiP controls"
                      >
                        {isLive
                          ? quickPlayStream?.streamPubkey === s.pubkey && quickPlayStream?.streamId === s.streamId
                            ? "Close Player"
                            : "Quick Play"
                          : "Offline"}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const npub = pubkeyHexToNpub(s.pubkey) ?? s.pubkey;
                          setReportTarget({
                            targetPubkey: s.pubkey,
                            targetStreamId: s.streamId,
                            summary: `Report stream ${s.title || s.streamId} by ${npub}`
                          });
                          setReportError(null);
                        }}
                        className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-neutral-950/70 border border-neutral-700 text-[10px] text-neutral-200 hover:text-white"
                        title="Report stream"
                        aria-label="Report stream"
                      >
                        <Flag className="w-3 h-3" />
                        Report
                      </button>
                    {s.stakeAmountAtomic && s.stakeAmountAtomic !== "0" && (
                      <div className="absolute bottom-2 right-2 bg-neutral-950/70 border border-neutral-700 text-neutral-200 text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                        Stake
                      </div>
                    )}
                  </div>
                  <div className="p-4 space-y-1 flex-1">
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

        <ReportDialog
          open={!!reportTarget}
          busy={reportBusy}
          title="Report Stream"
          targetSummary={reportTarget?.summary ?? ""}
          error={reportError}
          onClose={() => {
            if (reportBusy) return;
            setReportTarget(null);
            setReportError(null);
          }}
          onSubmit={submitStreamReport}
        />
      </main>
    </div>
  );
}
