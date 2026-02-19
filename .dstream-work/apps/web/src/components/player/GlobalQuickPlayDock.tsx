"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Play, X } from "lucide-react";
import { Player } from "@/components/Player";
import { useQuickPlay } from "@/context/QuickPlayContext";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { useStreamAnnounces } from "@/hooks/useStreamAnnounces";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { makeOriginStreamId } from "@/lib/origin";

export function GlobalQuickPlayDock() {
  const pathname = usePathname();
  const isWatchRoute = pathname?.startsWith("/watch/");

  const { quickPlayStream, setQuickPlayStream, clearQuickPlayStream } = useQuickPlay();
  const { identity } = useIdentity();
  const social = useSocial();

  const [pickerOpen, setPickerOpen] = useState(false);

  const { streams: liveStreams, isLoading } = useStreamAnnounces({
    liveOnly: true,
    limit: 40,
    includeMature: social.settings.showMatureContent,
    viewerPubkey: identity?.pubkey ?? null
  });

  const activeStreamStillLive = useMemo(() => {
    if (!quickPlayStream) return false;
    return liveStreams.some(
      (stream) => stream.pubkey === quickPlayStream.streamPubkey && stream.streamId === quickPlayStream.streamId
    );
  }, [liveStreams, quickPlayStream]);

  useEffect(() => {
    if (!quickPlayStream) return;
    if (isLoading) return;
    if (activeStreamStillLive) return;
    clearQuickPlayStream();
  }, [activeStreamStillLive, clearQuickPlayStream, isLoading, quickPlayStream]);

  const activeStream = useMemo(() => {
    if (!quickPlayStream) return null;
    if (activeStreamStillLive) return quickPlayStream;
    return null;
  }, [activeStreamStillLive, quickPlayStream]);

  const originStreamId = useMemo(() => {
    if (!activeStream) return null;
    return makeOriginStreamId(activeStream.streamPubkey, activeStream.streamId);
  }, [activeStream]);

  const hlsSrc = useMemo(() => {
    if (!originStreamId) return null;
    return `/api/hls/${encodeURIComponent(originStreamId)}/index.m3u8`;
  }, [originStreamId]);

  const whepSrc = useMemo(() => {
    if (!originStreamId) return null;
    return `/api/whep/${encodeURIComponent(originStreamId)}/whep`;
  }, [originStreamId]);

  if (isWatchRoute) return null;

  const showPanel = pickerOpen || !!activeStream;

  return (
    <>
      {!showPanel ? (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-950/95 px-3 py-2 text-xs text-neutral-200 shadow-2xl backdrop-blur hover:text-white"
          title="Open quick player"
        >
          <Play className="h-3.5 w-3.5" />
          Quick Player
        </button>
      ) : null}

      {showPanel ? (
        <aside className="fixed bottom-4 right-4 z-40 w-[min(92vw,420px)] rounded-2xl border border-neutral-800 bg-neutral-950/95 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3 border-b border-neutral-800 px-3 pb-2 pt-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">Quick Player</div>
              <div className="truncate text-sm font-semibold text-neutral-100">
                {activeStream ? activeStream.title : "Select a live stream"}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {activeStream ? (
                <button
                  type="button"
                  onClick={() => setPickerOpen((open) => !open)}
                  className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-200 hover:text-white"
                >
                  {pickerOpen ? "Hide list" : "Switch"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  clearQuickPlayStream();
                }}
                className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-200 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {activeStream && hlsSrc ? (
            <>
              <div className="p-3">
                <Player src={hlsSrc} whepSrc={whepSrc} autoplayMuted isLiveStream showTimelineControls={false} />
              </div>
              <div className="flex items-center justify-between px-3 pb-3 text-[11px] text-neutral-500">
                <span>PiP, fullscreen, quality, and volume controls are enabled.</span>
                <Link
                  href={`/watch/${pubkeyHexToNpub(activeStream.streamPubkey) ?? activeStream.streamPubkey}/${activeStream.streamId}`}
                  className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-200 hover:text-white"
                >
                  Open
                </Link>
              </div>
            </>
          ) : null}

          {pickerOpen || !activeStream ? (
            <div className="max-h-64 space-y-2 overflow-y-auto border-t border-neutral-800 px-3 py-3">
              {isLoading ? <div className="text-xs text-neutral-500">Loading live streams…</div> : null}
              {!isLoading && liveStreams.length === 0 ? (
                <div className="text-xs text-neutral-500">No live streams found on configured relays.</div>
              ) : null}
              {liveStreams.slice(0, 20).map((stream) => {
                const selected = activeStream?.streamPubkey === stream.pubkey && activeStream?.streamId === stream.streamId;
                const npub = pubkeyHexToNpub(stream.pubkey);
                const pubkeyLabel = npub ? shortenText(npub, { head: 12, tail: 8 }) : shortenText(stream.pubkey, { head: 12, tail: 8 });
                return (
                  <button
                    key={`${stream.pubkey}:${stream.streamId}`}
                    type="button"
                    onClick={() => {
                      setQuickPlayStream({
                        streamPubkey: stream.pubkey,
                        streamId: stream.streamId,
                        title: stream.title || "Untitled Stream"
                      });
                      setPickerOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-2 text-left ${
                      selected
                        ? "border-blue-500/60 bg-blue-900/20 text-blue-100"
                        : "border-neutral-800 bg-neutral-900/60 text-neutral-200 hover:border-neutral-700"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{stream.title || "Untitled Stream"}</span>
                      <span className="block truncate text-[10px] text-neutral-500">{pubkeyLabel}</span>
                    </span>
                    <span className="text-[10px] uppercase text-red-300">Live</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
