"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useIdentity } from '@/context/IdentityContext';
import { subscribeToEvents, createSignedEvent, publishEvent } from '@/lib/nostr';
import { NOSTR_KINDS } from '@/lib/types';

interface UsePresenceOptions {
    broadcasterPubkey: string;
    streamId: string;
    /** Heartbeat interval in ms (default 30s) */
    interval?: number;
}

export function usePresence({ broadcasterPubkey, streamId, interval = 30000 }: UsePresenceOptions) {
    const { identity } = useIdentity();
    const [viewerCount, setViewerCount] = useState(0);
    const [isPublishing, setIsPublishing] = useState(false);
    const seenPubkeys = useRef<Set<string>>(new Set());
    const lastSeen = useRef<Map<string, number>>(new Map());

    // Publish presence heartbeat
    useEffect(() => {
        if (!identity || !broadcasterPubkey || !streamId) return;

        const publishPresence = async () => {
            setIsPublishing(true);
            try {
                const event = await createSignedEvent(
                    identity,
                    NOSTR_KINDS.PRESENCE,
                    '',
                    [
                        ['d', `${broadcasterPubkey}:${streamId}`],
                        ['status', 'watching'],
                    ]
                );
                await publishEvent(event);
            } catch (e) {
                console.warn('[Presence] Failed to publish:', e);
            }
            setIsPublishing(false);
        };

        // Publish immediately
        publishPresence();

        // Then on interval
        const timer = setInterval(publishPresence, interval);

        return () => clearInterval(timer);
    }, [identity, broadcasterPubkey, streamId, interval]);

    // Subscribe to presence events
    useEffect(() => {
        if (!broadcasterPubkey || !streamId) return;

        const filter = {
            kinds: [NOSTR_KINDS.PRESENCE],
            '#d': [`${broadcasterPubkey}:${streamId}`],
            since: Math.floor(Date.now() / 1000) - 120, // Last 2 minutes
        };

        const unsubscribe = subscribeToEvents(
            filter,
            (event) => {
                const pubkey = event.pubkey;
                lastSeen.current.set(pubkey, event.created_at);
                seenPubkeys.current.add(pubkey);

                // Count active viewers (seen in last 2 minutes)
                const now = Math.floor(Date.now() / 1000);
                const activeThreshold = now - 120;
                let activeCount = 0;

                lastSeen.current.forEach((timestamp) => {
                    if (timestamp > activeThreshold) {
                        activeCount++;
                    }
                });

                setViewerCount(activeCount);
            }
        );

        return () => unsubscribe();
    }, [broadcasterPubkey, streamId]);

    return {
        viewerCount,
        isPublishing,
        totalUnique: seenPubkeys.current.size,
    };
}
