"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Header } from "@/components/layout/Header";
import { ArrowLeft, HardDrive, Calendar } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

// Dynamic import for HlsPlayer (No SSR)
const VideoPlayer = dynamic(() => import("@/components/player/VideoPlayer").then(mod => mod.VideoPlayer), {
    ssr: false,
    loading: () => <div className="aspect-video bg-neutral-900 animate-pulse rounded-2xl" />
});

export default function ReplayPlayerPage() {
    const params = useParams();
    const id = params?.id as string;
    const [metadata, setMetadata] = useState<any>(null);

    // Fetch metadata for nice display (optional)
    useEffect(() => {
        // We could fetch from /api/vod/list and find, or just display ID
        // For now, ID is enough.
    }, [id]);

    const vodUrl = `/api/vod/${id}/vod.m3u8`;

    return (
        <div className="min-h-screen bg-neutral-950 text-white selection:bg-blue-500/30">
            <Header />

            <main className="max-w-7xl mx-auto px-6 py-12">
                <div className="mb-6">
                    <Link href="/replay" className="flex items-center gap-2 text-neutral-500 hover:text-white transition mb-4">
                        <ArrowLeft className="w-4 h-4" /> Back to Replays
                    </Link>
                    <div className="flex items-center gap-4">
                        <HardDrive className="w-8 h-8 text-blue-500" />
                        <div>
                            <h1 className="text-2xl font-bold font-mono text-white/90 truncate max-w-2xl">{id}</h1>
                            <span className="text-xs font-bold bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded uppercase">Archive Replay</span>
                        </div>
                    </div>
                </div>

                <div className="bg-neutral-900 rounded-2xl overflow-hidden border border-neutral-800 shadow-2xl">
                    <div className="aspect-video relative">
                        {/* We pass a key to force re-render if ID changes */}
                        <VideoPlayer
                            key={vodUrl}
                            src={vodUrl}
                            autoPlay={true}
                            className="w-full h-full"
                        />
                    </div>
                </div>
            </main>
        </div>
    );
}
