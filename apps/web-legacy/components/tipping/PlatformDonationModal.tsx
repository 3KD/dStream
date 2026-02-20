"use client";

import { X, Copy, Check, ExternalLink, Heart, ArrowUpRight } from "lucide-react";
import { useState, useEffect } from "react";
import { SUPPORT_METHODS } from "@/lib/supportMethods";

interface PlatformDonationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

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

    const handleCopy = (e: React.MouseEvent, value: string) => {
        e.preventDefault(); // Prevent link opening when clicking copy button
        e.stopPropagation();
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
                        {SUPPORT_METHODS.map((method) => {
                            const Icon = method.icon;
                            return (
                                <div key={method.id} className="group relative">
                                    <a
                                        href={method.uriScheme(method.value)}
                                        target={method.type === 'link' ? "_blank" : undefined}
                                        rel={method.type === 'link' ? "noopener noreferrer" : undefined}
                                        className={`w-full flex items-center justify-between p-3.5 ${method.color} text-white rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98] font-medium text-sm pr-12`}
                                    >
                                        <div className="flex items-center gap-2">
                                            {Icon && <Icon className="w-5 h-5" />}
                                            <span>{method.name}</span>
                                        </div>

                                        {/* Action Icon indicating "Open App" or "External Link" */}
                                        <div className="flex items-center opacity-70">
                                            {method.type === 'crypto' ? (
                                                <ArrowUpRight className="w-4 h-4" />
                                            ) : (
                                                <ExternalLink className="w-4 h-4" />
                                            )}
                                        </div>
                                    </a>

                                    {/* Copy Button (Separate from the main click action) */}
                                    <button
                                        onClick={(e) => handleCopy(e, method.value)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-black/20 rounded-xl transition-colors text-white/80 hover:text-white"
                                        title="Copy address"
                                    >
                                        {copiedValue === method.value ? (
                                            <Check className="w-4 h-4" />
                                        ) : (
                                            <Copy className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            );
                        })}
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
