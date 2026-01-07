"use client";

import { useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { useGlobalSearch, SearchResult } from "@/hooks/useGlobalSearch";
import { KIND_STREAM_ANNOUNCE } from "@/lib/nostr";
import Link from "next/link";
import { Search, Loader2, Play, User as UserIcon, ShieldCheck } from "lucide-react";
import { useTrustedPeers } from "@/context/TrustedPeersContext";

export default function SearchPage() {
    const searchParams = useSearchParams();
    const query = searchParams.get('q') || '';
    const { results, loading } = useGlobalSearch(query);
    const { isTrusted } = useTrustedPeers();

    const streams = results.filter(r => r.kind === KIND_STREAM_ANNOUNCE);
    const profiles = results.filter(r => r.kind === 0);

    return (
        <div className="min-h-screen bg-neutral-950 text-white">
            <Header />

            <main className="max-w-7xl mx-auto p-6">
                <div className="mb-10">
                    <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
                        <Search className="w-8 h-8 text-blue-500" />
                        Search Results
                    </h1>
                    <p className="text-neutral-400">
                        Querying the global Nostr network for: <span className="text-white font-mono bg-neutral-900 px-2 py-1 rounded">{query}</span>
                    </p>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
                        <p className="text-neutral-500">Searching relays...</p>
                    </div>
                ) : results.length === 0 ? (
                    <div className="p-12 border border-dashed border-neutral-800 rounded-xl text-center">
                        <p className="text-neutral-500">No results found for "{query}".</p>
                    </div>
                ) : (
                    <div className="space-y-12">
                        {/* Profiles Section */}
                        {profiles.length > 0 && (
                            <section>
                                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                                    <UserIcon className="w-5 h-5 text-purple-400" />
                                    Profiles ({profiles.length})
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {profiles.map(p => (
                                        <div key={p.id} className="p-4 bg-neutral-900 rounded-xl border border-neutral-800 flex items-center gap-4 hover:border-neutral-700 transition">
                                            <div className="w-12 h-12 bg-neutral-800 rounded-full overflow-hidden flex-shrink-0">
                                                {p.image ? (
                                                    <img src={p.image} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-neutral-500">
                                                        <UserIcon className="w-6 h-6" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="overflow-hidden">
                                                <div className="font-bold truncate flex items-center gap-1">
                                                    {p.displayName || p.name}
                                                    {isTrusted(p.pubkey) && <ShieldCheck className="w-3 h-3 text-green-500" />}
                                                </div>
                                                {p.nip05 && <div className="text-xs text-purple-400 truncate">{p.nip05}</div>}
                                                <div className="text-xs text-neutral-500 font-mono truncate">{p.pubkey.substring(0, 10)}...</div>
                                            </div>
                                            <a
                                                href={`/watch/default?pubkey=${p.pubkey}`} // Link to watch page for this user
                                                className="ml-auto px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs font-medium transition"
                                            >
                                                Visit
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Streams Section */}
                        {streams.length > 0 && (
                            <section>
                                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                                    <Play className="w-5 h-5 text-red-500" />
                                    Streams & Channels ({streams.length})
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {streams.map(s => (
                                        <Link
                                            href={`/watch/${s.title || 'default'}?pubkey=${s.pubkey}`}
                                            key={s.id}
                                            className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition relative"
                                        >
                                            <div className="aspect-video bg-neutral-800 flex items-center justify-center relative">
                                                {s.image ? (
                                                    <img src={s.image} alt="" className="w-full h-full object-cover opacity-50 group-hover:opacity-80 transition" />
                                                ) : (
                                                    <Play className="w-12 h-12 text-white/20 group-hover:text-white/50 transition" />
                                                )}
                                            </div>
                                            <div className="p-4">
                                                <h3 className="font-bold text-lg line-clamp-1 group-hover:text-blue-400 transition">
                                                    {s.title || "Untitled Stream"}
                                                </h3>
                                                {s.summary && <p className="text-sm text-neutral-400 line-clamp-2 mt-1">{s.summary}</p>}
                                                <div className="mt-3 flex flex-wrap gap-1">
                                                    {s.tags?.slice(0, 3).map(t => (
                                                        <span key={t} className="px-2 py-0.5 bg-neutral-800 text-neutral-400 text-xs rounded-full">
                                                            #{t}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
