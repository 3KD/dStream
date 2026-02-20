"use client";
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface TrustedPeersContextValue {
    /** Check if pubkey is trusted */
    isTrusted: (pubkey: string) => boolean;
    /** Check if pubkey is banned */
    isBanned: (pubkey: string) => boolean;
    /** Trust a pubkey */
    trust: (pubkey: string) => void;
    /** Untrust a pubkey */
    untrust: (pubkey: string) => void;
    /** Ban a pubkey */
    ban: (pubkey: string) => void;
    /** Unban a pubkey */
    unban: (pubkey: string) => void;
    /** All trusted pubkeys */
    trustedKeys: string[];
    /** All banned pubkeys */
    bannedPubkeys: string[];
}

const TrustedPeersContext = createContext<TrustedPeersContextValue | null>(null);

const STORAGE_KEY_TRUSTED = 'dstream_trusted';
const STORAGE_KEY_BANNED = 'dstream_banned';

export function TrustedPeersProvider({ children }: { children: ReactNode }) {
    const [trustedKeys, setTrusted] = useState<string[]>([]);
    const [bannedPubkeys, setBanned] = useState<string[]>([]);

    // Load from localStorage
    useEffect(() => {
        const storedTrusted = localStorage.getItem(STORAGE_KEY_TRUSTED);
        const storedBanned = localStorage.getItem(STORAGE_KEY_BANNED);

        if (storedTrusted) {
            try { setTrusted(JSON.parse(storedTrusted)); } catch { }
        }
        if (storedBanned) {
            try { setBanned(JSON.parse(storedBanned)); } catch { }
        }
    }, []);

    // Persist
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_TRUSTED, JSON.stringify(trustedKeys));
    }, [trustedKeys]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_BANNED, JSON.stringify(bannedPubkeys));
    }, [bannedPubkeys]);

    const isTrusted = useCallback((pubkey: string) => trustedKeys.includes(pubkey), [trustedKeys]);
    const isBanned = useCallback((pubkey: string) => bannedPubkeys.includes(pubkey), [bannedPubkeys]);

    const trust = useCallback((pubkey: string) => {
        setTrusted(prev => prev.includes(pubkey) ? prev : [...prev, pubkey]);
        setBanned(prev => prev.filter(p => p !== pubkey)); // Remove from banned
    }, []);

    const untrust = useCallback((pubkey: string) => {
        setTrusted(prev => prev.filter(p => p !== pubkey));
    }, []);

    const ban = useCallback((pubkey: string) => {
        setBanned(prev => prev.includes(pubkey) ? prev : [...prev, pubkey]);
        setTrusted(prev => prev.filter(p => p !== pubkey)); // Remove from trusted
    }, []);

    const unban = useCallback((pubkey: string) => {
        setBanned(prev => prev.filter(p => p !== pubkey));
    }, []);

    return (
        <TrustedPeersContext.Provider value={{
            isTrusted,
            isBanned,
            trust,
            untrust,
            ban,
            unban,
            trustedKeys,
            bannedPubkeys,
        }}>
            {children}
        </TrustedPeersContext.Provider>
    );
}

export function useTrustedPeers() {
    const context = useContext(TrustedPeersContext);
    if (!context) {
        throw new Error('useTrustedPeers must be used within a TrustedPeersProvider');
    }
    return context;
}
