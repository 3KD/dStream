"use client";
import { createContext, useContext, useState, ReactNode } from 'react';

interface TipContextValue {
    /** Currently configured XMR address */
    xmrAddress: string | null;
    /** Set XMR address */
    setXmrAddress: (address: string | null) => void;
    /** Last tip received (for alerts) */
    lastTip: { amount: number; from: string; message?: string } | null;
    /** Show tip alert */
    showTipAlert: (amount: number, from: string, message?: string) => void;
    /** Clear tip alert */
    clearTipAlert: () => void;
}

const TipContext = createContext<TipContextValue | null>(null);

const STORAGE_KEY = 'dstream_xmr_address';

export function TipProvider({ children }: { children: ReactNode }) {
    const [xmrAddress, setXmrAddressState] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem(STORAGE_KEY);
    });
    const [lastTip, setLastTip] = useState<TipContextValue['lastTip']>(null);

    const setXmrAddress = (address: string | null) => {
        setXmrAddressState(address);
        if (address) {
            localStorage.setItem(STORAGE_KEY, address);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    };

    const showTipAlert = (amount: number, from: string, message?: string) => {
        setLastTip({ amount, from, message });
        // Auto-clear after 10 seconds
        setTimeout(() => setLastTip(null), 10000);
    };

    const clearTipAlert = () => setLastTip(null);

    return (
        <TipContext.Provider value={{
            xmrAddress,
            setXmrAddress,
            lastTip,
            showTipAlert,
            clearTipAlert,
        }}>
            {children}
        </TipContext.Provider>
    );
}

export function useTip() {
    const context = useContext(TipContext);
    if (!context) {
        throw new Error('useTip must be used within a TipProvider');
    }
    return context;
}
