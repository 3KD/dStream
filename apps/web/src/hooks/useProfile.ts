"use client";
import { useState, useEffect, useCallback } from 'react';
import { fetchProfile as fetchNostrProfile } from '@/lib/nostr';

interface Profile {
    name?: string;
    picture?: string;
    about?: string;
    nip05?: string;
    banner?: string;
    lud16?: string;
}

interface ProfileCache {
    [pubkey: string]: {
        profile: Profile;
        fetchedAt: number;
    };
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let cache: ProfileCache = {};

export function useProfile(pubkey: string | undefined) {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchProfile = useCallback(async () => {
        if (!pubkey) return;

        // Check cache
        const cached = cache[pubkey];
        if (cached && Date.now() - cached.fetchedAt < CACHE_DURATION) {
            setProfile(cached.profile);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const data = await fetchNostrProfile(pubkey);
            const profileData: Profile = {
                name: data?.name,
                picture: data?.picture,
                about: data?.about,
                nip05: data?.nip05,
                banner: data?.banner,
                lud16: data?.lud16,
            };

            // Cache it
            cache[pubkey] = {
                profile: profileData,
                fetchedAt: Date.now(),
            };

            setProfile(profileData);
        } catch (e: any) {
            setError(e.message || 'Failed to fetch profile');
        } finally {
            setIsLoading(false);
        }
    }, [pubkey]);

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    return { profile, isLoading, error, refetch: fetchProfile };
}

export function clearProfileCache(pubkey?: string) {
    if (pubkey) {
        delete cache[pubkey];
    } else {
        cache = {};
    }
}
