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
        nip05?: string;
        broadcaster_name?: string; // Broadcaster's display name
        tags?: string[];
        content_warning?: string;
        language?: string;
        escrow_amount?: number;
        monero_address?: string;
        venmo?: string;
        cashapp?: string;
        paypal?: string;
        customPayments?: { name: string, value: string }[];
        starts?: number;
        price?: { amount: number; currency: string };
        term?: { unit: string; value: number };
    };
    nostrEventId?: string;
    featuredBy?: string;
}

export function useNostrStreams() {
    const [streams, setStreams] = useState<Stream[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        const knownEvents = new Map<string, any>(); // Map d-tag -> event to handle replacements

        // Create filter as plain object - subscribeMany expects a single Filter, not an array
        const filter = { kinds: [KIND_STREAM_ANNOUNCE] };

        console.log(`[Nostr] Subscribing to streams on relays: ${RELAYS.join(', ')}`);
        console.log(`[Nostr] Filter:`, JSON.stringify(filter));

        const sub = pool.subscribeMany(RELAYS, filter as any, {
            onevent(event) {
                console.log(`[Nostr] Received event:`, event.id, getTag(event.tags, 'd'), getTag(event.tags, 'status'));
                const dTag = getTag(event.tags, 'd');
                if (!dTag) return;

                // If it's a newer event for this stream, update it
                const existing = knownEvents.get(dTag);
                if (existing && existing.created_at >= event.created_at) return;

                knownEvents.set(dTag, event);

                // Update state (throttled)
                if (isMounted) {
                    scheduleUpdate();
                }
            },
            oneose() {
                console.log('[Nostr] EOSE (End of Stored Events) received');
                if (isMounted) setLoading(false);
            }
        });

        // Throttling mechanism to prevent render loops
        let throttleTimeout: NodeJS.Timeout | null = null;

        const scheduleUpdate = () => {
            if (throttleTimeout) return;
            throttleTimeout = setTimeout(() => {
                if (isMounted) {
                    processEvents(Array.from(knownEvents.values()));
                }
                throttleTimeout = null;
            }, 500); // Update UI at most every 500ms
        };

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
                    const nip05 = getTag(e.tags, 'nip05');
                    const escrowStr = getTag(e.tags, 'escrow_amount');
                    const summary = getTag(e.tags, 'summary');
                    const tagsList = e.tags.filter((t: string[]) => t[0] === 't').map((t: string[]) => t[1]);
                    const contentWarning = getTag(e.tags, 'content-warning');
                    const language = getTag(e.tags, 'L') || getTag(e.tags, 'language');
                    const startsStr = getTag(e.tags, 'starts');
                    const moneroAddress = getTag(e.tags, 'monero_address');
                    const venmo = getTag(e.tags, 'venmo');
                    const cashapp = getTag(e.tags, 'cashapp');
                    const paypal = getTag(e.tags, 'paypal');
                    const broadcasterName = getTag(e.tags, 'broadcaster_name');
                    const customPaymentsRaw = getTag(e.tags, 'customPayments');
                    const customPayments = customPaymentsRaw ? JSON.parse(customPaymentsRaw) : undefined;
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
                            nip05,
                            broadcaster_name: broadcasterName,
                            tags: tagsList,
                            content_warning: contentWarning,
                            language,
                            escrow_amount: escrowStr ? parseFloat(escrowStr) : undefined,
                            monero_address: moneroAddress,
                            venmo,
                            cashapp,
                            paypal,
                            customPayments,
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
