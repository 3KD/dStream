"use client";
import { useEffect, useRef } from 'react';
import { useChat } from '@/hooks/useChat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';

interface ChatBoxProps {
    broadcasterPubkey: string;
    streamId: string;
}

export function ChatBox({ broadcasterPubkey, streamId }: ChatBoxProps) {
    const { messages, isConnected, sendMessage, canSend } = useChat({
        broadcasterPubkey,
        streamId,
    });
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    return (
        <div className="flex flex-col h-full bg-neutral-900 border border-neutral-700 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">Chat</span>
                    {isConnected && (
                        <span className="w-2 h-2 bg-green-500 rounded-full" title="Connected" />
                    )}
                </div>
                <span className="text-xs text-neutral-500">
                    {messages.length} messages
                </span>
            </div>

            {/* Messages */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto min-h-0"
            >
                {messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
                        No messages yet
                    </div>
                ) : (
                    <div className="py-2">
                        {messages.map((msg) => (
                            <ChatMessage
                                key={msg.id}
                                senderPubkey={msg.senderPubkey}
                                content={msg.content}
                                timestamp={msg.timestamp}
                                isBroadcaster={msg.isBroadcaster}
                                isModerator={msg.isModerator}
                                isWhisper={msg.isEncrypted}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Input */}
            <ChatInput
                onSend={sendMessage}
                disabled={!canSend}
            />
        </div>
    );
}
