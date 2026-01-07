"use client";

import Link from "next/link";
import { useEffect, useState, useMemo, useRef } from "react";
import {
  Play, Radio, Zap, Shield, ShieldCheck, Fingerprint, Network,
  Unlock, Users, EyeOff, Globe, Database, Flag, Banknote, PenTool,
  Megaphone, Music, Camera, Gamepad, FileText, Heart, Shuffle,
  Book, ArrowLeft, Compass, type LucideIcon
} from "lucide-react";
import { MoneroLogo } from "@/components/icons/MoneroLogo";
import { IdentityBadge } from "@/components/identity/IdentityBadge";
import { WalletBadge } from "@/components/identity/WalletBadge";
import { Header } from "@/components/layout/Header";
import { KeyringModal } from "@/components/settings/KeyringModal";
import { useTrustedPeers } from "@/context/TrustedPeersContext";
import { useFavorites } from "@/context/FavoritesContext";
import { useNostrStreams } from "@/hooks/useNostrStreams";
import { useNostrGuilds } from "@/hooks/useNostrGuilds";
import { SearchFilter } from "@/components/discovery/SearchFilter";
import { PlatformDonationModal } from "@/components/tipping/PlatformDonationModal";
import { useRouter } from "next/navigation";

const WORDS = [
  "Decentralized",
  "Unstoppable",
  "P2P",
  "Ownerless",
  "Private",
  "Permissionless",
  "Global",
  "Journalism",
  "Activism",
  "Music",
  "Gamer",
  "Influencer",
  "Independent"
];

// Icon + color for each word
const WORD_ICONS: Record<string, { icon?: LucideIcon; img?: string; color: string }> = {
  "Decentralized": { img: "/logo_trimmed.png", color: "text-purple-400" },
  "Unstoppable": { icon: ShieldCheck, color: "text-green-400" },
  "Permissionless": { icon: Unlock, color: "text-yellow-400" },
  "Ownerless": { icon: Users, color: "text-blue-400" },
  "Private": { icon: EyeOff, color: "text-red-400" },
  "P2P": { icon: Network, color: "text-cyan-400" },
  "Global": { icon: Globe, color: "text-emerald-400" },
  "Journalism": { icon: PenTool, color: "text-orange-400" },
  "Activism": { icon: Megaphone, color: "text-pink-400" },
  "Music": { icon: Music, color: "text-violet-400" },
  "Influencer": { icon: Camera, color: "text-rose-400" },
  "Gamer": { icon: Gamepad, color: "text-lime-400" },
  "Independent": { icon: Flag, color: "text-amber-400" },
};

// Hex colors for CSS transitions (Tailwind classes don't animate)
const WORD_COLORS_HEX: Record<string, string> = {
  "Decentralized": "#ffffff", // white
  "Unstoppable": "#4ade80", // green-400
  "Permissionless": "#facc15", // yellow-400
  "Ownerless": "#60a5fa", // blue-400
  "Private": "#f87171", // red-400
  "P2P": "#22d3ee", // cyan-400
  "Global": "#34d399", // emerald-400
  "Journalism": "#fb923c", // orange-400
  "Activism": "#f472b6", // pink-400
  "Music": "#a78bfa", // violet-400
  "Influencer": "#fb7185", // rose-400
  "Gamer": "#a3e635", // lime-400
  "Independent": "#fbbf24", // amber-400
};

/**
 * RotatingCube - Clean implementation from scratch
 * 
 * KEY PRINCIPLE: 4 physical faces store 4 words as STATE.
 * Words are LOCKED to their physical face.
 * CSS rotation brings different faces into view.
 * We only update the BACK face (hidden from view) before rotation starts.
 */
interface RotatingCubeProps {
  onWordChange?: (word: string) => void;
}

function RotatingCube({ onWordChange }: RotatingCubeProps) {
  // CSS rotation angle (multiples of 90)
  const [rotationCount, setRotationCount] = useState(0);

  // Is cube currently lifted?
  const [isLifted, setIsLifted] = useState(false);

  // The 4 physical faces with their FIXED words
  // Index: 0=Front, 1=Bottom, 2=Back, 3=Top (in initial position)
  // Sequence of appearance: 0 -> 3 -> 2 -> 1
  const [faces, setFaces] = useState<[string, string, string, string]>([
    WORDS[0], // Face 0: 1st (decentralized)
    WORDS[3], // Face 1: 4th (Private)
    WORDS[2], // Face 2: 3rd (Global)
    WORDS[1], // Face 3: 2nd (Unstoppable)
  ]);

  // Track rotation and word index with REFS to avoid recreating interval
  // Start at index 2 (Global) because 0 and 1 are already set on faces 0 and 3
  const nextWordIndexRef = useRef(2);
  const rotationCountRef = useRef(0);

  // Notify parent of current word when faces change
  useEffect(() => {
    const faceSequence = [0, 3, 2, 1];
    const frontIdx = faceSequence[rotationCount % 4];
    onWordChange?.(faces[frontIdx]);
  }, [rotationCount, faces, onWordChange]);

  useEffect(() => {
    const runCycle = () => {
      // STEP 1: Before lifting, update the BACK face with the next word
      // With rotateX(-90deg), sequence is: 0 -> 3 -> 2 -> 1 -> 0
      // Back face relative to current front is +2 in sequence
      const currentRotation = rotationCountRef.current;
      // Calculate which physical face index is at the back right now
      const faceSequence = [0, 3, 2, 1]; // Order faces appear at front
      const backIdx = faceSequence[(currentRotation + 2) % 4];

      setFaces(prev => {
        const next = [...prev] as [string, string, string, string];
        next[backIdx] = WORDS[nextWordIndexRef.current % WORDS.length];
        nextWordIndexRef.current += 1;
        return next;
      });

      // STEP 2: Lift the cube (0ms)
      setIsLifted(true);

      // STEP 3: Begin rotation (1200ms) - CSS transition handles animation
      setTimeout(() => {
        rotationCountRef.current += 1;
        setRotationCount(rotationCountRef.current);
      }, 1200);

      // STEP 4: Descend (2500ms)
      setTimeout(() => {
        setIsLifted(false);
      }, 2500);
    };

    // Initial delay then start cycling
    const timeout = setTimeout(runCycle, 1000);
    const interval = setInterval(runCycle, 3900); // 1.2s Lift + 1.2s Rotate + 1.2s Descend (starts at 2.5s) + 200ms pause = 3.9s

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []); // EMPTY dependency array - interval created only once

  // Calculate CSS transform
  const liftZ = isLifted ? "1.5em" : "0";
  const rotateX = rotationCount * -90; // Negative = scroll up (top comes to front)

  // Current visible face (for ghost element sizing)
  const faceSequence = [0, 3, 2, 1];
  const visibleFaceIndex = faceSequence[rotationCount % 4];
  const currentWord = faces[visibleFaceIndex];
  const iconConfig = WORD_ICONS[currentWord || ""];
  const isBrand = (currentWord || "") === "Decentralized";

  return (
    <span className="machined-scene">
      {/* Ghost element for width sizing - includes icon width */}
      <span
        className="machined-text opacity-0 invisible pointer-events-none select-none flex items-center gap-3 md:gap-5"
        aria-hidden="true"
      >
        {iconConfig && (
          iconConfig.img ? (
            <img
              src={iconConfig.img}
              className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 object-contain ${isBrand ? "scale-[1.14]" : ""}`}
              alt=""
            />
          ) : (
            <span className="w-12 h-12 md:w-20 md:h-20 flex-shrink-0" />
          )
        )}
        {currentWord}
      </span>

      {/* The 3D cube - NO gradient on faces */}
      <span
        className="machined-cube"
        style={{
          transform: `translateZ(${liftZ}) rotateX(${rotateX}deg)`,
          transition: "transform 1.2s ease-in-out"
        }}
      >
        {faces.map((word, i) => {
          const faceClasses = [
            "machined-cube-face-front",
            "machined-cube-face-bottom",
            "machined-cube-face-back",
            "machined-cube-face-top"
          ];
          const wordIconConfig = WORD_ICONS[word];
          const Icon = wordIconConfig?.icon;

          const isBrand = word === "Decentralized";

          // VISIBILITY FIX: Solid Physics + Clean Bottom.
          // - Front: Visible (Snaps in).
          // - Top/Back: Hidden.
          // - Bottom: Visible during rotation, then Snaps Out (Delayed).
          const currentRotation = rotationCount;
          const faceSequence = [0, 3, 2, 1];
          const frontFaceIdx = faceSequence[currentRotation % 4];
          const bottomFaceIdx = faceSequence[(currentRotation + 3) % 4];

          const isVisible = (i === frontFaceIdx); // Strict: Only Front is permanent.
          const isLeaving = (i === bottomFaceIdx);

          return (
            <span
              key={i}
              className={`machined-cube-face ${faceClasses[i]} ${isVisible ? "opacity-100" : "opacity-0"} bg-neutral-950`}
              style={{
                backgroundColor: "#0a0a0a",
                // SNAP LOGIC: Instant Opacity change (0s).
                // Delay Bottom hide by 1.1s (Matches 1.2s rotation) to allow FULL rotation, then vanish.
                transition: "opacity 0s, background 0.2s, box-shadow 0.2s",
                transitionDelay: isLeaving ? "1.1s" : "0s"
              }}
            >
              <span className="machined-text flex flex-row items-center whitespace-nowrap gap-3 md:gap-5">
                {wordIconConfig.img ? (
                  <img
                    src={wordIconConfig.img}
                    className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 object-contain ${isBrand ? "scale-[1.14]" : ""}`}
                    alt=""
                  />
                ) : (
                  Icon && <Icon className={`w-12 h-12 md:w-20 md:h-20 flex-shrink-0 ${wordIconConfig.color}`} aria-hidden="true" />
                )}
                <span className={isBrand ? "bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent" : "text-white"}>
                  {word}
                </span>
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}


export default function Home() {
  const { streams, loading } = useNostrStreams(); // Decentralized Discovery
  const { guilds } = useNostrGuilds();
  const { trustedKeys, isTrusted } = useTrustedPeers();
  const { favorites, isFavorite } = useFavorites();
  const [showTrustedOnly, setShowTrustedOnly] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [currentWord, setCurrentWord] = useState(WORDS[0]); // Track current cube word

  // Search & Discovery State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const router = useRouter();

  const handleRandomSearch = () => {
    if (visibleStreams.length === 0) return;
    const randomStream = visibleStreams[Math.floor(Math.random() * visibleStreams.length)];
    const path = `/watch/${randomStream.stream_id === 'default' ? 'test' : randomStream.stream_id}?pubkey=${randomStream.pubkey}`;
    router.push(path);
  };

  const isDecentralized = currentWord.toLowerCase() === "decentralized";

  useEffect(() => {
    // If user has trusted keys, default to filtering
    if (trustedKeys.length > 0) {
      setShowTrustedOnly(true);
    }
  }, [trustedKeys.length]);

  // Legacy Registry code removed in favor of Nostr (Phase 5)
  // ...

  const visibleStreams = useMemo(() => {
    // 1. Identify Guild-featured streams
    const guildFeatured = guilds
      .filter(g => g.featured)
      .map(g => {
        const stream = streams.find(s => s.pubkey === g.featured?.pubkey && s.stream_id === g.featured?.stream_id);
        if (!stream) return null;
        return {
          ...stream,
          featuredBy: g.name,
          guildId: g.id
        };
      })
      .filter(Boolean) as (any)[];

    // 2. Filter base streams
    let filtered = [...streams];

    // Merge guild info into base streams if they are featured
    filtered = filtered.map(s => {
      const g = guilds.find(g => g.featured?.pubkey === s.pubkey && g.featured?.stream_id === s.stream_id);
      if (g) return { ...s, featuredBy: g.name };
      return s;
    });

    // 3. Apply Categories
    if (selectedCategory === "Guilds") {
      return guildFeatured;
    }

    if (selectedCategory) {
      filtered = filtered.filter(s =>
        s.metadata.tags?.some(t => t.toLowerCase() === selectedCategory.toLowerCase())
      );
    }

    return filtered.filter(s => {
      // 1. Trusted Filter
      if (showTrustedOnly && !isTrusted(s.pubkey)) return false;

      // 2. Favorites Filter
      if (showFavoritesOnly && !isFavorite(s.stream_id)) return false;

      // 4. Search Query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const titleMatch = s.metadata.title?.toLowerCase().includes(query);
        const summaryMatch = s.metadata.summary?.toLowerCase().includes(query);
        const tagMatch = s.metadata.tags?.some(t => t.toLowerCase().includes(query));
        const pubkeyMatch = s.pubkey.includes(query);

        if (!titleMatch && !summaryMatch && !tagMatch && !pubkeyMatch) return false;
      }

      return true;
    });
  }, [streams, guilds, showTrustedOnly, showFavoritesOnly, selectedCategory, searchQuery, isTrusted, isFavorite]);

  const handleSearch = (query: string) => {
    if (!query.trim()) return;
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <PlatformDonationModal isOpen={showDonationModal} onClose={() => setShowDonationModal(false)} />

      <Header />

      <main id="main-content" className="max-w-7xl mx-auto p-6">

        {/* Hero Section */}
        <section className="py-20 text-center space-y-6 overflow-x-clip">
          {/* VERTICAL LAYOUT: Cube centered above text for easy alignment */}
          <h2 className="text-5xl md:text-8xl font-black tracking-tighter flex flex-col items-center justify-center gap-6">
            <RotatingCube onWordChange={setCurrentWord} />
            {/* Dynamic "Streaming" text - color changes with cube */}
            <span
              className="pb-[0.2em] transition-colors duration-[2000ms] ease-in-out"
              style={{
                color: WORD_COLORS_HEX[currentWord] || '#a855f7',
              }}
            >
              Streaming
            </span>
          </h2>

          <p className="text-xl text-neutral-400 max-w-2xl mx-auto">
            <span className="text-blue-500">dStream</span> - The world's first decentralized broadcasting protocol.
            <br />
            Enabling independence in the information age economy.
          </p>
          <div className="flex gap-4 justify-center pt-6">
            <Link href="/broadcast" className="px-8 py-4 bg-neutral-200 text-black font-bold rounded-full hover:bg-white hover:scale-105 hover:shadow-lg hover:shadow-white/20 active:scale-95 transition-all duration-200">
              Start Broadcasting
            </Link>
            <Link href="/use-cases" className="px-8 py-4 bg-neutral-600 border border-neutral-500 text-white font-bold rounded-full hover:bg-neutral-500 hover:scale-105 hover:shadow-lg hover:shadow-white/10 active:scale-95 transition-all duration-200">
              Who needs this?
            </Link>
          </div>
        </section>

        {/* Live Now Section */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Live Now ({visibleStreams.length})
            </h2>

            <div className="flex items-center">
              {/* Filter Toggle */}
              <button
                onClick={() => setShowTrustedOnly(!showTrustedOnly)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${showTrustedOnly
                  ? 'bg-green-900/30 text-green-400 border border-green-800'
                  : 'bg-neutral-900 text-neutral-500 border border-neutral-800 hover:border-neutral-700'
                  }`}
              >
                {showTrustedOnly ? <ShieldCheck className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                <span className="hidden sm:inline">{showTrustedOnly ? 'Trusted Only' : 'All Streams'}</span>
              </button>

              {/* Favorites Filter */}
              <button
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ml-2 ${showFavoritesOnly
                  ? 'bg-red-900/30 text-red-400 border border-red-800'
                  : 'bg-neutral-900 text-neutral-500 border border-neutral-800 hover:border-neutral-700'
                  }`}
              >
                <Heart className={`w-4 h-4 ${showFavoritesOnly ? 'fill-current' : ''}`} />
                <span className="hidden sm:inline">{showFavoritesOnly ? 'Favorites' : 'All'}</span>
              </button>

              {/* Browse Link */}
              <Link
                href="/browse"
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ml-2 bg-neutral-900 text-neutral-400 border border-neutral-800 hover:border-neutral-600 hover:text-white"
              >
                <Compass className="w-4 h-4" />
                <span>Browse</span>
              </Link>

              {/* Random Discovery */}
              <button
                onClick={handleRandomSearch}
                disabled={visibleStreams.length === 0}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ml-2 bg-blue-600/10 text-blue-400 border border-blue-500/30 hover:bg-blue-600/20 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Jump to a random live stream"
              >
                <Shuffle className="w-4 h-4" />
                <span className="hidden sm:inline">Shuffle</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="aspect-video bg-neutral-900 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : visibleStreams.length === 0 ? (
            <div className="p-12 border border-dashed border-neutral-800 rounded-xl text-center">
              <Zap className="w-12 h-12 mx-auto mb-4 text-neutral-700" />
              <p className="text-neutral-500 mb-4">
                {showTrustedOnly
                  ? "No live streams from your trusted network (via Nostr)."
                  : "No live streams found on Nostr relays."}
              </p>
              {showTrustedOnly && (
                <button
                  onClick={() => setShowTrustedOnly(false)}
                  className="text-blue-500 hover:underline"
                >
                  Show all public streams
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visibleStreams.map(stream => (
                <Link
                  href={`/watch/${stream.stream_id === 'default' ? 'test' : stream.stream_id}?pubkey=${stream.pubkey}`}
                  key={stream.nostrEventId || `${stream.pubkey}-${stream.stream_id}`}
                  className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition relative"
                >
                  <div className="aspect-video bg-neutral-800 flex items-center justify-center relative">
                    <Play className="w-12 h-12 text-white/20 group-hover:text-white/50 transition" />
                    <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                      Live
                    </div>
                    {isTrusted(stream.pubkey) && (
                      <div className="absolute top-2 right-2 bg-green-900/80 text-green-400 p-1 rounded-full backdrop-blur-sm">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-bold text-lg line-clamp-1 flex-1">
                        {stream.metadata?.title || "Untitled Stream"}
                      </h3>
                      {stream.featuredBy && (
                        <span className="text-[10px] px-2 py-0.5 bg-purple-900/40 text-purple-300 border border-purple-800/50 rounded-full flex items-center gap-1 ml-2 whitespace-nowrap">
                          <Zap className="w-2.5 h-2.5 fill-current" />
                          {stream.featuredBy}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-neutral-500 font-mono flex items-center gap-1">
                      {stream.pubkey.substring(0, 16)}...
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Search & Discovery */}
        <section className="mb-12">
          <SearchFilter
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            onSearch={handleSearch}
          />
        </section>

        {/* Quick Links */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            href="/docs"
            className="p-8 rounded-2xl bg-gradient-to-br from-neutral-900 to-neutral-800 border border-neutral-800 hover:border-blue-500/50 transition-all group shadow-xl"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-blue-900/30 rounded-xl text-blue-400 group-hover:scale-110 transition-transform">
                <Book className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold group-hover:text-blue-400 transition">
                How it Works
              </h3>
            </div>
            <p className="text-neutral-400 text-lg leading-relaxed">
              New to decentralized streaming? Read our simple guide on identity, P2P, and the private economy.
            </p>
            <div className="mt-4 text-blue-500 font-bold flex items-center gap-1 group-hover:gap-2 transition-all">
              Go to Documentation <ArrowLeft className="w-4 h-4 rotate-180" />
            </div>
          </Link>

          <Link
            href="/broadcast"
            className="p-8 rounded-2xl bg-gradient-to-br from-neutral-900 to-neutral-800 border border-neutral-800 hover:border-purple-500/50 transition-all group shadow-xl"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-purple-900/30 rounded-xl text-purple-400 group-hover:scale-110 transition-transform">
                <Radio className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold group-hover:text-purple-400 transition">
                Start Streaming
              </h3>
            </div>
            <p className="text-neutral-400 text-lg leading-relaxed">
              Ready to go live? Get your RTMP server details and learn how to configure OBS in minutes.
            </p>
            <div className="mt-4 text-purple-500 font-bold flex items-center gap-1 group-hover:gap-2 transition-all">
              Broadcaster Dashboard <ArrowLeft className="w-4 h-4 rotate-180" />
            </div>
          </Link>
        </section>

        {/* Features Grid */}
        <section className="grid md:grid-cols-3 gap-6 mt-24">
          {/* Card 1: Nostr Identity */}
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
            <p className="text-neutral-300 leading-relaxed">Identity is rooted in Nostr cryptography. No central authority can ban your keys or delete your followers.</p>
          </div>

          {/* Card 2: P2P Scale */}
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
            <h3 className="text-xl font-bold mb-2">P2P Distribution</h3>
            <p className="text-neutral-300 leading-relaxed">Viewers relay video segments to each other using WebTorrent, creating a resilient network that scales infinitely.</p>
          </div>

          {/* Card 3: Monero Tips */}
          <div className="p-6 bg-neutral-900/50 border border-neutral-800/50 rounded-2xl relative group overflow-hidden hover:border-orange-500/30 transition">
            <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-30 transition pointer-events-none">
              <MoneroLogo className="w-24 h-24 text-orange-500" />
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-orange-900/30 rounded-lg text-orange-400">
                <MoneroLogo className="w-5 h-5" />
              </div>
              <span className="font-mono text-xs text-orange-400 uppercase tracking-wider font-bold">Monero Tips</span>
            </div>
            <h3 className="text-xl font-bold mb-2">Private Economy</h3>
            <p className="text-neutral-300 leading-relaxed">Integrated Monero subaddresses allow for private, untraceable tipping and escrow without KYC.</p>
          </div>
        </section>
      </main>

      {/* Site Footer */}
      <footer className="border-t border-neutral-800 mt-20 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6 text-sm text-neutral-300">
          <div className="flex items-center gap-2">
            <span className="font-bold text-neutral-300">dStream Protocol</span>
            <span>v1.0.0</span>
          </div>

          <div className="flex items-center gap-6">
            <Link href="/whitepaper" className="hover:text-blue-400 transition flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Technical Whitepaper
            </Link>
            <a href="https://github.com/dstream-protocol" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300 transition">
              GitHub
            </a>
            <Link href="/docs" className="text-blue-400 hover:text-blue-300 transition">
              Documentation
            </Link>
            <button
              onClick={() => setShowDonationModal(true)}
              className="text-green-400 hover:text-green-300 transition font-medium"
            >
              ❤️ Support dStream
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
