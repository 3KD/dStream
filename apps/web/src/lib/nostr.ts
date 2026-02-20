/**
 * Nostr Service Layer
 * 
 * Handles all Nostr relay communication.
 * Uses nostr-tools under the hood but provides a cleaner API.
 */
import { SimplePool, finalizeEvent, type Event } from 'nostr-tools';
import { RELAYS } from '@/lib/config';
export { RELAYS };
import { NOSTR_KINDS, Identity } from '@/lib/types';

// Singleton pool instance
let pool: SimplePool | null = null;

export function getPool(): SimplePool {
    if (!pool) {
        pool = new SimplePool();
    }
    return pool;
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

/**
 * Publish an event to configured relays.
 * Returns true if at least one relay accepted the event.
 */
export async function publishEvent(event: Event): Promise<boolean> {
    const pool = getPool();

    try {
        const pubs = pool.publish(RELAYS, event);

        // Wait for at least one success with timeout
        await Promise.race([
            Promise.any(pubs),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Publish timeout')), 5000))
        ]);

        // console.log('[Nostr] Published event:', event.id);
        return true;
    } catch (e) {
        console.warn('[Nostr] Failed to publish:', e);
        return false;
    }
}

/**
 * Create and sign an event with the given identity.
 */
export async function createSignedEvent(
    identity: Identity,
    kind: number,
    content: string,
    tags: string[][] = []
): Promise<Event> {
    if (identity.isExtension) {
        // NIP-07 extension signing
        const nostr = (window as any).nostr;
        if (!nostr) throw new Error('Nostr extension not available');

        const event = {
            kind,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content,
            pubkey: identity.publicKey,
        };

        return await nostr.signEvent(event);
    }

    if (!identity.privateKey) {
        throw new Error('No private key available for signing');
    }

    // Local key signing
    const event = {
        kind,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
    };

    return finalizeEvent(event, hexToBytes(identity.privateKey));
}

/**
 * Subscribe to events matching a filter.
 * Returns a cleanup function.
 */
export function subscribeToEvents(
    filter: any,
    onEvent: (event: Event) => void,
    onEose?: () => void
): () => void {
    const pool = getPool();

    // Validate filter
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
        console.error('[Nostr] Invalid filter passed to subscribeToEvents:', filter);
        return () => { };
    }

    // Clean undefined values
    const cleanFilter = JSON.parse(JSON.stringify(filter));

    console.debug('[Nostr] Subscribing with filter:', cleanFilter);

    const sub = (pool as any).subscribeMany(RELAYS, cleanFilter, {
        onevent: onEvent,
        oneose: onEose,
    });

    return () => sub.close();
}

/**
 * Fetch a single event by ID.
 */
export async function fetchEvent(id: string): Promise<Event | null> {
    const pool = getPool();

    try {
        const event = await pool.get(RELAYS, { ids: [id] });
        return event;
    } catch (e) {
        console.warn('[Nostr] Failed to fetch event:', e);
        return null;
    }
}

/**
 * Fetch user profile metadata.
 */
export async function fetchProfile(pubkey: string): Promise<{
    name?: string;
    picture?: string;
    nip05?: string;
    about?: string;
    banner?: string;
    lud16?: string;
} | null> {
    const pool = getPool();

    try {
        const event = await pool.get(RELAYS, {
            kinds: [NOSTR_KINDS.METADATA],
            authors: [pubkey],
            limit: 1
        });

        if (event?.content) {
            return JSON.parse(event.content);
        }
        return null;
    } catch (e) {
        console.warn('[Nostr] Failed to fetch profile:', e);
        return null;
    }
}

/**
 * Announce a live stream (NIP-53).
 */
export async function announceStream(
    identity: Identity,
    streamId: string,
    title: string,
    status: 'live' | 'ended',
    options?: {
        summary?: string;
        image?: string;
        tags?: string[];
        streaming?: string;
    }
): Promise<boolean> {
    const tags: string[][] = [
        ['d', streamId],
        ['title', title],
        ['status', status],
    ];

    if (options?.summary) tags.push(['summary', options.summary]);
    if (options?.image) tags.push(['image', options.image]);
    if (options?.streaming) tags.push(['streaming', options.streaming]);
    if (options?.tags) {
        options.tags.forEach(t => tags.push(['t', t]));
    }

    try {
        const event = await createSignedEvent(
            identity,
            NOSTR_KINDS.STREAM_ANNOUNCE,
            '',
            tags
        );

        return await publishEvent(event);
    } catch (e) {
        console.error('[Nostr] Failed to announce stream:', e);
        return false;
    }
}

/**
 * Send a chat message to a stream.
 */
export async function sendStreamChat(
    identity: Identity,
    broadcasterPubkey: string,
    streamId: string,
    message: string
): Promise<boolean> {
    const aTag = `30311:${broadcasterPubkey}:${streamId}`;

    try {
        const event = await createSignedEvent(
            identity,
            NOSTR_KINDS.STREAM_CHAT,
            message,
            [['a', aTag, 'root', 'reply']]
        );

        return await publishEvent(event);
    } catch (e) {
        console.error('[Nostr] Failed to send chat:', e);
        return false;
    }
}
