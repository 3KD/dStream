"use client";
import { useNostrStreams } from '@/hooks/useNostrStreams';
import { StreamCard } from '@/components/StreamCard';
import { IdentityButton } from '@/components/IdentityButton';
import Link from 'next/link';

export default function BrowsePage() {
    const { liveStreams, isLoading, liveCount } = useNostrStreams({ liveOnly: true });

    return (
        <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-black text-white">
            {/* Header */}
            <header className="border-b border-neutral-800 px-6 py-4">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <Link href="/" className="text-xl font-bold">dStream</Link>
                        <nav className="flex gap-4 text-sm">
                            <Link href="/browse" className="text-white">Browse</Link>
                            <Link href="/broadcast" className="text-neutral-400 hover:text-white">Broadcast</Link>
                        </nav>
                    </div>
                    <IdentityButton />
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold">
                        Live Streams
                        {!isLoading && (
                            <span className="text-neutral-500 text-lg ml-2">({liveCount})</span>
                        )}
                    </h1>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : liveStreams.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="text-6xl mb-4">📺</div>
                        <h2 className="text-xl font-medium mb-2">No Live Streams</h2>
                        <p className="text-neutral-500 mb-4">Be the first to go live!</p>
                        <Link
                            href="/broadcast"
                            className="inline-block bg-red-600 hover:bg-red-500 px-6 py-2 rounded-lg font-medium"
                        >
                            Start Streaming
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {liveStreams.map(stream => (
                            <StreamCard key={`${stream.broadcasterPubkey}:${stream.id}`} stream={stream} />
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
