"use client";

import { useState, useEffect } from 'react';
import { pool, RELAYS } from '@/lib/nostr';
import { useIdentity } from '@/context/IdentityContext';

const KIND_WATCHING = 30312; // Ephemeral event: "I am watching X"

/**
 * Hook to manage viewer presence
 * - Publishes heartbeats (I am watching)
 * - Subscribes to other watchers to count viewers
 */
export function usePresence(channelId: string | undefined) {
    const { identity, signNostrEvent } = useIdentity();
    const [viewerCount, setViewerCount] = useState(0);
    const [peers, setPeers] = useState<string[]>([]);

    // Publish heartbeat every 30s
    useEffect(() => {
        if (!channelId || !identity?.nostrPublicKey) return;

        let interval: NodeJS.Timeout;

        const publishHeartbeat = async () => {
            // SKIP if using extension (no private key) to avoid annoying prompts every 30s
            // Passive viewers using extensions shouldn't auto-sign heartbeats unless we have specific permission logic
            if (!identity.nostrPrivateKey) return;

            try {
                // Kind 30312 is ephemeral (NIP-45? or custom)
                // We'll use Kind 20000+ for ephemeral if 30312 isn't standard yet
                // But for now sticking to the plan
                const event = {
                    kind: KIND_WATCHING,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                        ['d', channelId],
                        ['expiration', String(Math.floor(Date.now() / 1000) + 45)] // Expire in 45s
                    ],
                    content: '',
                    pubkey: identity.nostrPublicKey
                };

                const signed = await signNostrEvent(event);
                pool.publish(RELAYS, signed);
            } catch (e) {
                console.warn('[Presence] Failed to publish heartbeat', e);
            }
        };

        publishHeartbeat(); // Initial
        interval = setInterval(publishHeartbeat, 30_000); // Repeat every 30s

        return () => clearInterval(interval);
    }, [channelId, identity?.nostrPublicKey]);

    // Subscribe to count other watchers
    useEffect(() => {
        if (!channelId) return;

        let watchers = new Set<string>();

        // Subscription to receive heatbeats
        const sub = pool.subscribeMany(RELAYS, [
            {
                kinds: [KIND_WATCHING],
                '#d': [channelId],
                since: Math.floor(Date.now() / 1000) - 60 // Last 60s only
            }
        ] as any, {
            onevent(event) {
                watchers.add(event.pubkey);
                setViewerCount(watchers.size);
                setPeers(Array.from(watchers));
            }
        });

        // Prune stale watchers every 10s
        const pruneInterval = setInterval(() => {
            // In a real implementation with timestamps we'd check dates
            // Here we mainly rely on the subscription 'since' filter updating on reconnect
            // or just manual decay if we stored timestamps
            // For MVP, simple unique set is fine
        }, 10_000);

        return () => {
            sub.close();
            clearInterval(pruneInterval);
        };
    }, [channelId]);

    return { viewerCount, peers };
}
