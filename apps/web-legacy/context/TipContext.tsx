"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { verifyPayment, generatePaymentId as generateMoneroPaymentId, configureMonero, type MoneroConfig } from '@/lib/monero';

interface TipInvoice {
    paymentId: string;
    amount: number;
    timestamp: number;
    status: 'pending' | 'verifying' | 'verified' | 'failed';
    txId?: string;
    confirmations?: number;
    error?: string;
}

interface TipContextType {
    generatePaymentId: () => string;
    verifyTip: (paymentId: string, address: string, amount: number) => Promise<boolean>;
    invoices: TipInvoice[];
    configureVerification: (config: Partial<MoneroConfig>) => void;
}

const TipContext = createContext<TipContextType | undefined>(undefined);

export function TipProvider({ children }: { children: ReactNode }) {
    const [invoices, setInvoices] = useState<TipInvoice[]>([]);

    const generatePaymentId = (): string => {
        return generateMoneroPaymentId();
    };

    const configureVerification = (config: Partial<MoneroConfig>) => {
        configureMonero(config);
    };

    const verifyTip = async (paymentId: string, address: string, amount: number): Promise<boolean> => {
        // Add pending invoice
        const invoice: TipInvoice = {
            paymentId,
            amount,
            timestamp: Date.now(),
            status: 'verifying',
        };
        setInvoices(prev => [...prev, invoice]);

        // Real blockchain verification
        const result = await verifyPayment(address, paymentId, amount);

        // Update invoice with result
        setInvoices(prev => prev.map(inv =>
            inv.paymentId === paymentId
                ? {
                    ...inv,
                    status: result.verified ? 'verified' : 'failed',
                    txId: result.txHash,
                    confirmations: result.confirmations,
                    error: result.error,
                }
                : inv
        ));

        return result.verified;
    };

    return (
        <TipContext.Provider value={{
            generatePaymentId,
            verifyTip,
            invoices,
            configureVerification
        }}>
            {children}
        </TipContext.Provider>
    );
}

export function useTip() {
    const context = useContext(TipContext);
    if (context === undefined) {
        throw new Error('useTip must be used within a TipProvider');
    }
    return context;
}
