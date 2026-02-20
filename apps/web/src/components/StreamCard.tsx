"use client";
import { useProfile } from '@/hooks/useProfile';
import { Stream } from '@/lib/types';
import Link from 'next/link';

interface StreamCardProps {
    stream: Stream;
}

export function StreamCard({ stream }: StreamCardProps) {
    const { profile } = useProfile(stream.broadcasterPubkey);
    const broadcasterName = profile?.name || stream.broadcasterPubkey.slice(0, 8);

    return (
        <Link href={`/watch/${stream.id}`} className="block group">
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl overflow-hidden hover:border-neutral-500 transition-colors">
                {/* Thumbnail */}
                <div className="relative aspect-video bg-neutral-900">
                    {stream.thumbnail ? (
                        <img
                            src={stream.thumbnail}
                            alt={stream.title}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl">
                            📺
                        </div>
                    )}

                    {/* Status Badge */}
                    {stream.status === 'live' && (
                        <div className="absolute top-2 left-2 bg-red-600 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1">
                            <span className="animate-pulse">●</span> LIVE
                        </div>
                    )}

                    {/* Viewer Count */}
                    {stream.viewerCount > 0 && (
                        <div className="absolute bottom-2 right-2 bg-black/70 px-2 py-0.5 rounded text-xs">
                            {stream.viewerCount} watching
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="p-3">
                    <h3 className="font-medium text-sm truncate group-hover:text-blue-400 transition-colors">
                        {stream.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                        <div className="w-5 h-5 rounded-full bg-neutral-700 overflow-hidden">
                            {profile?.picture ? (
                                <img src={profile.picture} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] text-neutral-400">
                                    {broadcasterName.charAt(0)}
                                </div>
                            )}
                        </div>
                        <span className="text-xs text-neutral-400 truncate">{broadcasterName}</span>
                    </div>

                    {/* Tags */}
                    {stream.tags.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                            {stream.tags.slice(0, 3).map(tag => (
                                <span key={tag} className="text-[10px] bg-neutral-700 px-1.5 py-0.5 rounded">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Link>
    );
}
