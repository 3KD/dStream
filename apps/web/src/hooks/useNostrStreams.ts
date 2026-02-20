"use client";
import { useState, useEffect, useRef } from 'react';
import { subscribeToEvents } from '@/lib/nostr';
import { NOSTR_KINDS, Stream } from '@/lib/types';

interface UseNostrStreamsOptions {
    /** Only fetch live streams */
    liveOnly?: boolean;
    /** Maximum streams to track */
    limit?: number;
    /** How long a live announce is considered active */
    liveWindowSec?: number;
    /** Max live streams to show per broadcaster */
    maxPerBroadcaster?: number;
}

function nowSec() {
    return Math.floor(Date.now() / 1000);
}

function streamKey(stream: Stream) {
    return `${stream.broadcasterPubkey}:${stream.id}`;
}

function clampPerBroadcaster(streams: Stream[], maxPerBroadcaster: number) {
    if (!Number.isFinite(maxPerBroadcaster) || maxPerBroadcaster < 1) return streams;
    if (maxPerBroadcaster >= streams.length) return streams;

    const counts = new Map<string, number>();
    const filtered: Stream[] = [];
    for (const stream of streams) {
        const used = counts.get(stream.broadcasterPubkey) ?? 0;
        if (used >= maxPerBroadcaster) continue;
        counts.set(stream.broadcasterPubkey, used + 1);
        filtered.push(stream);
    }
    return filtered;
}

export function useNostrStreams({
    liveOnly = true,
    limit = 50,
    liveWindowSec = 180,
    maxPerBroadcaster
}: UseNostrStreamsOptions = {}) {
    const [streams, setStreams] = useState<Stream[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const seenByStream = useRef<Map<string, number>>(new Map());
    const maxPerPubkey = maxPerBroadcaster ?? (liveOnly ? 1 : Number.POSITIVE_INFINITY);

    useEffect(() => {
        setIsLoading(true);
        setStreams([]);
        seenByStream.current = new Map();

        const filter = {
            kinds: [NOSTR_KINDS.STREAM_ANNOUNCE],
            since: nowSec() - 86400, // Last 24 hours
            limit: limit * 2, // Fetch extra, filter after
        };

        const unsubscribe = subscribeToEvents(
            filter,
            (event) => {
                // Parse stream from tags
                const dTag = event.tags.find(t => t[0] === 'd')?.[1];
                const title = event.tags.find(t => t[0] === 'title')?.[1];
                const status = event.tags.find(t => t[0] === 'status')?.[1];
                const summary = event.tags.find(t => t[0] === 'summary')?.[1];
                const image = event.tags.find(t => t[0] === 'image')?.[1];
                const streamingUrl = event.tags.find(t => t[0] === 'streaming')?.[1];
                const tags = event.tags.filter(t => t[0] === 't').map(t => t[1]);

                if (!dTag) return;
                if (liveOnly && status !== 'live') return;
                if (liveOnly && event.created_at < nowSec() - liveWindowSec) return;

                const uniqueKey = `${event.pubkey}:${dTag}`;
                const prevCreatedAt = seenByStream.current.get(uniqueKey);
                if (prevCreatedAt && prevCreatedAt >= event.created_at) return;
                seenByStream.current.set(uniqueKey, event.created_at);

                const stream: Stream = {
                    id: dTag,
                    title: title || dTag,
                    broadcasterPubkey: event.pubkey,
                    status: (status as Stream['status']) || 'offline',
                    startedAt: event.created_at,
                    viewerCount: 0,
                    thumbnail: image,
                    tags: tags,
                    description: summary,
                    streamingUrl: streamingUrl,
                };

                setStreams(prev => {
                    const nextByKey = new Map<string, Stream>();
                    for (const item of prev) nextByKey.set(streamKey(item), item);
                    nextByKey.set(uniqueKey, stream);

                    const sorted = Array.from(nextByKey.values())
                        .filter(item => !liveOnly || (item.startedAt || 0) >= nowSec() - liveWindowSec)
                        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

                    return clampPerBroadcaster(sorted, maxPerPubkey).slice(0, limit);
                });
            },
            () => {
                setIsLoading(false);
            }
        );

        return () => unsubscribe();
    }, [liveOnly, limit, liveWindowSec, maxPerPubkey]);

    useEffect(() => {
        if (!liveOnly) return;

        const prune = () => {
            const cutoff = nowSec() - liveWindowSec;
            setStreams(prev => {
                const filtered = prev.filter(item => (item.startedAt || 0) >= cutoff);
                if (filtered.length === prev.length) return prev;

                seenByStream.current = new Map(
                    filtered.map(item => [streamKey(item), item.startedAt || 0] as const)
                );

                return clampPerBroadcaster(
                    filtered.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)),
                    maxPerPubkey
                ).slice(0, limit);
            });
        };

        prune();
        const interval = setInterval(prune, 15000);
        return () => clearInterval(interval);
    }, [liveOnly, liveWindowSec, maxPerPubkey, limit]);

    const liveStreams = streams.filter(s => s.status === 'live');

    return {
        streams,
        liveStreams,
        isLoading,
        count: streams.length,
        liveCount: liveStreams.length,
    };
}
