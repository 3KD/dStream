"use client";

import { useState, useEffect } from "react";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { X, Loader2, CheckCircle, AlertCircle } from "lucide-react";

interface TipModalProps {
    isOpen: boolean;
    onClose: () => void;
    broadcasterAddress: `0x${string}`;
}

export function TipModal({ isOpen, onClose, broadcasterAddress }: TipModalProps) {
    const [amount, setAmount] = useState("0.001");
    const { data: hash, sendTransaction, isPending, error } = useSendTransaction();
    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
        hash
    });

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

    const handleSend = () => {
        sendTransaction({
            to: broadcasterAddress,
            value: parseEther(amount),
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 w-full max-w-sm relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-neutral-400 hover:text-white"
                >
                    <X className="w-5 h-5" />
                </button>

                <h3 className="text-xl font-bold text-white mb-4">Send a Tip</h3>

                {isSuccess ? (
                    <div className="flex flex-col items-center gap-4 py-4">
                        <CheckCircle className="w-12 h-12 text-green-500" />
                        <p className="text-green-400 font-medium">Tip Sent Successfully!</p>
                        <button onClick={onClose} className="text-sm text-neutral-400 underline">Close</button>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col gap-4 mb-6">
                            <div>
                                <label className="block text-xs text-neutral-400 mb-1">Amount (ETH)</label>
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary"
                                    placeholder="0.001"
                                />
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 p-2 rounded">
                                    <AlertCircle className="w-4 h-4" />
                                    <span>{error.message.substring(0, 60)}...</span>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleSend}
                            disabled={isPending || isConfirming}
                            className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-lg flex items-center justify-center gap-2"
                        >
                            {isPending || isConfirming ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            {isPending ? "Confirm in Wallet..." : isConfirming ? "Processing..." : "Send Tip"}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
