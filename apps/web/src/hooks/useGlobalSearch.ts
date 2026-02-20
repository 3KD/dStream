import { useNostrStreams } from './useNostrStreams';

export interface SearchResult {
    id: string;
    kind: number;
    pubkey: string;
    title?: string;
    description?: string;
    image?: string;
    status?: string;
    tags?: string[];
}

export function useGlobalSearch(query: string) {
    const { liveStreams, isLoading } = useNostrStreams({ liveOnly: false }); // Get all streams

    // Client-side filter
    const lowerQuery = query.toLowerCase();
    const results: SearchResult[] = liveStreams.filter(s => {
        return (s.title?.toLowerCase().includes(lowerQuery) ||
            s.description?.toLowerCase().includes(lowerQuery) ||
            s.broadcasterPubkey.includes(lowerQuery) ||
            s.tags?.includes(lowerQuery));
    }).map(s => ({
        id: s.id,
        kind: 30311,
        pubkey: s.broadcasterPubkey,
        title: s.title,
        description: s.description,
        image: s.thumbnail,
        status: s.status,
        tags: s.tags
    }));

    return { results, loading: isLoading };
}
