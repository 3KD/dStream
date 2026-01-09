import { nip04 } from "nostr-tools";
import { Identity } from "@/lib/identity";

export type SignalType = 'p2p-request' | 'offer' | 'answer' | 'candidate';

export interface P2PSignal {
    type: SignalType;
    sdp?: string;         // For offer/answer
    candidate?: RTCIceCandidateInit; // For candidates
    streamId?: string;    // To multiplex or verify
}

/**
 * Encrypts a signaling message for a peer.
 * Supports both local keys (via nip04) and NIP-07 extensions (via window.nostr).
 */
export async function encryptSignal(
    identity: Identity,
    peerPubkey: string,
    signal: P2PSignal
): Promise<string> {
    const content = JSON.stringify(signal);

    if (identity.nostrPrivateKey) {
        // Local Key
        return await nip04.encrypt(identity.nostrPrivateKey, peerPubkey, content);
    } else if (typeof window !== 'undefined' && (window as any).nostr) {
        // NIP-07 Extension
        return await (window as any).nostr.nip04.encrypt(peerPubkey, content);
    } else {
        throw new Error("No private key or extension available for encryption");
    }
}

/**
 * Decrypts a signaling message from a peer.
 */
export async function decryptSignal(
    identity: Identity,
    peerPubkey: string,
    ciphertext: string
): Promise<P2PSignal | null> {
    try {
        let plaintext: string;

        if (identity.nostrPrivateKey) {
            plaintext = await nip04.decrypt(identity.nostrPrivateKey, peerPubkey, ciphertext);
        } else if (typeof window !== 'undefined' && (window as any).nostr) {
            plaintext = await (window as any).nostr.nip04.decrypt(peerPubkey, ciphertext);
        } else {
            throw new Error("No private key or extension available for decryption");
        }

        return JSON.parse(plaintext) as P2PSignal;
    } catch (e) {
        console.error("Failed to decrypt P2P signal", e);
        return null;
    }
}

/**
 * Creates a raw event object (unsigned) for the signal
 */
export async function createSignalEvent(
    identity: Identity,
    peerPubkey: string,
    signal: P2PSignal
) {
    const content = await encryptSignal(identity, peerPubkey, signal);

    return {
        kind: 4,
        pubkey: identity.nostrPublicKey,
        tags: [['p', peerPubkey]],
        content: content,
        created_at: Math.floor(Date.now() / 1000)
    };
}
