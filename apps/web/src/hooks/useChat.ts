"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToEvents, sendStreamChat } from '@/lib/nostr';
import { useIdentity } from '@/context/IdentityContext';
import { ChatMessage, NOSTR_KINDS } from '@/lib/types';

interface UseChatOptions {
    broadcasterPubkey: string;
    streamId: string;
    /** Maximum messages to keep in memory */
    maxMessages?: number;
}

export function useChat({ broadcasterPubkey, streamId, maxMessages = 100 }: UseChatOptions) {
    const { identity } = useIdentity();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const seenIds = useRef(new Set<string>());

    // Subscribe to chat messages
    useEffect(() => {
        if (!broadcasterPubkey || !streamId) return;

        const aTag = `30311:${broadcasterPubkey}:${streamId}`;

        const filter = {
            kinds: [NOSTR_KINDS.STREAM_CHAT],
            '#a': [aTag],
            since: Math.floor(Date.now() / 1000) - 3600, // Last hour
            limit: 50,
        };

        const unsubscribe = subscribeToEvents(
            filter,
            (event) => {
                // Dedupe
                if (seenIds.current.has(event.id)) return;
                seenIds.current.add(event.id);

                const msg: ChatMessage = {
                    id: event.id,
                    senderPubkey: event.pubkey,
                    content: event.content,
                    timestamp: event.created_at,
                    isEncrypted: false,
                    isBroadcaster: event.pubkey === broadcasterPubkey,
                    isModerator: false,
                };

                setMessages(prev => {
                    const updated = [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
                    // Keep only the last N messages
                    return updated.slice(-maxMessages);
                });
            },
            () => {
                setIsConnected(true);
            }
        );

        return () => {
            unsubscribe();
            setIsConnected(false);
        };
    }, [broadcasterPubkey, streamId, maxMessages]);

    const sendMessage = useCallback(async (content: string) => {
        if (!identity || !content.trim()) return false;

        setIsSending(true);
        try {
            const success = await sendStreamChat(identity, broadcasterPubkey, streamId, content);
            setIsSending(false);
            return success;
        } catch (e) {
            setIsSending(false);
            return false;
        }
    }, [identity, broadcasterPubkey, streamId]);

    return {
        messages,
        isConnected,
        isSending,
        sendMessage,
        canSend: !!identity,
    };
}
