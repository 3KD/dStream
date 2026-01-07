"use client";

import { useMemo, useState } from "react";
import { Header } from "@/components/layout/Header";
import { SearchFilter } from "@/components/discovery/SearchFilter";
import { useNostrStreams } from "@/hooks/useNostrStreams";
import { useNostrGuilds } from "@/hooks/useNostrGuilds";
import { useTrustedPeers } from "@/context/TrustedPeersContext";
import { useFavorites } from "@/context/FavoritesContext";
import Link from "next/link";
import { Play, ShieldCheck, Zap, Search, Radio, SlidersHorizontal, Shield, Heart, Shuffle } from "lucide-react";
import { useRouter } from "next/navigation";

export default function BrowsePage() {
    const { streams, loading } = useNostrStreams();
    const { guilds } = useNostrGuilds();
    const { isTrusted } = useTrustedPeers();
    const { isFavorite } = useFavorites();

    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [showTrustedOnly, setShowTrustedOnly] = useState(false);
    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
    const router = useRouter();

    const handleRandomSearch = () => {
        if (visibleStreams.length === 0) return;
        const randomStream = visibleStreams[Math.floor(Math.random() * visibleStreams.length)];
        const path = `/watch/${randomStream.stream_id === 'default' ? 'test' : randomStream.stream_id}?pubkey=${randomStream.pubkey}`;
        router.push(path);
    };

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

        // 4. Advanced Filters
        return filtered.filter(s => {
            // A. Trusted Filter
            if (showTrustedOnly && !isTrusted(s.pubkey)) return false;

            // B. Favorites Filter
            if (showFavoritesOnly && !isFavorite(s.stream_id)) return false;

            // C. Search Query
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
    }, [streams, guilds, selectedCategory, searchQuery, isTrusted, isFavorite, showTrustedOnly, showFavoritesOnly]);

    return (
        <div className="min-h-screen bg-neutral-950 text-white selection:bg-blue-500/30">
            <Header />

            <main className="max-w-7xl mx-auto px-6 py-12">
                {/* Header Section */}
                <div className="mb-12 grid grid-cols-1 md:grid-cols-3 gap-8 items-end">
                    <div className="space-y-2 md:col-span-2">
                        <div className="flex items-center gap-3 text-blue-500 font-mono text-sm font-bold tracking-widest uppercase">
                            <Radio className="w-4 h-4" />
                            Live Network
                        </div>
                        <h1 className="text-5xl md:text-6xl font-black tracking-tighter">
                            Discovery <span className="text-neutral-500">Center</span>
                        </h1>
                    </div>

                    <div className="w-fit flex items-center gap-4 bg-neutral-900/50 p-4 rounded-2xl border border-white/5 backdrop-blur-sm">
                        <div className="text-right">
                            <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest leading-none mb-1">Network Status</p>
                            <p className="text-xs font-bold text-green-500 flex items-center gap-2 justify-end">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                {streams.length} ACTIVE NODES
                            </p>
                        </div>
                    </div>
                </div>

                {/* Filters & Search */}
                <div className="sticky top-20 z-40 mb-12 py-4 bg-neutral-950/80 backdrop-blur-xl -mx-6 px-6 border-y border-white/5">
                    <div className="flex flex-col gap-4">
                        <SearchFilter
                            searchQuery={searchQuery}
                            setSearchQuery={setSearchQuery}
                            selectedCategory={selectedCategory}
                            setSelectedCategory={setSelectedCategory}
                        />

                        <div className="flex items-center gap-3 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
                            <button
                                onClick={() => setShowTrustedOnly(!showTrustedOnly)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ring-1 ${showTrustedOnly
                                    ? 'bg-green-500/10 text-green-400 ring-green-500/30'
                                    : 'bg-neutral-900/50 text-neutral-400 ring-white/5 hover:ring-white/10'
                                    }`}
                            >
                                {showTrustedOnly ? <ShieldCheck className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                                {showTrustedOnly ? 'Trusted Only' : 'All Streams'}
                            </button>

                            <button
                                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ring-1 ${showFavoritesOnly
                                    ? 'bg-red-500/10 text-red-400 ring-red-500/30'
                                    : 'bg-neutral-900/50 text-neutral-400 ring-white/5 hover:ring-white/10'
                                    }`}
                            >
                                <Heart className={`w-4 h-4 ${showFavoritesOnly ? 'fill-current' : ''}`} />
                                Favorites
                            </button>

                            <div className="w-px h-6 bg-white/5 mx-1 flex-shrink-0" />

                            <button
                                onClick={handleRandomSearch}
                                disabled={visibleStreams.length === 0}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/30 rounded-xl text-sm font-bold hover:bg-blue-500/20 active:scale-95 transition-all disabled:opacity-30 disabled:scale-100 whitespace-nowrap"
                            >
                                <Shuffle className="w-4 h-4" />
                                Shuffle
                            </button>
                        </div>
                    </div>
                </div>

                {/* Results Grid */}
                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                            <div key={i} className="aspect-video bg-neutral-900/50 rounded-2xl animate-pulse border border-white/5" />
                        ))}
                    </div>
                ) : visibleStreams.length === 0 ? (
                    <div className="py-32 flex flex-col items-center justify-center text-center">
                        <div className="w-20 h-20 bg-neutral-900 rounded-3xl flex items-center justify-center mb-6 ring-1 ring-white/10">
                            <Search className="w-8 h-8 text-neutral-600" />
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">No results found</h3>
                        <p className="text-neutral-500 max-w-sm">
                            We couldn't find any streams matching your search criteria. Try a different keyword or category.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {visibleStreams.map(stream => (
                            <Link
                                href={`/watch/${stream.stream_id === 'default' ? 'test' : stream.stream_id}?pubkey=${stream.pubkey}`}
                                key={stream.nostrEventId || `${stream.pubkey}-${stream.stream_id}`}
                                className="group flex flex-col bg-neutral-900/40 rounded-3xl overflow-hidden border border-white/5 hover:border-blue-500/40 transition-all duration-300 hover:shadow-[0_0_30px_rgba(59,130,246,0.1)] relative"
                            >
                                <div className="aspect-video bg-neutral-800/50 relative overflow-hidden">
                                    {/* Play Overlay */}
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 bg-black/40 backdrop-blur-[2px] z-10">
                                        <div className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center scale-75 group-hover:scale-100 transition-transform duration-300 shadow-xl">
                                            <Play className="w-5 h-5 fill-current" />
                                        </div>
                                    </div>

                                    {/* Thumbnail Placeholder */}
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Radio className="w-12 h-12 text-white/5 group-hover:text-white/10 transition-colors" />
                                    </div>

                                    {/* Badges */}
                                    <div className="absolute top-4 left-4 z-20 flex gap-2">
                                        <div className="bg-red-600 text-white text-[10px] uppercase font-black px-2 py-0.5 rounded-lg flex items-center gap-1.5 shadow-lg">
                                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                                            Live
                                        </div>
                                    </div>

                                    {isTrusted(stream.pubkey) && (
                                        <div className="absolute top-4 right-4 z-20 p-1.5 bg-green-500/20 backdrop-blur-md rounded-xl border border-green-500/30 text-green-400">
                                            <ShieldCheck className="w-4 h-4" />
                                        </div>
                                    )}
                                </div>

                                <div className="p-5 space-y-3">
                                    <div className="h-12 flex flex-col justify-center">
                                        <h3 className="font-bold text-white group-hover:text-blue-400 transition-colors line-clamp-2 leading-tight">
                                            {stream.metadata?.title || "Untitled Transmission"}
                                        </h3>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <div className="w-6 h-6 rounded-full bg-neutral-800 border border-white/10 flex-shrink-0 flex items-center justify-center text-[10px] font-bold">
                                                {stream.pubkey[0].toUpperCase()}
                                            </div>
                                            <span className="text-[10px] font-mono text-neutral-500 truncate">
                                                {stream.pubkey.substring(0, 12)}...
                                            </span>
                                        </div>

                                        {stream.featuredBy && (
                                            <span className="text-[9px] font-black px-2 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg flex items-center gap-1 leading-none">
                                                <Zap className="w-2.5 h-2.5 fill-current" />
                                                {stream.featuredBy.toUpperCase()}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
