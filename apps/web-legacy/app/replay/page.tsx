"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { Play, Clock, HardDrive, Calendar, ArrowLeft } from "lucide-react";

interface Recording {
    streamId: string;
    createdAt: string;
    lastModified: string;
    sizeBytes: number;
    segmentCount: number;
    durationSeconds: number;
}

export default function ReplayPage() {
    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/vod/list')
            .then(res => res.json())
            .then(data => {
                setRecordings(data.recordings || []);
                setLoading(false);
            })
            .catch(err => {
                console.error("Failed to load recordings:", err);
                setLoading(false);
            });
    }, []);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDuration = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-white selection:bg-blue-500/30">
            <Header />

            <main className="max-w-7xl mx-auto px-6 py-12">
                <div className="mb-12 flex items-center justify-between">
                    <div>
                        <Link href="/browse" className="flex items-center gap-2 text-neutral-500 hover:text-white transition mb-4">
                            <ArrowLeft className="w-4 h-4" /> Back to Browse
                        </Link>
                        <h1 className="text-5xl font-black tracking-tighter mb-2">
                            Replay <span className="text-neutral-500">Center</span>
                        </h1>
                        <p className="text-neutral-400">Archive of recorded broadcasts serving from your node.</p>
                    </div>
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-48 bg-neutral-900/50 rounded-2xl animate-pulse border border-white/5" />
                        ))}
                    </div>
                ) : recordings.length === 0 ? (
                    <div className="p-12 border border-dashed border-neutral-800 rounded-2xl text-center">
                        <HardDrive className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-neutral-400">No recordings found</h3>
                        <p className="text-sm text-neutral-600">Start a broadcast with "Record Stream" enabled to see it here.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {recordings.map((rec) => (
                            <Link
                                key={rec.streamId}
                                href={`/replay/${rec.streamId}`}
                                className="group bg-neutral-900/40 rounded-2xl overflow-hidden border border-white/5 hover:border-blue-500/40 transition-all hover:shadow-[0_0_30px_rgba(59,130,246,0.1)] block"
                            >
                                <div className="aspect-video bg-neutral-800/80 relative flex items-center justify-center">
                                    <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center backdrop-blur-sm group-hover:scale-110 group-hover:bg-blue-500 group-hover:text-white transition-all">
                                        <Play className="w-8 h-8 fill-current ml-1" />
                                    </div>
                                    <div className="absolute top-4 left-4">
                                        <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded-lg uppercase tracking-wider">
                                            VOD
                                        </span>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <h3 className="font-bold text-lg mb-2 truncate font-mono">{rec.streamId}</h3>

                                    <div className="space-y-2 text-sm text-neutral-400">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-neutral-600" />
                                            <span>{new Date(rec.lastModified).toLocaleString()}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-neutral-600" />
                                            <span>{formatDuration(rec.durationSeconds)}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <HardDrive className="w-4 h-4 text-neutral-600" />
                                            <span>{formatSize(rec.sizeBytes)}</span>
                                        </div>
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
