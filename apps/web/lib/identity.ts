"use client";

import * as ed from '@noble/ed25519';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

// Helper functions
function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

export interface Identity {
    publicKey: string;  // Ed25519 hex (Protocol)
    privateKey: string; // Ed25519 hex
    nostrPublicKey?: string;  // Secp256k1 hex (Discovery/Chat)
    nostrPrivateKey?: string; // Secp256k1 hex
    moneroAddress?: string;   // XMR Public Address (Primary or Subaddress)
    displayName: string;
    createdAt: number;
}

const STORAGE_KEY = 'dstream_identity';

/**
 * Generate a new Identity (Dual Key: Ed25519 + Nostr)
 */
export async function generateIdentity(displayName?: string): Promise<Identity> {
    // 1. Generate Protocol Key (Ed25519)
    const privateKey = ed.utils.randomSecretKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);

    // 2. Generate Nostr Key (Secp256k1)
    const nostrSecret = generateSecretKey();
    const nostrPublic = getPublicKey(nostrSecret);

    const identity: Identity = {
        publicKey: bytesToHex(publicKey),
        privateKey: bytesToHex(privateKey),
        nostrPublicKey: nostrPublic,
        nostrPrivateKey: bytesToHex(nostrSecret),
        displayName: displayName || `anon_${bytesToHex(publicKey).substring(0, 8)}`,
        createdAt: Date.now()
    };

    return identity;
}

/**
 * Sign a message with the private key
 */
export async function signMessage(message: string, privateKeyHex: string): Promise<string> {
    const privateKey = hexToBytes(privateKeyHex);
    const messageBytes = new TextEncoder().encode(message);
    const signature = await ed.signAsync(messageBytes, privateKey);
    return bytesToHex(signature);
}

/**
 * Verify a signature
 */
export async function verifySignature(
    message: string,
    signatureHex: string,
    publicKeyHex: string
): Promise<boolean> {
    try {
        const signature = hexToBytes(signatureHex);
        const publicKey = hexToBytes(publicKeyHex);
        const messageBytes = new TextEncoder().encode(message);
        return await ed.verifyAsync(signature, messageBytes, publicKey);
    } catch {
        return false;
    }
}

/**
 * Store identity in localStorage
 */
export function saveIdentity(identity: Identity): void {
    if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    }
}

/**
 * Load identity from localStorage
 */
export function loadIdentity(): Identity | null {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    try {
        return JSON.parse(stored);
    } catch {
        return null;
    }
}

/**
 * Clear identity from localStorage
 */
export function clearIdentity(): void {
    if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
    }
}

/**
 * Export identity as JSON string
 */
export function exportIdentity(identity: Identity): string {
    return JSON.stringify(identity, null, 2);
}

/**
 * Import identity from JSON string
 */
export function importIdentity(json: string): Identity | null {
    try {
        const parsed = JSON.parse(json);
        if (parsed.publicKey && parsed.privateKey) {
            return parsed as Identity;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Get short display format of public key
 */
export function shortPubKey(publicKeyHex: string): string {
    return publicKeyHex.substring(0, 8) + '...' + publicKeyHex.substring(publicKeyHex.length - 4);
}
