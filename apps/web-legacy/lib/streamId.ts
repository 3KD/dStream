/**
 * Stream ID Derivation
 * 
 * Creates identity-bound stream paths to prevent hijacking.
 * The derived path is: sha256(pubkey + streamName).substring(0, 16)
 * 
 * This ensures:
 * - Only the holder of the private key can announce this stream on Nostr
 * - The path is deterministic and verifiable by anyone
 * - Human-readable name is preserved in the Nostr announcement
 */

/**
 * Derive an identity-bound stream path
 * 
 * @param pubkey - The broadcaster's public key (hex)
 * @param streamName - The human-readable stream name chosen by broadcaster
 * @returns A 16-character hex string derived from hash(pubkey + streamName)
 */
export async function deriveStreamPath(pubkey: string, streamName: string): Promise<string> {
    const input = `${pubkey}:${streamName}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(input);

    // Use Web Crypto API for SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Return first 16 characters (64 bits) - enough for unique paths
    return hashHex.substring(0, 16);
}

/**
 * Verify that a stream path matches the expected derivation
 * 
 * @param pubkey - The broadcaster's claimed public key
 * @param streamName - The claimed stream name
 * @param streamPath - The stream path to verify
 * @returns True if the path matches the derivation
 */
export async function verifyStreamPath(pubkey: string, streamName: string, streamPath: string): Promise<boolean> {
    const expected = await deriveStreamPath(pubkey, streamName);
    return expected === streamPath;
}
