import { pools, RELAYS, publishEvent } from "@/lib/nostr";
import { nip04 } from "nostr-tools";
import { pool } from "@/lib/nostr";

export type SignalType = 'p2p-request' | 'offer' | 'answer' | 'candidate';

export interface P2PSignal {
    type: SignalType;
    sdp?: string; // For offer/answer
    candidate?: RTCIceCandidateInit; // For candidates
    streamId?: string; // To match streams
}

/**
 * Send a signaling message to a peer via NIP-04 DM
 */
export async function sendSignal(
    identity: { nostrPrivateKey: string, nostrPublicKey: string },
    peerPubkey: string,
    signal: P2PSignal
) {
    try {
        const content = JSON.stringify(signal);
        const ciphertext = await nip04.encrypt(identity.nostrPrivateKey, peerPubkey, content);

        await publishEvent({
            kind: 4,
            content: ciphertext,
            tags: [['p', peerPubkey]],
            created_at: Math.floor(Date.now() / 1000),
            pubkey: identity.nostrPublicKey // publishEvent handles signing if we pass the signer, but here we assume publishEvent is a wrapper or we reconstruct.
            // Actually publishEvent in lib/nostr usually expects a signed event or handles it. 
            // Let's assume we use a specialized function or the identity context's signer in the component.
            // For this lib, let's return the event draft for the component to sign.
        } as any);
        // Wait, publishEvent in this codebase might be different. 
        // Let's verify `lib/nostr` first to avoid errors.
    } catch (e) {
        console.error("Signal send failed", e);
    }
}

// Let's actually check lib/nostr content before committing this file to ensure correct publish usage.
