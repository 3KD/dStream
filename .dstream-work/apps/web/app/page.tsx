"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Compass, Network, Fingerprint, Shuffle, Zap, Users, Bitcoin } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { LandingHero } from "@/components/landing/LandingHero";
import { LiveStreamPreview } from "@/components/stream/LiveStreamPreview";
import { useStreamAnnounces } from "@/hooks/useStreamAnnounces";

import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";
import { formatXmrAtomic, isReplayEligibleStream, resolveVideoPolicy, videoModeLabel } from "@/lib/videoPolicy";
import { buildWatchHref } from "@/lib/watchHref";
import { canonicalStreamKey } from "@/hooks/useStreamAnnounces";

function streamCanonicalId(s: { pubkey: string; streamId: string; streaming?: string | null }) {
  return `${s.pubkey.toLowerCase()}::${canonicalStreamKey(s as any)}`;
}

export default function HomePage() {
  const router = useRouter();
  const { streams: liveStreams, isLoading } = useStreamAnnounces({ liveOnly: true, limit: 60 });
  const { streams: announcedStreams, isLoading: videoLoading } = useStreamAnnounces({ liveOnly: false, limit: 180 });
  const [searchQuery, setSearchQuery] = useState("");
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("dstream.home.heroCollapsed");
    if (saved === "1") setHeroCollapsed(true);
  }, []);

  const visibleStreams = useMemo(() => {
    const playable = liveStreams;
    if (!searchQuery.trim()) return playable;
    const q = searchQuery.toLowerCase();
    const qHex = pubkeyParamToHex(searchQuery);
    return playable.filter((s) => {
      const titleMatch = (s.title || "").toLowerCase().includes(q);
      const summaryMatch = (s.summary || "").toLowerCase().includes(q);
      const topicMatch = (s.topics || []).some((t) => t.toLowerCase().includes(q));
      const npub = pubkeyHexToNpub(s.pubkey);
      const pubkeyMatch =
        s.pubkey.toLowerCase().includes(q) ||
        (npub ? npub.toLowerCase().includes(q) : false) ||
        (qHex ? s.pubkey.toLowerCase() === qHex : false);
      return titleMatch || summaryMatch || topicMatch || pubkeyMatch;
    });
  }, [liveStreams, searchQuery]);

  const videoStreams = useMemo(() => {
    return announcedStreams
      .filter((stream) => isReplayEligibleStream(stream))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12);
  }, [announcedStreams]);

  const handleShuffle = () => {
    if (visibleStreams.length === 0) return;
    const random = visibleStreams[Math.floor(Math.random() * visibleStreams.length)];
    const npub = pubkeyHexToNpub(random.pubkey);
    router.push(`/watch/${npub ?? random.pubkey}/${random.streamId}`);
  };

  const setIntroCollapsed = (next: boolean) => {
    setHeroCollapsed(next);
    window.localStorage.setItem("dstream.home.heroCollapsed", next ? "1" : "0");
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader
        rightSlot={
          <Link
            href="/broadcast"
            className="hidden md:flex px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-full font-medium items-center gap-2 transition active:scale-95"
          >
            Start Streaming
          </Link>
        }
      />

      <main id="main-content" className="max-w-7xl mx-auto p-6">
        {!heroCollapsed ? (
          <LandingHero
            collapseControl={
              <button
                type="button"
                onClick={() => setIntroCollapsed(true)}
                aria-label="Collapse intro"
                className="inline-flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
              >
                <ChevronUp className="h-5 w-5" />
              </button>
            }
          />
        ) : (
          <div className="mb-6 flex justify-center">
            <button
              type="button"
              onClick={() => setIntroCollapsed(false)}
              aria-label="Expand intro"
              className="inline-flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </div>
        )}

        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Live Now ({visibleStreams.length})
            </h2>

            <div className="flex items-center gap-2">
              <Link
                href="/browse"
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors bg-neutral-900 text-neutral-400 border border-neutral-800 hover:border-neutral-600 hover:text-white"
              >
                <Compass className="w-4 h-4" />
                <span>Browse</span>
              </Link>

              <button
                onClick={handleShuffle}
                disabled={visibleStreams.length === 0}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors bg-blue-600/10 text-blue-400 border border-blue-500/30 hover:bg-blue-600/20 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Jump to a random live stream"
              >
                <Shuffle className="w-4 h-4" />
                <span className="hidden sm:inline">Shuffle</span>
              </button>
            </div>
          </div>

          <div className="mb-6">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, topic, or pubkey…"
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="aspect-video bg-neutral-900 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : visibleStreams.length === 0 ? (
            <div className="p-12 border border-dashed border-neutral-800 rounded-xl text-center">
              <Zap className="w-12 h-12 mx-auto mb-4 text-neutral-700" />
              <p className="text-neutral-500 mb-4">No live streams found on configured relays.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visibleStreams.map((stream, index) => {
                const npub = pubkeyHexToNpub(stream.pubkey);
                const pubkeyParam = npub ?? stream.pubkey;
                const pubkeyLabel = npub
                  ? shortenText(npub, { head: 14, tail: 8 })
                  : shortenText(stream.pubkey, { head: 14, tail: 8 });

                return (
                  <Link
                    href={buildWatchHref(pubkeyParam, stream.streamId, stream.streaming)}
                    key={streamCanonicalId(stream)}
                    className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition relative"
                  >
                    <div className="aspect-video bg-neutral-800 flex items-center justify-center relative overflow-hidden">
                      <div className={`w-full h-full ${stream.contentWarningReason ? 'blur-xl grayscale' : ''}`}>
                      <LiveStreamPreview
                        streamPubkey={stream.pubkey}
                        streamId={stream.streamId}
                        title={stream.title || "Live stream preview"}
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
                    </div>
                    <div className="p-4">
                      <h3 className="font-bold text-lg line-clamp-1">{stream.title || "Untitled Stream"}</h3>
                      <p className="text-sm text-neutral-500 font-mono mt-1">{pubkeyLabel}</p>

                      {stream.topics.length > 0 && (
                        <div className="flex gap-1 mt-3 flex-wrap">
                          {stream.topics.slice(0, 3).map((t) => (
                            <span key={t} className="text-[10px] bg-neutral-800 px-2 py-0.5 rounded-full text-neutral-300">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">Latest Replays (Video)</h2>
            <Link href="/video" className="text-sm text-neutral-400 hover:text-white">
              View all
            </Link>
          </div>

          {videoLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="aspect-video bg-neutral-900 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : videoStreams.length === 0 ? (
            <div className="p-10 border border-dashed border-neutral-800 rounded-xl text-center text-neutral-500">
              No recent replays found.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {videoStreams.map((stream) => {
                const npub = pubkeyHexToNpub(stream.pubkey);
                const pubkeyParam = npub ?? stream.pubkey;
                const pubkeyLabel = npub
                  ? shortenText(npub, { head: 14, tail: 8 })
                  : shortenText(stream.pubkey, { head: 14, tail: 8 });
                const videoPolicy = resolveVideoPolicy(stream);
                const videoBadge = videoModeLabel(videoPolicy);

                return (
                  <Link
                    href={buildWatchHref(pubkeyParam, stream.streamId, stream.streaming)}
                    key={`video:${stream.pubkey}:${stream.streamId}:${stream.createdAt}`}
                    className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition relative"
                  >
                    <div className="aspect-video bg-neutral-800 relative overflow-hidden">
                      {stream.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={stream.image}
                          alt={stream.title || "Video thumbnail"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-500 text-sm">No thumbnail</div>
                      )}
                      <div className="absolute top-2 left-2 bg-neutral-950/80 border border-neutral-700 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                        {videoBadge}
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-bold text-lg line-clamp-1">{stream.title || "Untitled Replay"}</h3>
                      <p className="text-sm text-neutral-500 font-mono mt-1">{pubkeyLabel}</p>
                      {videoPolicy.mode === "paid" && videoPolicy.priceAtomic && (
                        <p className="text-xs text-amber-300 mt-2">Unlock: {formatXmrAtomic(videoPolicy.priceAtomic)}</p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="mb-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 bg-neutral-900/50 border border-neutral-800/50 rounded-2xl relative group overflow-hidden hover:border-purple-500/30 transition">
            <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-30 transition pointer-events-none">
              <Fingerprint className="w-24 h-24 text-purple-500" />
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-900/30 rounded-lg text-purple-400">
                <Fingerprint className="w-5 h-5" />
              </div>
              <span className="font-mono text-xs text-purple-400 uppercase tracking-wider font-bold">Nostr Identity</span>
            </div>
            <h3 className="text-xl font-bold mb-2">Censorship Resistant</h3>
            <p className="text-neutral-300 leading-relaxed">
              Identity is rooted in Nostr cryptography. No central authority can ban your keys or delete your followers.
            </p>
          </div>

          <div className="p-6 bg-neutral-900/50 border border-neutral-800/50 rounded-2xl relative group overflow-hidden hover:border-green-500/30 transition">
            <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-30 transition pointer-events-none">
              <Network className="w-24 h-24 text-green-500" />
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-900/30 rounded-lg text-green-400">
                <Network className="w-5 h-5" />
              </div>
              <span className="font-mono text-xs text-green-400 uppercase tracking-wider font-bold">P2P Scale</span>
            </div>
            <h3 className="text-xl font-bold mb-2">Peer-Assisted Streaming</h3>
            <p className="text-neutral-300 leading-relaxed">
              When enabled, viewers can automatically help support the broadcaster by securely relaying the video and audio feeds directly to other viewers, unlocking massive P2P scale.
            </p>
          </div>

          <div className="p-6 bg-neutral-900/50 border border-neutral-800/50 rounded-2xl relative group overflow-hidden hover:border-orange-500/30 transition">
            <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-30 transition pointer-events-none">
              <Bitcoin className="w-24 h-24 text-orange-500" />
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-orange-900/30 rounded-lg text-orange-400">
                <Bitcoin className="w-5 h-5" />
              </div>
              <span className="font-mono text-xs text-orange-400 uppercase tracking-wider font-bold">De-Fi Payments</span>
            </div>
            <h3 className="text-xl font-bold mb-2">Crypto Powered</h3>
            <p className="text-neutral-300 leading-relaxed">
              Monetize instantly using cryptocurrencies. By leveraging decentralized finance, payments bypass traditional middlemen directly to creators.
            </p>
          </div>
        </section>


      </main>
    </div>
  );
}
