"use client";
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface KeyringContextValue {
    /** Get alias for a pubkey */
    getAlias: (pubkey: string) => string | null;
    /** Set alias for a pubkey */
    setAlias: (pubkey: string, alias: string) => void;
    /** Delete alias for a pubkey */
    deleteAlias: (pubkey: string) => void;
    /** All aliases */
    aliases: { [pubkey: string]: string };
}

const KeyringContext = createContext<KeyringContextValue | null>(null);

const STORAGE_KEY = 'dstream_keyring';

export function KeyringProvider({ children }: { children: ReactNode }) {
    const [aliases, setAliases] = useState<{ [pubkey: string]: string }>({});

    // Load from localStorage
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                setAliases(JSON.parse(stored));
            } catch (e) {
                console.error('[Keyring] Failed to parse:', e);
            }
        }
    }, []);

    // Persist to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(aliases));
    }, [aliases]);

    const getAlias = useCallback((pubkey: string): string | null => {
        return aliases[pubkey] || null;
    }, [aliases]);

    const setAlias = useCallback((pubkey: string, alias: string) => {
        setAliases(prev => ({ ...prev, [pubkey]: alias }));
    }, []);

    const deleteAlias = useCallback((pubkey: string) => {
        setAliases(prev => {
            const next = { ...prev };
            delete next[pubkey];
            return next;
        });
    }, []);

    return (
        <KeyringContext.Provider value={{ getAlias, setAlias, deleteAlias, aliases }}>
            {children}
        </KeyringContext.Provider>
    );
}

export function useKeyring() {
    const context = useContext(KeyringContext);
    if (!context) {
        throw new Error('useKeyring must be used within a KeyringProvider');
    }
    return context;
}
