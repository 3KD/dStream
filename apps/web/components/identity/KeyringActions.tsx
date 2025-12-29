"use client";

import { useSearchParams } from "next/navigation";
import { Shield, ShieldCheck } from "lucide-react";
import { useTrustedPeers } from "@/context/TrustedPeersContext";

export function KeyringActions() {
    const searchParams = useSearchParams();
    const pubkey = searchParams.get("pubkey");
    const { isTrusted, addKey, removeKey } = useTrustedPeers();

    if (!pubkey) return null;

    const trusted = isTrusted(pubkey);

    return (
        <button
            onClick={() => trusted ? removeKey(pubkey) : addKey(pubkey)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${trusted
                    ? "bg-green-900/30 text-green-400 border border-green-800 hover:bg-green-900/50"
                    : "bg-neutral-800 text-neutral-400 border border-neutral-700 hover:bg-neutral-700 hover:text-white"
                }`}
        >
            {trusted ? <ShieldCheck className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
            {trusted ? "Trusted" : "Trust"}
        </button>
    );
}
