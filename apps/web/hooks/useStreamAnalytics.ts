"use client";

import { useState, useEffect } from 'react';
import { pool, RELAYS } from '@/lib/nostr';

/**
 * Nostr Kind constants
 */
const KIND_ZAP_RECEIPT = 9735;
const KIND_REACTION = 7;
const KIND_STREAM_STATUS = 30311;

export interface StreamAnalytics {
    totalZaps: number;
    totalZapAmount: number; // in sats (from bolt11)
    reactionCount: number;
    loading: boolean;
}

/**
 * Hook to fetch stream analytics from Nostr
 * Queries zaps and reactions for a given pubkey
 */
export function useStreamAnalytics(pubkey: string | undefined) {
    const [analytics, setAnalytics] = useState<StreamAnalytics>({
        totalZaps: 0,
        totalZapAmount: 0,
        reactionCount: 0,
        loading: true
    });

    useEffect(() => {
        if (!pubkey) {
            setAnalytics(prev => ({ ...prev, loading: false }));
            return;
        }

        let isMounted = true;

        const fetchAnalytics = async () => {
            try {
                // Query zaps sent TO this pubkey
                const zapFilter = {
                    kinds: [KIND_ZAP_RECEIPT],
                    '#p': [pubkey],
                    limit: 500
                };

                // Query reactions to this pubkey's content
                const reactionFilter = {
                    kinds: [KIND_REACTION],
                    '#p': [pubkey],
                    limit: 500
                };

                const [zapEvents, reactionEvents] = await Promise.all([
                    pool.querySync(RELAYS, zapFilter),
                    pool.querySync(RELAYS, reactionFilter)
                ]);

                if (!isMounted) return;

                // Count zaps and extract amounts from bolt11
                let totalAmount = 0;
                zapEvents.forEach(event => {
                    // Try to extract amount from description tag or bolt11
                    const bolt11 = event.tags.find(t => t[0] === 'bolt11')?.[1];
                    if (bolt11) {
                        // Simple extraction: look for amount in bolt11
                        // Format: lnbc{amount}... (amount is in millisats for some, sats for others)
                        const amountMatch = bolt11.match(/lnbc(\d+)([munp]?)/i);
                        if (amountMatch) {
                            let amount = parseInt(amountMatch[1]);
                            const unit = amountMatch[2]?.toLowerCase();
                            // Convert to sats based on unit
                            if (unit === 'm') amount = amount * 100000; // milli-btc
                            else if (unit === 'u') amount = amount * 100; // micro-btc  
                            else if (unit === 'n') amount = amount / 10; // nano-btc
                            else if (unit === 'p') amount = amount / 10000; // pico-btc
                            totalAmount += amount;
                        }
                    }
                });

                setAnalytics({
                    totalZaps: zapEvents.length,
                    totalZapAmount: Math.round(totalAmount),
                    reactionCount: reactionEvents.length,
                    loading: false
                });

            } catch (e) {
                console.error('[Analytics] Failed to fetch:', e);
                if (isMounted) {
                    setAnalytics(prev => ({ ...prev, loading: false }));
                }
            }
        };

        fetchAnalytics();

        return () => {
            isMounted = false;
        };
    }, [pubkey]);

    return analytics;
}

/**
 * Estimate view count from stream status events and reactions
 */
export function useEstimatedViews(streamId: string | undefined, broadcasterPubkey: string | undefined) {
    const [views, setViews] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!streamId || !broadcasterPubkey) {
            setLoading(false);
            return;
        }

        let isMounted = true;

        const fetchViews = async () => {
            try {
                // Query for reactions/status events related to this stream
                const filter = {
                    kinds: [KIND_REACTION, KIND_STREAM_STATUS],
                    '#a': [`${KIND_STREAM_STATUS}:${broadcasterPubkey}:${streamId}`],
                    limit: 1000
                };

                const events = await pool.querySync(RELAYS, filter);

                if (isMounted) {
                    // Count unique pubkeys as "views"
                    const uniqueViewers = new Set(events.map(e => e.pubkey));
                    setViews(uniqueViewers.size);
                    setLoading(false);
                }
            } catch (e) {
                console.error('[Views] Failed to fetch:', e);
                if (isMounted) setLoading(false);
            }
        };

        fetchViews();

        return () => {
            isMounted = false;
        };
    }, [streamId, broadcasterPubkey]);

    return { views, loading };
}
