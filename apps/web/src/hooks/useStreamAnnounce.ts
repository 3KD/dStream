"use client";
import { useBroadcast } from '@/context/BroadcastContext';
import { useIdentity } from '@/context/IdentityContext';
import { announceStream } from '@/lib/nostr';
import { useEffect, useRef } from 'react';

/**
 * Tier 10: Auto-announce stream to Nostr when going live.
 * This hook should be used in the broadcast page.
 */
export function useStreamAnnounce() {
    const { identity } = useIdentity();
    const { session } = useBroadcast();
    const announcedRef = useRef<string | null>(null);

    useEffect(() => {
        if (!identity || !session) return;

        const streamKey = session.streamKey;
        const status = session.stream.status;

        // Announce when going live
        if (status === 'live' && announcedRef.current !== streamKey) {
            console.log('[Announce] Stream going live:', streamKey);

            announceStream(
                identity,
                streamKey,
                session.stream.title || streamKey,
                'live',
                {
                    summary: session.stream.description,
                    streaming: `http://localhost:8880/${streamKey}/index.m3u8`,
                    tags: session.stream.tags,
                }
            ).then(success => {
                if (success) {
                    console.log('[Announce] Published successfully');
                    announcedRef.current = streamKey;
                } else {
                    console.warn('[Announce] Failed to publish');
                }
            });
        }

        // Announce end when stopping
        if (status === 'offline' && announcedRef.current === streamKey) {
            console.log('[Announce] Stream ending:', streamKey);

            announceStream(
                identity,
                streamKey,
                session.stream.title || streamKey,
                'ended'
            ).then(() => {
                announcedRef.current = null;
            });
        }
    }, [identity, session]);
}
