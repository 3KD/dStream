"use client";
import { useProfile } from '@/hooks/useProfile';

interface ChatMessageProps {
    senderPubkey: string;
    content: string;
    timestamp: number;
    isBroadcaster: boolean;
    isModerator?: boolean;
    isWhisper?: boolean;
}

export function ChatMessage({
    senderPubkey,
    content,
    timestamp,
    isBroadcaster,
    isModerator,
    isWhisper
}: ChatMessageProps) {
    const { profile } = useProfile(senderPubkey);
    const displayName = profile?.name || senderPubkey.slice(0, 8);

    const time = new Date(timestamp * 1000).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });

    return (
        <div className={`flex gap-2 py-1.5 px-3 hover:bg-neutral-800/50 ${isWhisper ? 'bg-purple-900/20' : ''
            }`}>
            {/* Avatar */}
            <div className="w-6 h-6 rounded-full bg-neutral-700 flex-shrink-0 overflow-hidden">
                {profile?.picture ? (
                    <img src={profile.picture} alt="" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-neutral-400">
                        {displayName.charAt(0).toUpperCase()}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                    <span className={`font-medium text-sm truncate ${isBroadcaster ? 'text-red-400' :
                            isModerator ? 'text-green-400' :
                                'text-neutral-200'
                        }`}>
                        {displayName}
                    </span>

                    {/* Badges */}
                    {isBroadcaster && (
                        <span className="text-[10px] bg-red-900 text-red-200 px-1.5 py-0.5 rounded">
                            STREAMER
                        </span>
                    )}
                    {isModerator && !isBroadcaster && (
                        <span className="text-[10px] bg-green-900 text-green-200 px-1.5 py-0.5 rounded">
                            MOD
                        </span>
                    )}
                    {isWhisper && (
                        <span className="text-[10px] bg-purple-900 text-purple-200 px-1.5 py-0.5 rounded">
                            WHISPER
                        </span>
                    )}

                    <span className="text-[10px] text-neutral-500">{time}</span>
                </div>
                <p className="text-sm text-neutral-300 break-words">{content}</p>
            </div>
        </div>
    );
}
