"use client";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Identity } from '@/lib/types';

interface IdentityContextValue {
    /** Current user identity */
    identity: Identity | null;
    /** Whether identity is being loaded */
    isLoading: boolean;
    /** Generate a new local keypair */
    generateIdentity: () => Promise<Identity>;
    /** Connect via NIP-07 extension (Alby, nos2x, etc.) */
    connectExtension: () => Promise<Identity>;
    /** Clear current identity */
    logout: () => void;
    /** Sign a message with the current identity */
    sign: (message: string) => Promise<string>;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

const STORAGE_KEY = 'dstream_identity';

export function IdentityProvider({ children }: { children: ReactNode }) {
    const [identity, setIdentity] = useState<Identity | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Load identity from localStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setIdentity(parsed);
            } catch (e) {
                console.error('[Identity] Failed to parse stored identity:', e);
            }
        }
        setIsLoading(false);
    }, []);

    // Persist identity changes
    useEffect(() => {
        if (identity) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    }, [identity]);

    const generateIdentity = useCallback(async (): Promise<Identity> => {
        // Dynamic import to avoid SSR issues
        const { generateSecretKey, getPublicKey } = await import('nostr-tools');

        const privateKeyBytes = generateSecretKey();
        const privateKey = Buffer.from(privateKeyBytes).toString('hex');
        const publicKey = getPublicKey(privateKeyBytes);

        const newIdentity: Identity = {
            publicKey,
            privateKey,
            isExtension: false,
        };

        setIdentity(newIdentity);
        return newIdentity;
    }, []);

    const connectExtension = useCallback(async (): Promise<Identity> => {
        if (typeof window === 'undefined' || !(window as any).nostr) {
            throw new Error('No Nostr extension found. Install Alby or nos2x.');
        }

        const nostr = (window as any).nostr;
        const publicKey = await nostr.getPublicKey();

        const newIdentity: Identity = {
            publicKey,
            isExtension: true,
        };

        setIdentity(newIdentity);
        return newIdentity;
    }, []);

    const logout = useCallback(() => {
        setIdentity(null);
    }, []);

    const sign = useCallback(async (message: string): Promise<string> => {
        if (!identity) {
            throw new Error('No identity available');
        }

        if (identity.isExtension) {
            const nostr = (window as any).nostr;
            // NIP-07 extensions sign events, not raw messages
            // For now, return empty - real signing happens in event creation
            return '';
        }

        if (!identity.privateKey) {
            throw new Error('No private key available');
        }

        // For local keys, signing happens during event finalization
        return '';
    }, [identity]);

    return (
        <IdentityContext.Provider value={{
            identity,
            isLoading,
            generateIdentity,
            connectExtension,
            logout,
            sign,
        }}>
            {children}
        </IdentityContext.Provider>
    );
}

export function useIdentity() {
    const context = useContext(IdentityContext);
    if (!context) {
        throw new Error('useIdentity must be used within an IdentityProvider');
    }
    return context;
}
