"use client";

import { useState, useEffect } from "react";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { verifyNip05 } from "@/lib/nip05";

interface Nip05BadgeProps {
    pubkey: string;
    nip05?: string;
    showAddress?: boolean;
    className?: string;
}

export function Nip05Badge({ pubkey, nip05, showAddress = false, className = "" }: Nip05BadgeProps) {
    const [isValid, setIsValid] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!nip05 || !pubkey) {
            setIsValid(false);
            return;
        }

        const check = async () => {
            setLoading(true);
            try {
                const result = await verifyNip05(nip05, pubkey);
                setIsValid(result.valid);
            } catch (e) {
                setIsValid(false);
            } finally {
                setLoading(false);
            }
        };

        check();
    }, [pubkey, nip05]);

    if (!nip05) return null;

    return (
        <div className={`flex items-center gap-1.5 ${className}`}>
            {loading ? (
                <Loader2 className="w-3 h-3 animate-spin text-neutral-500" />
            ) : isValid ? (
                <div className="flex items-center gap-1 group relative">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                    {showAddress && (
                        <span className="text-xs text-blue-400/80 font-medium">
                            {nip05}
                        </span>
                    )}
                    {/* Tooltip */}
                    {!showAddress && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-[10px] text-white opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap z-50">
                            Verified via {nip05}
                        </div>
                    )}
                </div>
            ) : isValid === false ? (
                <div className="flex items-center gap-1 group relative">
                    <ShieldAlert className="w-3.5 h-3.5 text-neutral-600" />
                    {showAddress && (
                        <span className="text-xs text-neutral-500 line-through decoration-red-500/50">
                            {nip05}
                        </span>
                    )}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap z-50">
                        Verification failed for {nip05}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
