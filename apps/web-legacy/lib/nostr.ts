import { SimplePool } from 'nostr-tools/pool';
import { getEventHash } from 'nostr-tools';

export const RELAYS = [
    // 'ws://localhost:8081', // Local Dev Relay
    'wss://relay.snort.social',
    'wss://relay.primal.net'
];

// Initialize Pool
export const pool = new SimplePool();

// Kinds
export const KIND_STREAM_ANNOUNCE = 30311; // NIP-53 Live Activity
export const KIND_CHAT_MESSAGE = 1;

// Helper to publish with timeout
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Publish timeout')), ms)
        )
    ]);
};

export const publishEvent = async (event: any, retries = 2) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // Strategy: Try ALL relays (Local + Public) and succeed if ANY works
            // This prevents "AggregateError" if localhost is down but public works (or vice versa)

            // 1. Combine local and public
            const targets = RELAYS;
            console.log(`[Nostr] Publishing to ${targets.length} relays...`);

            const pubs = pool.publish(targets, event);

            // 2. Wait for at least one success (fastest wins)
            await withTimeout(Promise.any(pubs), 3000);

            console.log(`[Nostr] Successfully published event ${event.id}`);
            return true;

        } catch (e) {
            // This catches AggregateError (if all failed) or Timeout
            console.warn(`[Nostr] Publish attempt ${attempt + 1} failed:`, e);

            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 500)); // Brief delay
            } else {
                console.warn(`[Nostr] Failed to publish event after ${retries + 1} attempts. Proceeding assuming offline/P2P only.`);
                return false; // Return false, don't throw
            }
        }
    }
    return false;
};

// Helper: Get 'd' tag (identifier)
export const getTag = (tags: string[][], key: string): string | undefined => {
    return tags.find(t => t[0] === key)?.[1];
};

/**
 * Mine Proof-of-Work for a Nostr event
 * NIP-13: Add "nonce" tag such that ID has leading zero bits
 */
export const minePow = (event: any, targetDifficulty: number): any => {
    let nonce = 0;
    event.tags = event.tags.filter((t: string[]) => t[0] !== 'nonce'); // Remove existing

    console.log(`[PoW] Mining for difficulty ${targetDifficulty}...`);
    const start = Date.now();

    while (true) {
        const nonceTag = ['nonce', nonce.toString(), targetDifficulty.toString()];
        const eventWithNonce = { ...event, tags: [...event.tags, nonceTag] };
        const id = getEventHash(eventWithNonce);

        // Check leading zeros (hex formatting)
        // 4 bits per hex char.
        // E.g. difficulty 8 = 2 hex chars "00..."
        // Difficulty 20 = 5 hex chars "00000..."
        // We need to parse bits accurately.

        const leadingZeros = countLeadingZeroBits(id);
        if (leadingZeros >= targetDifficulty) {
            console.log(`[PoW] Mined! Nonce: ${nonce}, Hash: ${id}, Difficulty: ${leadingZeros} (Time: ${Date.now() - start}ms)`);
            return { ...eventWithNonce, id };
        }

        nonce++;
        if (nonce % 10000 === 0) {
            // Yield to main thread every 10k iterations if needed (not in a worker, so we block, but loop is fast)
            // In a real app, use a Web Worker
            if (Date.now() - start > 10000) {
                console.warn("[PoW] Mining timeout (10s), giving up");
                return event; // Fallback
            }
        }
    }
};

function countLeadingZeroBits(hex: string): number {
    let count = 0;
    for (let i = 0; i < hex.length; i++) {
        const val = parseInt(hex[i], 16);
        if (val === 0) {
            count += 4;
        } else {
            // Count zero bits in this nibble
            // 8 (1000) -> 0
            // 4 (0100) -> 1
            // 2 (0010) -> 2
            // 1 (0001) -> 3
            if (val < 8) count++;
            if (val < 4) count++;
            if (val < 2) count++;
            break;
        }
    }
    return count;
}
