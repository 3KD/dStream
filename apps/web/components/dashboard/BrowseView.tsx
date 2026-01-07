"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User, Radio, Users, Play } from "lucide-react";
import { pool, RELAYS } from "@/lib/nostr";

interface StreamEvent {
    id: string;
    pubkey: string;
    dTag: string;
    title?: string;
    summary?: string;
    image?: string;
    status?: string;
    starts?: number;
    viewers?: number;
}

export function BrowseView() {
    const [streams, setStreams] = useState<StreamEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        setIsLoading(true);

        // Single filter object as validated in previous task
        const filter = {
            kinds: [30311],
            '#status': ['live'],
            limit: 50
        };

        console.log("[BrowseView] Subscribing to global streams with filter:", filter);

        const sub = pool.subscribeMany(RELAYS, filter as any, {
            onevent(event) {
                // Parse tags
                const dTag = event.tags.find(t => t[0] === 'd')?.[1];
                const title = event.tags.find(t => t[0] === 'title')?.[1];
                const summary = event.tags.find(t => t[0] === 'summary')?.[1];
                const image = event.tags.find(t => t[0] === 'image')?.[1];
                const status = event.tags.find(t => t[0] === 'status')?.[1];
                const starts = parseInt(event.tags.find(t => t[0] === 'starts')?.[1] || "0");

                // Construct stream object
                if (dTag && status === 'live') {
                    const stream: StreamEvent = {
                        id: event.id,
                        pubkey: event.pubkey,
                        dTag: dTag,
                        title: title || dTag,
                        summary,
                        image,
                        status,
                        starts
                    };

                    setStreams(prev => {
                        // Deduplicate by dTag (update existing if newer)
                        const existing = prev.findIndex(s => s.dTag === dTag);
                        if (existing !== -1) {
                            if (prev[existing].id === event.id) return prev; // Exact same event
                            // If we wanted to handle replacements/updates we could, 
                            // but usually 30311 is replaceable so we just overwrite.
                            const newStreams = [...prev];
                            newStreams[existing] = stream;
                            return newStreams;
                        }
                        return [...prev, stream];
                    });
                }
            },
            oneose() {
                setIsLoading(false);
            }
        });

        return () => sub.close();
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/10 rounded-lg">
                    <Radio className="w-6 h-6 text-purple-500" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold">Live Streams</h2>
                    <p className="text-neutral-400 text-sm">Discover decentralized broadcasts from across the network</p>
                </div>
            </div>

            {isLoading && streams.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
                    <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <p>Scanning relays for functional streams...</p>
                </div>
            ) : streams.length === 0 ? (
                <div className="text-center py-20 bg-neutral-900/50 rounded-xl border border-neutral-800">
                    <Radio className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
                    <h3 className="text-lg font-bold text-neutral-300">No streams found</h3>
                    <p className="text-neutral-500 max-w-sm mx-auto mt-2 mb-6">
                        The network seems quiet right now. Be the first to go live!
                    </p>
                    <Link
                        href="/dashboard?tab=broadcast"
                        className="px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-bold transition-all"
                    >
                        Go Live Now
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {streams.map(stream => (
                        <Link
                            key={stream.id}
                            href={`/watch/${stream.dTag}`}
                            className="group bg-neutral-900 border border-neutral-800 hover:border-purple-500/50 rounded-xl overflow-hidden transition-all hover:shadow-2xl hover:shadow-purple-900/10 block"
                        >
                            {/* Thumbnail Area */}
                            <div className="aspect-video bg-neutral-950 relative overflow-hidden">
                                {stream.image ? (
                                    <img
                                        src={stream.image}
                                        alt={stream.title}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-neutral-700 group-hover:text-neutral-600 transition-colors">
                                        <Play className="w-12 h-12 mb-2 opacity-50" />
                                        <span className="text-xs font-bold uppercase tracking-wider opacity-50">No Thumbnail</span>
                                    </div>
                                )}

                                {/* Live Badge */}
                                <div className="absolute top-3 right-3 px-2 py-1 bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider rounded flex items-center gap-1 shadow-lg">
                                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                                    LIVE
                                </div>

                                {/* Viewer Count Overlay (Mock for now, would start NIP-04/13 fetch) */}
                                <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md px-2 py-1 rounded text-[10px] font-bold text-white flex items-center gap-1.5">
                                    <Users className="w-3 h-3 text-neutral-300" />
                                    <span>-- Viewers</span>
                                </div>
                            </div>

                            {/* Info Area */}
                            <div className="p-4">
                                <div className="flex gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
                                        {stream.pubkey.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-white truncate group-hover:text-purple-400 transition-colors">
                                            {stream.title}
                                        </h3>
                                        <p className="text-xs text-neutral-400 truncate flex items-center gap-1 mt-0.5">
                                            <User className="w-3 h-3" />
                                            {stream.pubkey.substring(0, 8)}...
                                        </p>
                                    </div>
                                </div>
                                {stream.summary && (
                                    <p className="text-xs text-neutral-500 mt-3 line-clamp-2 leading-relaxed">
                                        {stream.summary}
                                    </p>
                                )}
                                {stream.starts && (
                                    <p className="text-[10px] text-neutral-600 mt-3 font-mono">
                                        Started {new Date(stream.starts * 1000).toLocaleTimeString()}
                                    </p>
                                )}
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
