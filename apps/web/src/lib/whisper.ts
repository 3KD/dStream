/**
 * Whisper Library
 * 
 * Tier 17: Multi-recipient encrypted messages for stream chat.
 * Whispers are visible to sender, recipients, broadcaster, and moderators.
 */
import { nip04 } from 'nostr-tools';

/**
 * Encrypt a whisper message for multiple recipients.
 * Returns an object mapping pubkey -> encrypted content.
 */
export async function encryptWhisper(
    privateKey: string,
    recipientPubkeys: string[],
    message: string
): Promise<{ [pubkey: string]: string }> {
    const privateKeyBytes = hexToBytes(privateKey);
    const result: { [pubkey: string]: string } = {};

    for (const pubkey of recipientPubkeys) {
        const encrypted = await nip04.encrypt(privateKeyBytes, pubkey, message);
        result[pubkey] = encrypted;
    }

    return result;
}

/**
 * Decrypt a whisper message.
 */
export async function decryptWhisper(
    privateKey: string,
    senderPubkey: string,
    encryptedContent: string
): Promise<string> {
    const privateKeyBytes = hexToBytes(privateKey);
    return await nip04.decrypt(privateKeyBytes, senderPubkey, encryptedContent);
}

/**
 * Parse whisper command from chat input.
 * Format: /wh(user1,user2) message
 * Returns null if not a whisper command.
 */
export function parseWhisperCommand(input: string): {
    recipients: string[];
    message: string;
} | null {
    const match = input.match(/^\/wh\(([^)]+)\)\s+(.+)$/);
    if (!match) return null;

    const recipientsStr = match[1];
    const message = match[2];

    const recipients = recipientsStr
        .split(',')
        .map(r => r.trim())
        .filter(r => r.length > 0);

    if (recipients.length === 0) return null;

    return { recipients, message };
}

/**
 * Check if a pubkey is among whisper recipients.
 * Extracts from event tags.
 */
export function isWhisperRecipient(
    eventTags: string[][],
    pubkey: string
): boolean {
    return eventTags.some(
        tag => tag[0] === 'p' && tag[1] === pubkey
    );
}

function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}
