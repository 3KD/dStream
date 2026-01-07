"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
    Identity,
    generateIdentity,
    saveIdentity,
    loadIdentity,
    clearIdentity,
    signMessage,
    verifySignature
} from '@/lib/identity';
import { verifyNip05 as checkNip05 } from '@/lib/nip05';

// NIP-07 Interface
declare global {
    interface Window {
        nostr?: {
            getPublicKey(): Promise<string>;
            signEvent(event: any): Promise<any>;
            getRelays?(): Promise<any>;
            nip04?: {
                encrypt(pubkey: string, plaintext: string): Promise<string>;
                decrypt(pubkey: string, ciphertext: string): Promise<string>;
            };
        };
    }
}

interface IdentityContextType {
    identity: Identity | null;
    isLoading: boolean;
    createIdentity: (displayName?: string) => Promise<Identity>;
    loginWithExtension: () => Promise<void>;
    updateIdentity: (updates: Partial<Identity>) => void;
    deleteIdentity: () => void;
    sign: (message: string) => Promise<string | null>;
    verify: (message: string, signature: string, pubkey: string) => Promise<boolean>;
    signNostrEvent: (event: any) => Promise<any>;
    verifyNip05: (address?: string) => Promise<boolean>;
    // Monero keys are accessed via identity object
}

const IdentityContext = createContext<IdentityContextType | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
    const [identity, setIdentity] = useState<Identity | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            let stored = loadIdentity();
            if (stored) {
                let needsSave = false;

                // Backfill Nostr keys if missing (Upgrade legacy identity)
                // If using extension (private key missing but pubkey present), don't backfill
                const isExtension = stored.nostrPublicKey && !stored.nostrPrivateKey;

                if (!stored.nostrPrivateKey && !isExtension) {
                    const temp = await generateIdentity(); // Generate new to steal nostr keys
                    stored = {
                        ...stored,
                        nostrPublicKey: temp.nostrPublicKey,
                        nostrPrivateKey: temp.nostrPrivateKey
                    };
                    needsSave = true;
                }

                // Backfill Monero address if missing (for easier dev testing)
                if (!stored.moneroAddress) {
                    stored.moneroAddress = '888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H';
                    needsSave = true;
                }

                // Note: moneroViewKey and moneroSpendKey are optional and won't be auto-filled

                if (needsSave) {
                    saveIdentity(stored);
                }
                setIdentity(stored);
            }
            setIsLoading(false);
        };
        load();
    }, []);

    const createIdentity = async (displayName?: string): Promise<Identity> => {
        const newIdentity = await generateIdentity(displayName);
        saveIdentity(newIdentity);
        setIdentity(newIdentity);
        return newIdentity;
    };

    const loginWithExtension = async () => {
        if (!window.nostr) {
            alert("NIP-07 Extension (Alby, nos2x) not found!");
            return;
        }
        try {
            const pubkey = await window.nostr.getPublicKey();
            const newIdentity: Identity = {
                publicKey: pubkey, // Reuse Nostr Pubkey as App ID for simplicity in Extension mode
                privateKey: "", // No private key access
                nostrPublicKey: pubkey,
                displayName: "Extension User",
                createdAt: Date.now()
            };
            saveIdentity(newIdentity);
            setIdentity(newIdentity);
        } catch (e) {
            console.error("Extension login failed", e);
            alert("Failed to login with extension");
        }
    };

    const updateIdentity = (updates: Partial<Identity>) => {
        if (!identity) return;
        const updated = { ...identity, ...updates };
        saveIdentity(updated);
        setIdentity(updated);
    };

    const deleteIdentity = () => {
        clearIdentity();
        setIdentity(null);
    };

    const sign = async (message: string): Promise<string | null> => {
        if (!identity) return null;
        if (identity.privateKey) {
            return signMessage(message, identity.privateKey);
        }
        // If extension user, we might use NIP-07 signEvent logic repurposed, 
        // but 'signMessage' usually expects Ed25519 signature. 
        // NIP-07 doesn't strictly support generic message signing same as our `crypto.ts`.
        // Ideally we migrate app authentication to pure Nostr events.
        // For now, return null or fallback to a mock if needed.
        return null;
    };

    const signNostrEvent = async (event: any): Promise<any> => {
        if (!identity) throw new Error("No identity");

        // 1. Extension
        if (!identity.nostrPrivateKey && window.nostr) {
            return window.nostr.signEvent(event);
        }

        // 2. Local Key
        if (identity.nostrPrivateKey) {
            const { finalizeEvent } = await import("nostr-tools");
            const hexToBytes = (hex: string) => {
                const bytes = new Uint8Array(hex.length / 2);
                for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                return bytes;
            };
            return finalizeEvent(event, hexToBytes(identity.nostrPrivateKey));
        }

        throw new Error("Cannot sign: No private key and no extension");
    };

    const verify = async (message: string, signature: string, pubkey: string): Promise<boolean> => {
        return verifySignature(message, signature, pubkey);
    };

    const verifyNip05 = async (address?: string): Promise<boolean> => {
        const addr = address || identity?.nip05;
        const pubkey = identity?.nostrPublicKey;

        if (!addr || !pubkey) return false;

        const result = await checkNip05(addr, pubkey);

        // Update local state if valid
        updateIdentity({
            nip05: addr,
            nip05Verified: result.valid
        });

        return result.valid;
    };

    return (
        <IdentityContext.Provider value={{
            identity,
            isLoading,
            createIdentity,
            loginWithExtension,
            updateIdentity,
            deleteIdentity,
            sign,
            verify,
            signNostrEvent,
            verifyNip05
        }}>
            {children}
        </IdentityContext.Provider>
    );
}

export function useIdentity() {
    const context = useContext(IdentityContext);
    if (!context) {
        throw new Error('useIdentity must be used within IdentityProvider');
    }
    return context;
}
