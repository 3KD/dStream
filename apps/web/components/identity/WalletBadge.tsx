"use client";

import { Wallet } from "lucide-react";

/**
 * WalletBadge - Temporarily disabled while wagmi dependencies are resolved.
 * Returns a placeholder button that notifies user Web3 is disabled.
 */
export function WalletBadge() {
    const handleClick = () => {
        alert("Web3 wallet connection is temporarily disabled. Use Monero tipping for now.");
    };

    return (
        <button
            onClick={handleClick}
            className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800/50 border border-neutral-600 rounded-full text-sm hover:bg-neutral-700/70 transition opacity-60"
            title="Web3 temporarily disabled"
        >
            <Wallet className="w-4 h-4 text-neutral-400" />
            <span className="text-neutral-400">Wallet</span>
        </button>
    );
}
