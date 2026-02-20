"use client";

import { useState, useEffect } from 'react';
import { pool, RELAYS, getTag } from '@/lib/nostr';

export const KIND_GUILD_LIST = 30001; // Generalized List

export interface Guild {
    pubkey: string;
    id: string; // 'd' tag
    name: string;
    description: string;
    featured?: {
        pubkey: string;
        stream_id: string;
    };
    members: string[]; // List of pubkeys in this guild
}

export function useNostrGuilds() {
    const [guilds, setGuilds] = useState<Guild[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        const knownGuilds = new Map<string, any>();

        const filter = {
            kinds: [KIND_GUILD_LIST],
            '#t': ['guild']
        };

        const sub = pool.subscribeMany(RELAYS, filter as any, {
            onevent(event) {
                const dTag = getTag(event.tags, 'd');
                if (!dTag) return;

                const existing = knownGuilds.get(dTag);
                if (existing && existing.created_at >= event.created_at) return;

                knownGuilds.set(dTag, event);

                if (isMounted) {
                    scheduleUpdate();
                }
            },
            oneose() {
                if (isMounted) setLoading(false);
            }
        });

        let throttleTimeout: NodeJS.Timeout | null = null;
        const scheduleUpdate = () => {
            if (throttleTimeout) return;
            throttleTimeout = setTimeout(() => {
                if (isMounted) {
                    const processed = Array.from(knownGuilds.values()).map(e => {
                        const name = getTag(e.tags, 'name') || getTag(e.tags, 'title') || getTag(e.tags, 'd') || 'Unnamed Guild';
                        const description = getTag(e.tags, 'description') || getTag(e.tags, 'summary') || '';

                        // Look for featured stream tag: ['featured', 'pubkey', 'stream_id']
                        const featuredTag = e.tags.find((t: string[]) => t[0] === 'featured');
                        const featured = featuredTag ? {
                            pubkey: featuredTag[1],
                            stream_id: featuredTag[2]
                        } : undefined;

                        // Members are tags like ['p', 'pubkey']
                        const members = e.tags.filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1]);

                        return {
                            pubkey: e.pubkey,
                            id: getTag(e.tags, 'd')!,
                            name,
                            description,
                            featured,
                            members
                        };
                    });
                    setGuilds(processed);
                }
                throttleTimeout = null;
            }, 500);
        };

        return () => {
            isMounted = false;
            sub.close();
        };
    }, []);

    return { guilds, loading };
}
