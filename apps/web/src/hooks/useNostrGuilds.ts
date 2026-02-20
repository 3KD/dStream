"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useIdentity } from '@/context/IdentityContext';
import { subscribeToEvents, createSignedEvent, publishEvent } from '@/lib/nostr';

// Custom kind for guilds (not standard, dStream-specific)
const GUILD_KIND = 30078;
const GUILD_MEMBER_KIND = 30079;

export interface Guild {
    id: string;
    name: string;
    description?: string;
    image?: string;
    ownerPubkey: string;
    createdAt: number;
    memberCount: number;
    featured?: {
        pubkey: string;
        stream_id: string;
    };
}

export function useNostrGuilds() {
    const { identity } = useIdentity();
    const [guilds, setGuilds] = useState<Guild[]>([]);
    const [myGuilds, setMyGuilds] = useState<string[]>([]); // Guild IDs I'm a member of
    const [isLoading, setIsLoading] = useState(true);
    const seenIds = useRef<Set<string>>(new Set());

    // Fetch all guilds
    useEffect(() => {
        setIsLoading(true);

        const filter = {
            kinds: [GUILD_KIND],
            limit: 100,
        };

        const unsubscribe = subscribeToEvents(
            filter,
            (event) => {
                const dTag = event.tags.find(t => t[0] === 'd')?.[1];
                if (!dTag || seenIds.current.has(dTag)) return;
                seenIds.current.add(dTag);

                const name = event.tags.find(t => t[0] === 'name')?.[1];
                const description = event.tags.find(t => t[0] === 'description')?.[1];
                const image = event.tags.find(t => t[0] === 'image')?.[1];

                const guild: Guild = {
                    id: dTag,
                    name: name || dTag,
                    description,
                    image,
                    ownerPubkey: event.pubkey,
                    createdAt: event.created_at,
                    memberCount: 0,
                };

                setGuilds(prev => [...prev, guild]);
            },
            () => setIsLoading(false)
        );

        return () => unsubscribe();
    }, []);

    // Fetch my memberships
    useEffect(() => {
        if (!identity) return;

        const filter = {
            kinds: [GUILD_MEMBER_KIND],
            authors: [identity.publicKey],
        };

        const unsubscribe = subscribeToEvents(
            filter,
            (event) => {
                const guildId = event.tags.find(t => t[0] === 'd')?.[1];
                if (guildId) {
                    setMyGuilds(prev => prev.includes(guildId) ? prev : [...prev, guildId]);
                }
            }
        );

        return () => unsubscribe();
    }, [identity]);

    const createGuild = useCallback(async (name: string, description?: string, image?: string) => {
        if (!identity) throw new Error('Not logged in');

        const guildId = `guild_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const tags: string[][] = [
            ['d', guildId],
            ['name', name],
        ];
        if (description) tags.push(['description', description]);
        if (image) tags.push(['image', image]);

        const event = await createSignedEvent(identity, GUILD_KIND, '', tags);
        const success = await publishEvent(event);

        if (success) {
            // Also publish membership
            await joinGuild(guildId);
        }

        return success ? guildId : null;
    }, [identity]);

    const joinGuild = useCallback(async (guildId: string) => {
        if (!identity) throw new Error('Not logged in');

        const event = await createSignedEvent(
            identity,
            GUILD_MEMBER_KIND,
            '',
            [['d', guildId], ['status', 'member']]
        );

        const success = await publishEvent(event);
        if (success) {
            setMyGuilds(prev => prev.includes(guildId) ? prev : [...prev, guildId]);
        }
        return success;
    }, [identity]);

    const leaveGuild = useCallback(async (guildId: string) => {
        if (!identity) throw new Error('Not logged in');

        const event = await createSignedEvent(
            identity,
            GUILD_MEMBER_KIND,
            '',
            [['d', guildId], ['status', 'left']]
        );

        const success = await publishEvent(event);
        if (success) {
            setMyGuilds(prev => prev.filter(id => id !== guildId));
        }
        return success;
    }, [identity]);

    const isMember = useCallback((guildId: string) => myGuilds.includes(guildId), [myGuilds]);

    return {
        guilds,
        myGuilds,
        isLoading,
        createGuild,
        joinGuild,
        leaveGuild,
        isMember,
    };
}
