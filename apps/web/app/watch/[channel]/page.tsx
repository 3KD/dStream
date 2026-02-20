"use client";
import { useParams } from 'next/navigation';
import { Player } from '@/components/Player';
import { ChatBox } from '@/components/chat';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { P2PStats } from '@/components/P2PStats';
import { ProfileDisplay } from '@/components/ProfileDisplay';
import { usePresence } from '@/hooks/usePresence';
import { useNostrStreams } from '@/hooks/useNostrStreams';
import { MEDIA_CONFIG } from '@/lib/config';

export default function WatchPage() {
    const params = useParams();
    const channel = params.channel as string;

    // In a real app we'd resolve pubkey from channel ID or use channel as pubkey
    const broadcasterPubkey = channel;

    const { viewerCount } = usePresence({
        broadcasterPubkey,
        streamId: channel
    });

    // Fetch stream metadata to get the real streaming URL
    const { streams } = useNostrStreams({ limit: 100 });
    const stream = streams.find(s => s.id === channel || s.broadcasterPubkey === channel);

    // Prefer the broadcaster's custom URL (if available), otherwise fallback to local convention
    const streamUrl = stream?.streamingUrl || `${MEDIA_CONFIG.hlsUrl}/${channel}/index.m3u8`;

    return (
        <DashboardLayout>
            <div className="h-full flex overflow-hidden">
                {/* Main Content */}
                <div className="flex-1 p-6 overflow-y-auto scrollbar-hide">
                    <div className="max-w-5xl mx-auto space-y-6 pb-20">
                        {/* Player Area */}
                        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl">
                            <Player src={streamUrl} />
                        </div>

                        {/* Stream Info & Stats */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2 space-y-6">
                                {/* Broadcaster Info */}
                                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 flex justify-between items-center">
                                    <div className="flex items-center gap-4">
                                        <ProfileDisplay pubkey={broadcasterPubkey} size="lg" />
                                        <div>
                                            <h1 className="text-xl font-bold text-white">Live Stream: {channel}</h1>
                                            <p className="text-sm text-neutral-500">Broadcasting via dStream WHIP</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-bold text-red-500 flex items-center gap-2 justify-end">
                                            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                            LIVE
                                        </div>
                                        <div className="text-xs text-neutral-500 mt-1">
                                            {viewerCount} Viewers
                                        </div>
                                    </div>
                                </div>

                                {/* Placeholder for Description/About */}
                                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
                                    <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500 mb-4">About the Stream</h2>
                                    <p className="text-neutral-400 text-sm leading-relaxed">
                                        This stream is running on global P2P infrastructure. By watching, you are helping distribute the signal to other peers in your region. Minimum latency, maximum privacy.
                                    </p>
                                </div>
                            </div>

                            {/* P2P Swarm Panel */}
                            <div className="space-y-6">
                                <P2PStats />

                                {/* Quick Support / Tips Placeholder */}
                                <button className="w-full bg-gradient-to-r from-orange-500 to-orange-700 hover:from-orange-400 hover:to-orange-600 py-4 rounded-2xl font-bold shadow-lg transition-all transform hover:scale-[1.02]">
                                    Tip Broadcaster (XMR)
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sidebar Chat */}
                <aside className="w-80 border-l border-neutral-800 h-full bg-neutral-900/30">
                    <ChatBox broadcasterPubkey={broadcasterPubkey} streamId={channel} />
                </aside>
            </div>
        </DashboardLayout>
    );
}
