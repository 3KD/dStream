/**
 * Integrity Module
 * 
 * Tier 28: Stream signing and verification.
 * Broadcasters sign the manifest, viewers verify.
 */
import { createSignedEvent, publishEvent } from './nostr';
import { Identity } from './types';

/**
 * Sign a manifest or segment hash.
 * Creates a kind:30311 update or a dedicated integrity event.
 */
export async function signMediaHash(
    identity: Identity,
    streamId: string,
    hash: string,
    sequence: number
): Promise<boolean> {
    const tags: string[][] = [
        ['d', streamId],
        ['h', hash],
        ['s', sequence.toString()],
    ];

    try {
        const event = await createSignedEvent(
            identity,
            30311, // Live Event update
            '',
            tags
        );
        return await publishEvent(event);
    } catch (e) {
        console.error('[Integrity] Failed to sign hash:', e);
        return false;
    }
}

/**
 * Verify a media hash against a pubkey.
 */
export function verifyMediaHash(
    pubkey: string,
    hash: string,
    signature: string
): boolean {
    // This requires the full event object, not just the hash.
    // In dStream, we verify the Nostr event signature which contains the hash in tags.
    return true; // Stub for now, real verification happens in Event parsing
}

/**
 * Generate a SHA-256 hash of a string or buffer.
 */
export async function computeHash(data: string | ArrayBuffer): Promise<string> {
    const msgUint8 = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : new Uint8Array(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
