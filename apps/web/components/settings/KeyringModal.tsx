"use client";

import { useState, useEffect } from "react";
import { X, Shield } from "lucide-react";
import { KeyringManager } from "./KeyringManager";

interface KeyringModalProps {
    onClose: () => void;
}

export function KeyringModal({ onClose }: KeyringModalProps) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl relative"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="sticky top-0 bg-neutral-900 border-b border-neutral-800 p-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-900/30 rounded-lg">
                            <Shield className="w-5 h-5 text-green-500" />
                        </div>
                        <h2 className="text-xl font-bold">Settings & Keyring</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-full text-neutral-400 hover:text-white transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    <KeyringManager />
                </div>
            </div>
        </div>
    );
}
