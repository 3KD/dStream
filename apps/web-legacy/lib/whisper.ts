/**
 * Whisper System - Multi-Recipient Encrypted Messages
 * 
 * Whispers are encrypted messages visible only to:
 * 1. The sender
 * 2. The specified recipient(s)
 * 3. The broadcaster (always)
 * 4. Designated admins (always)
 * 
 * Uses NIP-04 encryption per-recipient wrapped in a custom envelope.
 */

import { nip04 } from "nostr-tools";

// Custom kind for whispers (in the ephemeral range 20000-29999)
export const KIND_WHISPER = 20004;

export interface WhisperEnvelope {
    // Each key is a recipient pubkey, value is the NIP-04 encrypted content for that recipient
    recipients: Record<string, string>;
    // Sender pubkey (for display, verified via event.pubkey)
    sender: string;
}

/**
 * Encrypt a whisper message for multiple recipients.
 * The content is encrypted separately for each recipient using NIP-04.
 * 
 * @param content - The plaintext message
 * @param senderPrivateKey - Sender's private key (hex)
 * @param senderPubkey - Sender's public key (hex)
 * @param recipientPubkeys - Array of recipient pubkeys (includes broadcaster + admins)
 * @returns JSON string of WhisperEnvelope
 */
export async function encryptWhisper(
    content: string,
    senderPrivateKey: string,
    senderPubkey: string,
    recipientPubkeys: string[]
): Promise<string> {
    const recipients: Record<string, string> = {};

    // Encrypt for each recipient
    for (const pubkey of recipientPubkeys) {
        try {
            const encrypted = await nip04.encrypt(senderPrivateKey, pubkey, content);
            recipients[pubkey] = encrypted;
        } catch (e) {
            console.warn(`[Whisper] Failed to encrypt for ${pubkey.substring(0, 8)}:`, e);
        }
    }

    // Also encrypt for sender so they can see their own whispers
    if (!recipients[senderPubkey]) {
        try {
            const selfEncrypted = await nip04.encrypt(senderPrivateKey, senderPubkey, content);
            recipients[senderPubkey] = selfEncrypted;
        } catch (e) {
            // Sender will still see optimistic update
        }
    }

    const envelope: WhisperEnvelope = {
        recipients,
        sender: senderPubkey
    };

    return JSON.stringify(envelope);
}

/**
 * Attempt to decrypt a whisper message.
 * Returns null if the current user is not a recipient.
 * 
 * @param envelopeJson - The whisper envelope JSON string
 * @param myPrivateKey - Current user's private key (hex)
 * @param myPubkey - Current user's public key (hex)
 * @param senderPubkey - The event.pubkey of the sender (for NIP-04 decryption)
 * @returns Decrypted message or null if not a recipient
 */
export async function decryptWhisper(
    envelopeJson: string,
    myPrivateKey: string,
    myPubkey: string,
    senderPubkey: string
): Promise<string | null> {
    try {
        const envelope: WhisperEnvelope = JSON.parse(envelopeJson);

        // Check if I have an encrypted copy
        const myEncryptedCopy = envelope.recipients[myPubkey];
        if (!myEncryptedCopy) {
            // Not a recipient - return null (message should be invisible)
            return null;
        }

        // Decrypt using sender's pubkey
        const decrypted = await nip04.decrypt(myPrivateKey, senderPubkey, myEncryptedCopy);
        return decrypted;
    } catch (e) {
        console.warn("[Whisper] Decryption failed:", e);
        return null;
    }
}

/**
 * Check if a pubkey is in the whisper's recipient list WITHOUT decrypting.
 * Used for quick filtering.
 */
export function isWhisperRecipient(envelopeJson: string, pubkey: string): boolean {
    try {
        const envelope: WhisperEnvelope = JSON.parse(envelopeJson);
        return pubkey in envelope.recipients;
    } catch {
        return false;
    }
}

/**
 * Get the list of recipient pubkeys from a whisper envelope.
 */
export function getWhisperRecipients(envelopeJson: string): string[] {
    try {
        const envelope: WhisperEnvelope = JSON.parse(envelopeJson);
        return Object.keys(envelope.recipients);
    } catch {
        return [];
    }
}

/**
 * Get the sender pubkey from the envelope (for display purposes).
 */
export function getWhisperSender(envelopeJson: string): string | null {
    try {
        const envelope: WhisperEnvelope = JSON.parse(envelopeJson);
        return envelope.sender;
    } catch {
        return null;
    }
}
