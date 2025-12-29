"use client";
import { useEscrow } from "@/context/EscrowContext";
import { ShieldAlert, Coins, Lock, AlertTriangle, Copy, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { generatePaymentId, verifyPayment } from "@/lib/monero";

export function StakingModal({ onClose, requiredAmount = 0.01, broadcasterAddress }: { onClose?: () => void, requiredAmount?: number, broadcasterAddress: string | null }) {
    const { deposit, isStaked, isSlashed, slash, reset } = useEscrow();
    const [loading, setLoading] = useState(false);
    const [paymentId, setPaymentId] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setPaymentId(generatePaymentId());
    }, []);

    const handleVerify = async () => {
        if (!broadcasterAddress) return;
        setVerifying(true);
        setError(null);

        try {
            const result = await verifyPayment(broadcasterAddress, paymentId, requiredAmount);
            if (result.verified) {
                deposit(requiredAmount);
                if (onClose) onClose();
            } else {
                setError(result.error || "Payment not found yet. Please wait a moment.");
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setVerifying(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    if (isSlashed) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
                <div className="bg-neutral-900 border border-red-500/50 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl shadow-red-900/20">
                    <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                    </div>
                    <h2 className="text-2xl font-bold text-red-500 mb-2">Stake Slashed!</h2>
                    <p className="text-neutral-400 mb-6">
                        You were flagged as a leech by the swarm. Your {requiredAmount} XMR stake has been forfeited.
                    </p>
                    <button onClick={reset} className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all">
                        Acknowledge & Re-Deposit
                    </button>
                </div>
            </div>
        );
    }

    if (isStaked) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-300">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 max-w-md w-full shadow-2xl">
                <div className="w-16 h-16 bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Lock className="w-8 h-8 text-blue-500" />
                </div>

                <h2 className="text-2xl font-bold text-center mb-2">Escrow Required</h2>
                {!broadcasterAddress ? (
                    <div className="text-center text-red-400 text-sm mb-6">
                        Broadcaster has not configured a receive address. Cannot stake.
                    </div>
                ) : (
                    <>
                        <p className="text-neutral-400 text-center mb-6 text-sm">
                            Send exactly <strong>{requiredAmount} XMR</strong> to the address below.
                        </p>

                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="text-xs text-neutral-500 block mb-1">Address</label>
                                <div className="bg-neutral-950 p-3 rounded flex gap-2 items-center border border-neutral-800">
                                    <div className="text-xs font-mono truncate flex-1 text-neutral-300">{broadcasterAddress}</div>
                                    <button onClick={() => copyToClipboard(broadcasterAddress)} className="text-neutral-500 hover:text-white"><Copy className="w-4 h-4" /></button>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-neutral-500 block mb-1">Payment ID</label>
                                <div className="bg-neutral-950 p-3 rounded flex gap-2 items-center border border-neutral-800">
                                    <div className="text-xs font-mono truncate flex-1 text-yellow-500">{paymentId}</div>
                                    <button onClick={() => copyToClipboard(paymentId)} className="text-neutral-500 hover:text-white"><Copy className="w-4 h-4" /></button>
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="text-red-400 text-xs text-center mb-4 bg-red-900/10 p-2 rounded border border-red-900/30">
                                {error}
                            </div>
                        )}

                        <button
                            onClick={handleVerify}
                            disabled={verifying}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all"
                        >
                            {verifying ? (
                                <><RefreshCw className="w-5 h-5 animate-spin" /> Verifying...</>
                            ) : (
                                <><Coins className="w-5 h-5" /> I Sent It</>
                            )}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
