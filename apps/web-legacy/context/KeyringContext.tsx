"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useIdentity } from './IdentityContext';
import { pool, RELAYS } from '@/lib/nostr';
import { shortPubKey } from '@/lib/identity';

interface KeyringContextType {
    aliases: Record<string, string>;
    setAlias: (pubkey: string, name: string) => Promise<void>;
    getAlias: (pubkey: string) => string; // Returns alias OR shortPubkey
    getRawAlias: (pubkey: string) => string | undefined; // Returns alias or undefined
    isLoading: boolean;
}

const KeyringContext = createContext<KeyringContextType | null>(null);

export function KeyringProvider({ children }: { children: ReactNode }) {
    const { identity, signNostrEvent } = useIdentity();
    const [aliases, setAliases] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(true);

    // Load from LocalStorage immediately
    useEffect(() => {
        const saved = localStorage.getItem('dstream_keyring');
        if (saved) {
            try {
                setAliases(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to parse local keyring", e);
            }
        }
    }, []);

    // Sync from Relay (Kind 3)
    useEffect(() => {
        if (!identity?.nostrPublicKey) {
            setIsLoading(false);
            return;
        }

        const fetchContacts = async () => {
            try {
                const events = await pool.querySync(RELAYS, {
                    authors: [identity.nostrPublicKey!],
                    kinds: [3]
                });

                // Get latest kind 3
                const latest = events.sort((a, b) => b.created_at - a.created_at)[0];

                if (latest) {
                    const newAliases: Record<string, string> = {};
                    latest.tags.forEach(tag => {
                        if (tag[0] === 'p' && tag[3]) {
                            // ["p", "pubkey", "relay", "petname"]
                            newAliases[tag[1]] = tag[3];
                        }
                    });

                    // Merge with local state (Server wins? Or Local wins? Let's say Relay wins for sync)
                    setAliases(prev => {
                        const next = { ...prev, ...newAliases };
                        localStorage.setItem('dstream_keyring', JSON.stringify(next));
                        return next;
                    });
                }
            } catch (e) {
                console.error("Failed to fetch contacts", e);
            } finally {
                setIsLoading(false);
            }
        };

        fetchContacts();
    }, [identity?.nostrPublicKey]);

    const setAlias = async (pubkey: string, name: string) => {
        // 1. Update State & LocalStorage
        const nextAliases = { ...aliases, [pubkey]: name };
        setAliases(nextAliases);
        localStorage.setItem('dstream_keyring', JSON.stringify(nextAliases));

        // 2. Publish to Relay (Kind 3) if logged in
        if (identity?.nostrPublicKey) {
            try {
                // Fetch latest Kind 3 first to avoid overwriting other contacts
                const events = await pool.querySync(RELAYS, {
                    authors: [identity.nostrPublicKey!],
                    kinds: [3]
                });
                const latest = events.sort((a, b) => b.created_at - a.created_at)[0];

                let tags = latest ? [...latest.tags] : [];

                // Remove existing tag for this pubkey if exists
                tags = tags.filter(t => t[0] !== 'p' || t[1] !== pubkey);

                // Add new tag with petname
                tags.push(['p', pubkey, '', name]);

                const event = {
                    kind: 3,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: tags,
                    content: latest ? latest.content : "", // Keep content (often relay lists)
                    pubkey: identity.nostrPublicKey
                };

                const signed = await signNostrEvent(event);
                await Promise.any(pool.publish(RELAYS, signed));
            } catch (e) {
                console.error("Failed to publish contact list", e);
            }
        }
    };

    const getAlias = (pubkey: string) => {
        return aliases[pubkey] || shortPubKey(pubkey);
    };

    const getRawAlias = (pubkey: string) => {
        return aliases[pubkey];
    };

    return (
        <KeyringContext.Provider value={{ aliases, setAlias, getAlias, getRawAlias, isLoading }}>
            {children}
        </KeyringContext.Provider>
    );
}

export function useKeyring() {
    const context = useContext(KeyringContext);
    if (!context) {
        throw new Error('useKeyring must be used within KeyringProvider');
    }
    return context;
}
