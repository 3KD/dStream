"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface FavoritesContextType {
    favorites: string[]; // List of pubkeys
    isFavorite: (pubkey: string) => boolean;
    toggleFavorite: (pubkey: string) => void;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
    const [favorites, setFavorites] = useState<string[]>([]);
    const [loaded, setLoaded] = useState(false);

    // Load from LocalStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem("dstream_favorites");
        if (stored) {
            try {
                setFavorites(JSON.parse(stored));
            } catch (e) {
                console.warn("Failed to parse favorites", e);
            }
        }
        setLoaded(true);
    }, []);

    // Persist to LocalStorage on change
    useEffect(() => {
        if (loaded) {
            localStorage.setItem("dstream_favorites", JSON.stringify(favorites));
        }
    }, [favorites, loaded]);

    const isFavorite = (pubkey: string) => favorites.includes(pubkey);

    const toggleFavorite = (pubkey: string) => {
        setFavorites(prev => {
            if (prev.includes(pubkey)) {
                return prev.filter(p => p !== pubkey);
            } else {
                return [...prev, pubkey];
            }
        });
    };

    return (
        <FavoritesContext.Provider value={{ favorites, isFavorite, toggleFavorite }}>
            {children}
        </FavoritesContext.Provider>
    );
}

export function useFavorites() {
    const context = useContext(FavoritesContext);
    if (context === undefined) {
        throw new Error("useFavorites must be used within a FavoritesProvider");
    }
    return context;
}
