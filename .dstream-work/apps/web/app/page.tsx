"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Compass, Network, Fingerprint, Shuffle, Zap, Users } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { LandingHero } from "@/components/landing/LandingHero";
import { LiveStreamPreview } from "@/components/stream/LiveStreamPreview";
import { useStreamAnnounces } from "@/hooks/useStreamAnnounces";
import { useIdentity } from "@/context/IdentityContext";
import { useQuickPlay } from "@/context/QuickPlayContext";
import { useSocial } from "@/context/SocialContext";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";

const HERO_COLLAPSE_STORAGE_KEY = "dstream_home_hero_collapsed_v1";

export default function HomePage() {
  const router = useRouter();
  const { identity } = useIdentity();
  const { quickPlayStream, setQuickPlayStream, clearQuickPlayStream } = useQuickPlay();
  const social = useSocial();
  const showMatureContent = social.settings.showMatureContent;
  const { streams: liveStreams, isLoading } = useStreamAnnounces({
    liveOnly: true,
    limit: 60,
    includeMature: showMatureContent,
    viewerPubkey: identity?.pubkey ?? null
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  useEffect(() => {
    try {
      setHeroCollapsed(localStorage.getItem(HERO_COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  const visibleStreams = useMemo(() => {
    if (!searchQuery.trim()) return liveStreams;
    const q = searchQuery.toLowerCase();
    const qHex = pubkeyParamToHex(searchQuery);
    return liveStreams.filter((s) => {
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

  const handleShuffle = () => {
    if (visibleStreams.length === 0) return;
    const random = visibleStreams[Math.floor(Math.random() * visibleStreams.length)];
    const npub = pubkeyHexToNpub(random.pubkey);
    router.push(`/watch/${npub ?? random.pubkey}/${random.streamId}`);
  };

  const toggleHeroCollapsed = () => {
    setHeroCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(HERO_COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
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
        <section className="mb-6">
          <div
            id="landing-hero"
            className={`overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-out ${
              heroCollapsed ? "max-h-0 opacity-0 -mt-4 pointer-events-none" : "max-h-[900px] opacity-100"
            }`}
          >
            <LandingHero
              collapseControl={!heroCollapsed ? (
                <button
                  type="button"
                  onClick={toggleHeroCollapsed}
                  aria-controls="landing-hero"
                  aria-expanded={!heroCollapsed}
                  className="text-2xl leading-none text-neutral-400 hover:text-white transition-colors"
                  title="Collapse hero"
                >
                  ^
                </button>
              ) : null}
            />
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center justify-between mb-6 gap-3">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Live Now ({visibleStreams.length})
            </h2>

            {heroCollapsed ? (
              <button
                type="button"
                onClick={toggleHeroCollapsed}
                aria-controls="landing-hero"
                aria-expanded={!heroCollapsed}
                className="relative top-0.5 px-2.5 py-1 rounded-full text-lg leading-none text-neutral-500 hover:text-neutral-300 bg-neutral-900/70 border border-neutral-800 transition-colors"
                title="Expand hero"
              >
                v
              </button>
            ) : null}

            <div className="flex items-center gap-2">
              <label className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border border-neutral-800 bg-neutral-900 text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMatureContent}
                  onChange={(event) => social.updateSettings({ showMatureContent: event.target.checked })}
                  className="accent-blue-500"
                />
                Mature
              </label>
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
                    href={`/watch/${pubkeyParam}/${stream.streamId}`}
                    key={`${stream.pubkey}:${stream.streamId}`}
                    className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition relative"
                  >
                    <div className="aspect-video bg-neutral-800 flex items-center justify-center relative">
                      <LiveStreamPreview
                        streamPubkey={stream.pubkey}
                        streamId={stream.streamId}
                        title={stream.title || "Live stream preview"}
                        fallbackImage={stream.image}
                        enabled={index < 12}
                      />

                      <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                        Live
                      </div>
                      {stream.matureContent ? (
                        <div className="absolute top-2 right-2 bg-amber-900/80 text-amber-100 text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-amber-700/40">
                          Mature
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (quickPlayStream?.streamPubkey === stream.pubkey && quickPlayStream?.streamId === stream.streamId) {
                            clearQuickPlayStream();
                            return;
                          }
                          setQuickPlayStream({
                            streamPubkey: stream.pubkey,
                            streamId: stream.streamId,
                            title: stream.title || "Untitled Stream"
                          });
                        }}
                        className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-950/70 px-2 py-1 text-[10px] text-neutral-200 hover:text-white"
                        title="Quick play with PiP controls"
                        aria-label="Quick play with PiP controls"
                      >
                        {quickPlayStream?.streamPubkey === stream.pubkey && quickPlayStream?.streamId === stream.streamId
                          ? "Close Player"
                          : "Quick Play"}
                      </button>
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
            <h3 className="text-xl font-bold mb-2">Replaceable Delivery</h3>
            <p className="text-neutral-300 leading-relaxed">
              The media layer is a hint, not an authority. Clients can fail over across origins and peer swarms (when enabled).
            </p>
          </div>

          <div className="p-6 bg-neutral-900/50 border border-neutral-800/50 rounded-2xl relative group overflow-hidden hover:border-orange-500/30 transition">
            <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-30 transition pointer-events-none">
              <Users className="w-24 h-24 text-orange-500" />
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-orange-900/30 rounded-lg text-orange-400">
                <Users className="w-5 h-5" />
              </div>
              <span className="font-mono text-xs text-orange-400 uppercase tracking-wider font-bold">Presence</span>
            </div>
            <h3 className="text-xl font-bold mb-2">Approximate Viewers</h3>
            <p className="text-neutral-300 leading-relaxed">
              Watch pages display an approximate viewer count from lightweight presence events published to configured relays.
            </p>
          </div>
        </section>

      </main>
    </div>
  );
}
