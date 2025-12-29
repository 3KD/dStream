import { useState, useEffect } from 'react';
import { pool, RELAYS, KIND_STREAM_ANNOUNCE, getTag } from '@/lib/nostr';
import { Filter } from 'nostr-tools';

export interface Stream {
    pubkey: string;
    stream_id: string; // The 'd' tag
    last_announce: number;
    metadata: {
        title?: string;
        summary?: string;
        image?: string;
        tags?: string[];
        content_warning?: string;
        language?: string;
        escrow_amount?: number;
        starts?: number;
        price?: { amount: number; currency: string };
        term?: { unit: string; value: number };
    };
    nostrEventId?: string;
}

export function useNostrStreams() {
    const [streams, setStreams] = useState<Stream[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        const knownEvents = new Map<string, any>(); // Map d-tag -> event to handle replacements

        const filter: Filter = {
            kinds: [KIND_STREAM_ANNOUNCE],
            // '#status': ['live'] // Optional: Some relays might not support tag filtering perfectly, so we filter client side too
        };

        console.log(`[Nostr] Subscribing to streams on relays: ${RELAYS.join(', ')}`);

        const sub = pool.subscribeMany(RELAYS, [filter] as any, {
            onevent(event) {
                console.log(`[Nostr] Received event:`, event.id, getTag(event.tags, 'd'), getTag(event.tags, 'status'));
                const dTag = getTag(event.tags, 'd');
                if (!dTag) return;

                // If it's a newer event for this stream, update it
                const existing = knownEvents.get(dTag);
                if (existing && existing.created_at >= event.created_at) return;

                knownEvents.set(dTag, event);

                // Update state
                if (isMounted) {
                    processEvents(Array.from(knownEvents.values()));
                }
            },
            oneose() {
                console.log('[Nostr] EOSE (End of Stored Events) received');
                if (isMounted) setLoading(false);
            }
        });

        // Loop to process events in batch or just rely on react state updates (might be spammy)
        // For MVP we just process on every event (debouncing would be better)

        const processEvents = (events: any[]) => {
            const ONE_HOUR = 60 * 60; // seconds
            const now = Math.floor(Date.now() / 1000);

            const activeStreams = events
                // Only show live streams that were updated in the last hour
                .filter(e => {
                    const status = getTag(e.tags, 'status');
                    const isLive = status === 'live';
                    const isRecent = (now - e.created_at) < ONE_HOUR;
                    return isLive && isRecent;
                })
                .map(e => {
                    const dTag = getTag(e.tags, 'd')!;
                    const title = getTag(e.tags, 'title');
                    const image = getTag(e.tags, 'image');
                    const escrowStr = getTag(e.tags, 'escrow_amount');
                    const summary = getTag(e.tags, 'summary');
                    const tagsList = e.tags.filter((t: string[]) => t[0] === 't').map((t: string[]) => t[1]);
                    const contentWarning = getTag(e.tags, 'content-warning');
                    const language = getTag(e.tags, 'L') || getTag(e.tags, 'language');
                    const startsStr = getTag(e.tags, 'starts');
                    const priceTag = e.tags.find((t: string[]) => t[0] === 'price');
                    const termTag = e.tags.find((t: string[]) => t[0] === 'term');

                    return {
                        pubkey: e.pubkey,
                        stream_id: dTag,
                        last_announce: e.created_at * 1000,
                        metadata: {
                            title: title || dTag,
                            summary,
                            image,
                            tags: tagsList,
                            content_warning: contentWarning,
                            language,
                            escrow_amount: escrowStr ? parseFloat(escrowStr) : undefined,
                            starts: startsStr ? parseInt(startsStr) : undefined,
                            price: priceTag ? { amount: parseFloat(priceTag[1]), currency: priceTag[2] } : undefined,
                            term: termTag ? { unit: termTag[1], value: parseInt(termTag[2]) } : undefined
                        },
                        nostrEventId: e.id
                    };
                });

            setStreams(activeStreams);
        };

        return () => {
            isMounted = false;
            sub.close();
        };
    }, []);

    return { streams, loading };
}
