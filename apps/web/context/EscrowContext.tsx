"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useTrustedPeers } from "./TrustedPeersContext";

interface EscrowContextType {
    isStaked: boolean;
    isSlashed: boolean;
    balance: number;
    deposit: (amount: number) => void;
    withdraw: () => void;
    slash: () => void;
    reset: () => void;
}

const EscrowContext = createContext<EscrowContextType | undefined>(undefined);

export function EscrowProvider({ children }: { children: React.ReactNode }) {
    const [isStaked, setIsStaked] = useState(false);
    const [isSlashed, setIsSlashed] = useState(false);
    const [balance, setBalance] = useState(0);

    const deposit = (amount: number) => {
        setBalance(amount);
        setIsStaked(true);
        setIsSlashed(false);
    };

    const withdraw = () => {
        if (!isSlashed) {
            setBalance(0);
            setIsStaked(false);
        }
    };

    const slash = () => {
        setIsSlashed(true);
        setBalance(0);
        setIsStaked(false);
    };

    const reset = () => {
        setIsSlashed(false);
        setIsStaked(false);
        setBalance(0);
    };

    return (
        <EscrowContext.Provider value={{ isStaked, isSlashed, balance, deposit, withdraw, slash, reset }}>
            {children}
        </EscrowContext.Provider>
    );
}

export function useEscrow() {
    const context = useContext(EscrowContext);
    if (context === undefined) {
        throw new Error("useEscrow must be used within an EscrowProvider");
    }
    return context;
}
