"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import Link from "next/link";
import { Search, Loader2, Play } from "lucide-react";

// Separated component for useSearchParams to be wrapped in Suspense
// Required by Next.js 13+ App Router
function SearchContent() {
    const searchParams = useSearchParams();
    const query = searchParams.get('q') || '';
    const { results, loading } = useGlobalSearch(query);

    return (
        <main className="max-w-7xl mx-auto p-6">
            <div className="mb-10">
                <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
                    <Search className="w-8 h-8 text-blue-500" />
                    Search Results
                </h1>
                <p className="text-neutral-400">
                    Querying the decentralized network for: <span className="text-white font-mono bg-neutral-900 px-2 py-1 rounded">{query}</span>
                </p>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20">
                    <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
                    <p className="text-neutral-500">Scanning Peer Swarm...</p>
                </div>
            ) : results.length === 0 ? (
                <div className="p-12 border border-dashed border-neutral-800 rounded-xl text-center">
                    <p className="text-neutral-500">No active streams found for "{query}".</p>
                </div>
            ) : (
                <div className="space-y-12">
                    <section>
                        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                            <Play className="w-5 h-5 text-red-500" />
                            Streams ({results.length})
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {results.map(s => (
                                <Link
                                    href={`/watch/${s.id}?pubkey=${s.pubkey}`}
                                    key={s.id}
                                    className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition relative"
                                >
                                    <div className="aspect-video bg-neutral-800 flex items-center justify-center relative">
                                        {s.image ? (
                                            <img src={s.image} alt="" className="w-full h-full object-cover opacity-50 group-hover:opacity-80 transition" />
                                        ) : (
                                            <Play className="w-12 h-12 text-white/20 group-hover:text-white/50 transition" />
                                        )}
                                        {s.status === 'live' && (
                                            <div className="absolute top-2 left-2 bg-red-600 px-2 py-1 text-xs font-bold rounded flex items-center gap-1">
                                                <span className="w-2 h-2 bg-white rounded-full animate-pulse" /> LIVE
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-4">
                                        <h3 className="font-bold text-lg line-clamp-1 group-hover:text-blue-400 transition">
                                            {s.title || "Untitled Stream"}
                                        </h3>
                                        {s.description && <p className="text-sm text-neutral-400 line-clamp-2 mt-1">{s.description}</p>}
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
            )}
        </main>
    );
}

export default function SearchPage() {
    return (
        <div className="min-h-screen bg-black text-white">
            <Header />
            <Suspense fallback={<div className="p-12 text-center text-neutral-500">Loading Search...</div>}>
                <SearchContent />
            </Suspense>
        </div>
    );
}
