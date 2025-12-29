"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { pool, RELAYS, publishEvent } from "@/lib/nostr";
import { finalizeEvent } from "nostr-tools";

interface TrustedPeersContextType {
    trustedKeys: string[];
    bannedKeys: string[];
    addKey: (key: string) => void;
    removeKey: (key: string) => void;
    banKey: (key: string) => Promise<void>;
    unbanKey: (key: string) => void;
    isTrusted: (key: string) => boolean;
    isBanned: (key: string) => boolean;
}

const TrustedPeersContext = createContext<TrustedPeersContextType | undefined>(undefined);

const STORAGE_KEY = "exo_trusted_peers";
const BANNED_STORAGE_KEY = "exo_banned_peers";
const KIND_REPORT = 1984; // NIP-56

export function TrustedPeersProvider({ children }: { children: React.ReactNode }) {
    const { identity, sign } = useIdentity();
    const [trustedKeys, setTrustedKeys] = useState<string[]>([]);
    const [bannedKeys, setBannedKeys] = useState<string[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load from LocalStorage and Nostr
    useEffect(() => {
        const load = async () => {
            // 1. Local
            let localTrusted: string[] = [];
            let localBanned: string[] = [];

            try {
                const sTrust = localStorage.getItem(STORAGE_KEY);
                if (sTrust) localTrusted = JSON.parse(sTrust);

                const sBan = localStorage.getItem(BANNED_STORAGE_KEY);
                if (sBan) localBanned = JSON.parse(sBan);
            } catch (e) {
                console.error("Failed to parse local keys", e);
            }

            // 2. Cloud (Nostr)
            let cloudTrusted: string[] = [];
            let cloudBanned: string[] = [];

            if (identity?.nostrPublicKey) {
                try {
                    // Fetch Trusted (Kind 3) and Banned (Kind 1984)
                    // Note: Kind 1984 is a "Report", often many events. 
                    // To maintain a persistent "Ban List", one might use a parameterized replaceable event (Kind 30000 range) or just query all reports by me.
                    // For MVP simplicity, we query recent Kind 1984 by me.
                    // Ideally: We use Kind 10000 (Mute List) or Kind 30000 (Categorized People List).
                    // Let's use Kind 10000 (Mute List) as it's standard for "User Blocking".
                    // Kind 1984 is "Public Reporting", Kind 10000 is "Personal Muting".
                    // User requirement: "Ban System". Usually implies internal muting + external signaling.
                    // We will fetch Kind 10000.

                    const events = await pool.querySync(RELAYS, {
                        kinds: [3, 10000],
                        authors: [identity.nostrPublicKey]
                    });

                    const contactList = events.find(e => e.kind === 3);
                    if (contactList) {
                        cloudTrusted = contactList.tags.filter(t => t[0] === 'p').map(t => t[1]);
                    }

                    const muteList = events.find(e => e.kind === 10000);
                    if (muteList) {
                        cloudBanned = muteList.tags.filter(t => t[0] === 'p').map(t => t[1]);
                    }

                    console.log(`[TrustedPeers] Synced ${cloudTrusted.length} trusted, ${cloudBanned.length} banned from Nostr`);

                } catch (e) {
                    console.warn("[TrustedPeers] Failed to sync with Nostr:", e);
                }
            }

            // 3. Merge
            setTrustedKeys(Array.from(new Set([...localTrusted, ...cloudTrusted])));
            setBannedKeys(Array.from(new Set([...localBanned, ...cloudBanned])));
            setIsLoaded(true);
        };

        if (typeof window !== 'undefined') {
            load();
        }
    }, [identity]);

    const saveTrusted = async (keys: string[]) => {
        setTrustedKeys(keys);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));

        if (identity?.nostrPrivateKey) {
            publishList(3, keys, "dStream Trusted Keyring");
        }
    };

    const saveBanned = async (keys: string[]) => {
        setBannedKeys(keys);
        localStorage.setItem(BANNED_STORAGE_KEY, JSON.stringify(keys));

        if (identity?.nostrPrivateKey) {
            publishList(10000, keys, "dStream Ban List"); // Kind 10000 = Mute List
        }
    };

    const publishList = async (kind: number, keys: string[], description: string) => {
        if (!identity?.nostrPrivateKey) return;
        try {
            // Hex helper
            const hexToBytes = (hex: string) => {
                const bytes = new Uint8Array(hex.length / 2);
                for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                return bytes;
            };

            const event = {
                kind: kind,
                created_at: Math.floor(Date.now() / 1000),
                tags: keys.map(k => ['p', k]),
                content: JSON.stringify({ description }),
            };
            const signed = finalizeEvent(event, hexToBytes(identity.nostrPrivateKey));
            await publishEvent(signed);
        } catch (e) { console.error("Failed to publish list", e); }
    };

    const addKey = (key: string) => {
        if (!key || trustedKeys.includes(key)) return;
        saveTrusted([...trustedKeys, key]);
    };

    const removeKey = (key: string) => {
        saveTrusted(trustedKeys.filter((k) => k !== key));
    };

    const banKey = async (key: string) => {
        if (!key || bannedKeys.includes(key)) return;
        console.log("Banning key:", key);

        // 1. Add to Banned List (Mute)
        const newBanned = [...bannedKeys, key];
        await saveBanned(newBanned);

        // 2. Remove from Trusted if present
        if (trustedKeys.includes(key)) {
            removeKey(key);
        }

        // 3. (Optional) Publish Kind 1984 Report (Public Shame/Signal)
        if (identity?.nostrPrivateKey) {
            try {
                const hexToBytes = (hex: string) => {
                    const bytes = new Uint8Array(hex.length / 2);
                    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                    return bytes;
                };
                const report = {
                    kind: 1984,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [['p', key, 'abuse', 'slashed']],
                    content: "User slashed for breaking stream rules or non-payment.",
                };
                await publishEvent(finalizeEvent(report, hexToBytes(identity.nostrPrivateKey)));
            } catch (e) { console.warn("Failed to publish report", e); }
        }
    };

    const unbanKey = (key: string) => {
        saveBanned(bannedKeys.filter(k => k !== key));
    };

    const isTrusted = (key: string) => trustedKeys.includes(key);
    const isBanned = (key: string) => bannedKeys.includes(key);

    if (!isLoaded) {
        return null;
    }

    return (
        <TrustedPeersContext.Provider value={{ trustedKeys, bannedKeys, addKey, removeKey, banKey, unbanKey, isTrusted, isBanned }}>
            {children}
        </TrustedPeersContext.Provider>
    );
}

export function useTrustedPeers() {
    const context = useContext(TrustedPeersContext);
    if (context === undefined) {
        throw new Error("useTrustedPeers must be used within a TrustedPeersProvider");
    }
    return context;
}
