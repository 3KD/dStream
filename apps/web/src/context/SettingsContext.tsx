"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface Settings {
    theme: 'dark' | 'light';
    defaultQuality: 'auto' | '1080p' | '720p' | '480p';
    lowLatency: boolean;
    autoPlay: boolean;
    showP2PStats: boolean;
    moneroRpcUrl: string;
    moneroTipPresets: number[];
}

interface SettingsContextValue {
    settings: Settings;
    updateSettings: (changes: Partial<Settings>) => void;
    resetSettings: () => void;
}

const defaultSettings: Settings = {
    theme: 'dark',
    defaultQuality: 'auto',
    lowLatency: true,
    autoPlay: true,
    showP2PStats: true,
    moneroRpcUrl: 'http://localhost:18081',
    moneroTipPresets: [0.01, 0.05, 0.1, 0.5],
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const STORAGE_KEY = 'dstream_settings';

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<Settings>(defaultSettings);

    // Load from localStorage
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                setSettings({ ...defaultSettings, ...JSON.parse(stored) });
            } catch (e) {
                console.error('[Settings] Failed to parse:', e);
            }
        }
    }, []);

    const updateSettings = (changes: Partial<Settings>) => {
        const next = { ...settings, ...changes };
        setSettings(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    };

    const resetSettings = () => {
        setSettings(defaultSettings);
        localStorage.removeItem(STORAGE_KEY);
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
}
