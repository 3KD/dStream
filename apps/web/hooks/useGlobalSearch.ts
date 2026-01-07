import { useState, useEffect } from 'react';
import { pool, RELAYS, KIND_STREAM_ANNOUNCE } from '@/lib/nostr';
import { Filter } from 'nostr-tools';

export interface SearchResult {
    id: string;
    pubkey: string;
    kind: number;
    title?: string; // For streams
    name?: string; // For users
    displayName?: string; // For users
    summary?: string; // For streams
    image?: string;
    about?: string; // For users
    nip05?: string;
    tags?: string[];
    createdAt: number;
}

export function useGlobalSearch(query: string) {
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!query || query.length < 3) {
            setResults([]);
            return;
        }

        setLoading(true);
        const searchFilter_Profiles: Filter = {
            kinds: [0],
            search: query,
            limit: 20
        } as any; // Cast to any because 'search' is non-standard in type definition but standard in implementation

        const searchFilter_Streams: Filter = {
            kinds: [KIND_STREAM_ANNOUNCE],
            search: query,
            limit: 20
        } as any;

        let isMounted = true;
        const sub = pool.subscribeMany(RELAYS, [searchFilter_Profiles, searchFilter_Streams], {
            onevent(event) {
                if (!isMounted) return;

                const result = parseSearchResult(event);
                if (result) {
                    setResults(prev => {
                        if (prev.find(r => r.id === result.id)) return prev;
                        return [...prev, result].sort((a, b) => b.createdAt - a.createdAt); // Newest first? Or rely on relevance? NIP-50 usually sorts by relevance but we get stream
                    });
                }
            },
            oneose() {
                if (isMounted) setLoading(false);
            }
        });

        // Timeout to stop loading if relays are slow
        const timeout = setTimeout(() => {
            if (isMounted) setLoading(false);
        }, 5000);

        return () => {
            isMounted = false;
            sub.close();
            clearTimeout(timeout);
        };
    }, [query]);

    return { results, loading };
}

function parseSearchResult(event: any): SearchResult | null {
    try {
        if (event.kind === 0) {
            const content = JSON.parse(event.content);
            return {
                id: event.id,
                pubkey: event.pubkey,
                kind: 0,
                name: content.name,
                displayName: content.display_name || content.name,
                image: content.picture,
                about: content.about,
                nip05: content.nip05,
                createdAt: event.created_at
            };
        } else if (event.kind === KIND_STREAM_ANNOUNCE) {
            const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
            const title = event.tags.find((t: string[]) => t[0] === 'title')?.[1];
            const summary = event.tags.find((t: string[]) => t[0] === 'summary')?.[1];
            const image = event.tags.find((t: string[]) => t[0] === 'image')?.[1];
            const tags = event.tags.filter((t: string[]) => t[0] === 't').map((t: string[]) => t[1]);

            if (!dTag) return null;

            return {
                id: event.id,
                pubkey: event.pubkey,
                kind: KIND_STREAM_ANNOUNCE,
                title: title || dTag,
                summary,
                image,
                tags,
                createdAt: event.created_at,
                // Extra metadata stash if needed
                name: dTag // Store d-tag as name for ID usage
            };
        }
    } catch (e) {
        console.error("Failed to parse search result", e);
    }
    return null;
}
