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
    moneroViewKey?: string;   // Private View Key (for incoming tx scanning)
    moneroSpendKey?: string;  // Public Spend Key (for restoring/verifying keys)
    displayName: string;
    picture?: string;         // Profile picture URL
    nip05?: string;
    nip05Verified?: boolean;
    createdAt: number;
}

const STORAGE_KEY = 'dstream_identity';
const COOKIE_NAME = 'dstream_identity';

function setCookie(name: string, value: string, days: number) {
    if (typeof document === 'undefined') return;
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Strict";
}

function getCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

/**
 * Generate a new Identity (Dual Key: Ed25519 + Nostr)
 */
export async function generateIdentity(displayName?: string): Promise<Identity> {
    // Check for secure context - crypto.subtle requires HTTPS or localhost
    if (typeof window !== 'undefined' && !window.isSecureContext) {
        throw new Error("Identity generation requires HTTPS. Access via localhost or set up HTTPS for LAN access.");
    }

    if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error("WebCrypto API not available. This browser or context doesn't support cryptographic operations.");
    }

    // 1. Generate Protocol Key (Ed25519)
    const privateKey = ed.utils.randomSecretKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);

    // 2. Generate Nostr Key (Secp256k1)
    const nostrSecret = generateSecretKey();
    const nostrPublic = getPublicKey(nostrSecret);

    // Default test Monero address (mainnet format, for development convenience)
    const defaultMoneroAddress = '888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H';

    const identity: Identity = {
        publicKey: bytesToHex(publicKey),
        privateKey: bytesToHex(privateKey),
        nostrPublicKey: nostrPublic,
        nostrPrivateKey: bytesToHex(nostrSecret),
        moneroAddress: defaultMoneroAddress,  // Pre-populate with test address
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

export const saveIdentity = (identity: Identity) => {
    if (typeof window === 'undefined') return;
    const json = JSON.stringify(identity);
    localStorage.setItem(STORAGE_KEY, json);
    setCookie(COOKIE_NAME, json, 365); // Persist for 1 year
};

export const loadIdentity = (): Identity | null => {
    if (typeof window === 'undefined') return null;

    // 1. Try LocalStorage
    let stored = localStorage.getItem(STORAGE_KEY);

    // 2. Fallback to Cookie
    if (!stored) {
        stored = getCookie(COOKIE_NAME);
        if (stored) {
            // Restore to localStorage to keep them in sync
            localStorage.setItem(STORAGE_KEY, stored);
        }
    }

    if (!stored) return null;
    try {
        return JSON.parse(stored);
    } catch (e) {
        return null;
    }
};

export const clearIdentity = () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
    document.cookie = COOKIE_NAME + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
};

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
