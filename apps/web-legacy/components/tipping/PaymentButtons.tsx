"use client";

import { DollarSign, ExternalLink, Copy } from "lucide-react";
import { Stream } from "@/hooks/useNostrStreams";
import { useState } from "react";

interface PaymentButtonsProps {
    stream: Stream;
}

export function PaymentButtons({ stream }: PaymentButtonsProps) {
    const { venmo, cashapp, paypal, customPayments } = stream.metadata;
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

    // If no payment methods configured, don't render anything
    if (!venmo && !cashapp && !paypal && (!customPayments || customPayments.length === 0)) {
        return null;
    }

    const handleVenmo = () => {
        // Remove @ if present, Venmo deep links use just the username
        const username = venmo?.startsWith('@') ? venmo.slice(1) : venmo;
        window.open(`https://venmo.com/${username}`, '_blank');
    };

    const handleCashApp = () => {
        // CashApp uses $cashtag format, but URL doesn't need the $
        const tag = cashapp?.startsWith('$') ? cashapp.slice(1) : cashapp;
        window.open(`https://cash.app/$${tag}`, '_blank');
    };

    const handlePayPal = () => {
        // PayPal.me links - if user just put username, prepend paypal.me
        let link = paypal || '';
        if (!link.includes('paypal.me') && !link.startsWith('http')) {
            link = `https://paypal.me/${link}`;
        } else if (!link.startsWith('http')) {
            link = `https://${link}`;
        }
        window.open(link, '_blank');
    };

    const handleCustom = (value: string, idx: number) => {
        // If it looks like a URL, open it
        if (value.startsWith('http://') || value.startsWith('https://')) {
            window.open(value, '_blank');
        } else {
            // Otherwise copy to clipboard
            navigator.clipboard.writeText(value);
            setCopiedIdx(idx);
            setTimeout(() => setCopiedIdx(null), 2000);
        }
    };

    return (
        <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-neutral-500 mr-1">
                <DollarSign className="w-3 h-3 inline -mt-0.5" /> Tip:
            </span>

            {venmo && (
                <button
                    onClick={handleVenmo}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#008CFF] hover:bg-[#0070cc] text-white text-xs font-medium rounded-full transition-colors"
                >
                    Venmo
                    <ExternalLink className="w-3 h-3" />
                </button>
            )}

            {cashapp && (
                <button
                    onClick={handleCashApp}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00D632] hover:bg-[#00b329] text-white text-xs font-medium rounded-full transition-colors"
                >
                    CashApp
                    <ExternalLink className="w-3 h-3" />
                </button>
            )}

            {paypal && (
                <button
                    onClick={handlePayPal}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#003087] hover:bg-[#00266d] text-white text-xs font-medium rounded-full transition-colors"
                >
                    PayPal
                    <ExternalLink className="w-3 h-3" />
                </button>
            )}

            {customPayments?.map((service, idx) => (
                <button
                    key={idx}
                    onClick={() => handleCustom(service.value, idx)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-full transition-colors"
                    title={service.value}
                >
                    {service.name}
                    {service.value.startsWith('http') ? (
                        <ExternalLink className="w-3 h-3" />
                    ) : copiedIdx === idx ? (
                        <span className="text-[10px]">✓</span>
                    ) : (
                        <Copy className="w-3 h-3" />
                    )}
                </button>
            ))}
        </div>
    );
}
