"use client";

import { X, Copy, Check, ExternalLink, Heart, DollarSign } from "lucide-react";
import { useState, useEffect } from "react";
import { MoneroLogo } from "@/components/icons/MoneroLogo";

interface PlatformDonationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const PLATFORM_PAYMENTS = [
    {
        name: "Monero (Private)",
        value: "43W1vK7qE3pC6rG8P...", // Placeholder address
        type: "address",
        icon: <MoneroLogo className="w-5 h-5" />,
        color: "bg-orange-600 hover:bg-orange-700"
    },
    {
        name: "Venmo",
        value: "@dstreamprotocol",
        type: "link",
        url: "https://venmo.com/dstreamprotocol",
        color: "bg-[#008CFF] hover:bg-[#0070cc]"
    },
    {
        name: "CashApp",
        value: "$dstreamprotocol",
        type: "link",
        url: "https://cash.app/$dstreamprotocol",
        color: "bg-[#00D632] hover:bg-[#00b329]"
    },
    {
        name: "PayPal",
        value: "paypal.me/dstreamprotocol",
        type: "link",
        url: "https://paypal.me/dstreamprotocol",
        color: "bg-[#003087] hover:bg-[#00266d]"
    }
];

export function PlatformDonationModal({ isOpen, onClose }: PlatformDonationModalProps) {
    const [copiedValue, setCopiedValue] = useState<string | null>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleCopy = (value: string) => {
        navigator.clipboard.writeText(value);
        setCopiedValue(value);
        setTimeout(() => setCopiedValue(null), 2000);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-red-500/10 rounded-lg">
                                <Heart className="w-5 h-5 text-red-500 fill-red-500" />
                            </div>
                            <h2 className="text-xl font-bold text-white">Support dStream</h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-neutral-500 hover:text-white transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <p className="text-sm text-neutral-400 mb-6 leading-relaxed">
                        dStream is built by a small team dedicated to open, uncensored broadcasting.
                        Your support keeps the platform decentralized and free for everyone.
                    </p>

                    <div className="space-y-3">
                        {PLATFORM_PAYMENTS.map((payment) => (
                            <div key={payment.name} className="group">
                                {payment.type === "link" ? (
                                    <a
                                        href={payment.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`w-full flex items-center justify-between p-3.5 ${payment.color} text-white rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98] font-medium text-sm`}
                                    >
                                        <span>{payment.name}</span>
                                        <ExternalLink className="w-4 h-4 opacity-70" />
                                    </a>
                                ) : (
                                    <button
                                        onClick={() => handleCopy(payment.value)}
                                        className={`w-full flex items-center justify-between p-3.5 bg-neutral-800 hover:bg-neutral-700 text-white border border-neutral-700 rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98] font-medium text-sm`}
                                    >
                                        <div className="flex items-center gap-2">
                                            {payment.icon}
                                            <span>{payment.name}</span>
                                        </div>
                                        {copiedValue === payment.value ? (
                                            <Check className="w-4 h-4 text-green-500" />
                                        ) : (
                                            <Copy className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" />
                                        )}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="mt-8 pt-6 border-t border-neutral-800 text-center">
                        <p className="text-[10px] uppercase tracking-widest text-neutral-600 font-bold">
                            Decentralized · Peer-to-Peer · Ownerless
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
