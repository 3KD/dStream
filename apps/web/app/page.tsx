"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Play, Radio, Zap, Shield, ShieldCheck, Fingerprint, Network } from "lucide-react";
import { MoneroLogo } from "@/components/icons/MoneroLogo";
import { IdentityBadge } from "@/components/identity/IdentityBadge";
import { WalletBadge } from "@/components/identity/WalletBadge";
import { KeyringManager } from "@/components/settings/KeyringManager";
import { useTrustedPeers } from "@/context/TrustedPeersContext";
import { useNostrStreams } from "@/hooks/useNostrStreams";

const WORDS = [
  "Decentralized",
  "Unstoppable",
  "Permissionless",
  "Ownerless",
  "Private",
  "Global",
  "Resilient"
];

function RotatingPrism() {
  const [rotation, setRotation] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'raising' | 'hesitating' | 'rotating' | 'descending'>('idle');

  useEffect(() => {
    const interval = setInterval(() => {
      // Phase 1: Raise out of slot
      setPhase('raising');

      // Phase 2: Hesitate at peak
      setTimeout(() => {
        setPhase('hesitating');
      }, 600);

      // Phase 3: Rotate while raised
      setTimeout(() => {
        setPhase('rotating');
        setRotation((prev) => prev + 1);
      }, 1100);

      // Phase 4: Descend back into slot
      setTimeout(() => {
        setPhase('descending');
      }, 2100);

      // Phase 5: Idle
      setTimeout(() => {
        setPhase('idle');
      }, 2700);

    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Calculate word for each of the 4 faces based on the current rotation
  const getWordForFace = (faceIndex: number) => {
    const k = Math.floor((rotation - faceIndex + 2) / 4) * 4 + faceIndex;
    return WORDS[((k % WORDS.length) + WORDS.length) % WORDS.length];
  };

  // Determine Z-translation based on phase (3x more: 120px)
  const zTranslation = (phase !== 'idle' && phase !== 'descending') ? '120px' : '0px';

  return (
    <span className="prism-container inline-block w-[320px] md:w-[500px] text-right">
      <span
        className="prism-box"
        style={{
          transform: `translateZ(${zTranslation}) rotateX(${rotation * 90}deg)`,
          transition: phase === 'rotating'
            ? 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)'
            : 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)'
        }}
      >
        <span className="prism-face prism-front">
          <span>{getWordForFace(0)}</span>
        </span>
        <span className="prism-face prism-bottom">
          <span>{getWordForFace(1)}</span>
        </span>
        <span className="prism-face prism-back">
          <span>{getWordForFace(2)}</span>
        </span>
        <span className="prism-face prism-top">
          <span>{getWordForFace(3)}</span>
        </span>
      </span>
    </span>
  );
}



export default function Home() {
  const { streams, loading } = useNostrStreams(); // Decentralized Discovery
  const { trustedKeys, isTrusted } = useTrustedPeers();
  const [showTrustedOnly, setShowTrustedOnly] = useState(false);
  const [showKeyring, setShowKeyring] = useState(false);

  useEffect(() => {
    // If user has trusted keys, default to filtering
    if (trustedKeys.length > 0) {
      setShowTrustedOnly(true);
    }
  }, [trustedKeys.length]);

  // Legacy Registry code removed in favor of Nostr (Phase 5)
  // ...

  const visibleStreams = showTrustedOnly
    ? streams.filter(s => isTrusted(s.pubkey))
    : streams;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 p-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-black tracking-tighter bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
            dStream
          </h1>
          <div className="flex gap-4 items-center">
            <button
              onClick={() => setShowKeyring(!showKeyring)}
              className={`p-2 rounded-lg transition-colors ${showKeyring ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
              title="Manage Trusted Keyring"
            >
              <Shield className="w-5 h-5" />
            </button>
            <IdentityBadge />
            <Link href="/broadcast" className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium flex items-center gap-2 transition">
              <Radio className="w-4 h-4" />
              Start Streaming
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">

        {/* Hero Section */}
        {/* Hero Section */}
        <section className="py-20 text-center space-y-6">
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter flex flex-wrap justify-center items-center gap-x-4">
            <RotatingPrism />
            <span className="bg-gradient-to-br from-white to-neutral-500 bg-clip-text text-transparent">
              Streaming.
            </span>
          </h2>

          <p className="text-xl text-neutral-400 max-w-2xl mx-auto">
            The world's first <span className="text-white font-semibold">DeFi-Native</span> broadcasting protocol.
            <br />
            Part of the <span className="text-blue-400 font-semibold">d-Series</span>: Independent apps for the decentralized economy.
          </p>
          <div className="flex gap-4 justify-center pt-6">
            <Link href="/broadcast" className="px-8 py-4 bg-white text-black font-bold rounded-full hover:bg-neutral-200 transition">
              Start Broadcasting
            </Link>
            <Link href="/docs" className="px-8 py-4 bg-neutral-900 border border-neutral-800 text-white font-bold rounded-full hover:bg-neutral-800 transition">
              Documentation
            </Link>
          </div>
        </section>

        {/* Features Grid */}
        <section className="grid md:grid-cols-3 gap-6 mb-24">

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

        {showKeyring && (
          <div className="mb-8 animate-in fade-in slide-in-from-top-4 duration-300">
            <KeyringManager />
          </div>
        )}

        {/* Live Now Section */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Live Now ({visibleStreams.length})
            </h2>

            {/* Filter Toggle */}
            <button
              onClick={() => setShowTrustedOnly(!showTrustedOnly)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${showTrustedOnly
                ? 'bg-green-900/30 text-green-400 border border-green-800'
                : 'bg-neutral-900 text-neutral-500 border border-neutral-800 hover:border-neutral-700'
                }`}
            >
              {showTrustedOnly ? <ShieldCheck className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
              {showTrustedOnly ? 'Trusted Only' : 'All Streams'}
            </button>
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
                  key={stream.pubkey}
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
                    <h3 className="font-bold text-lg mb-1 line-clamp-1">
                      {stream.metadata?.title || "Untitled Stream"}
                    </h3>
                    <p className="text-sm text-neutral-500 font-mono flex items-center gap-1">
                      {stream.pubkey.substring(0, 16)}...
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Quick Links */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            href="/watch/test"
            className="p-6 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-blue-500/50 transition group"
          >
            <h3 className="text-xl font-bold mb-2 group-hover:text-blue-400 transition">
              Test Channel →
            </h3>
            <p className="text-neutral-500">
              View the demo FFmpeg test pattern stream
            </p>
          </Link>

          <Link
            href="/broadcast"
            className="p-6 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-purple-500/50 transition group"
          >
            <h3 className="text-xl font-bold mb-2 group-hover:text-purple-400 transition">
              Start Streaming →
            </h3>
            <p className="text-neutral-500">
              Learn how to broadcast to the network
            </p>
          </Link>
        </section>
      </main>
    </div>
  );
}
