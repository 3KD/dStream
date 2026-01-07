"use client";

import { Wallet, Copy, Check, ExternalLink, Coins } from "lucide-react";
import { useState, useEffect } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { useTip } from "@/context/TipContext";
// Web3 temporarily disabled
// import { useAppKitAccount, useAppKit } from "@reown/appkit/react";
// import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
// import { parseEther } from "viem";

// Broadcaster would set their Monero address in their profile
const DEMO_XMR_ADDRESS = "888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H";
// Demo ETH address for testing - would be the broadcaster's EVM address
const DEMO_ETH_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth for demo

interface TipButtonProps {
    broadcasterXmrAddress?: string;
    broadcasterEthAddress?: string;
}

export function TipButton({ broadcasterXmrAddress, broadcasterEthAddress }: TipButtonProps) {
    const { identity } = useIdentity();
    const { generatePaymentId, verifyTip } = useTip();

    // Web3 temporarily disabled
    const address = null;
    const isConnected = false;
    const openWalletModal = () => alert("Web3 wallet connection is temporarily disabled. Use Monero tipping.");
    const hash = undefined;
    const sendTransaction = () => { };
    const isPending = false;
    const sendError = null;
    const isConfirming = false;
    const isConfirmed = false;

    const [showModal, setShowModal] = useState(false);
    const [tipMode, setTipMode] = useState<"monero" | "web3">("monero");
    const [amount, setAmount] = useState("0.01");
    const [paymentId, setPaymentId] = useState("");
    const [txId, setTxId] = useState("");
    const [status, setStatus] = useState<"idle" | "confirming" | "success">("idle");

    const xmrAddress = broadcasterXmrAddress || DEMO_XMR_ADDRESS;
    const ethAddress = broadcasterEthAddress || DEMO_ETH_ADDRESS;

    useEffect(() => {
        if (showModal && tipMode === "monero") {
            setPaymentId(generatePaymentId());
        }
    }, [showModal, tipMode, generatePaymentId]);

    // Handle Web3 tx confirmation
    useEffect(() => {
        if (isConfirmed && hash) {
            setStatus("success");
            console.log("TIP_RECEIPT:", {
                type: "TIP_RECEIPT",
                chain_namespace: "eip155",
                asset: "ETH",
                amount,
                tx_ref: hash,
                broadcaster: ethAddress,
                tipper: address,
                timestamp: Date.now()
            });
            setTimeout(() => {
                setShowModal(false);
                setStatus("idle");
            }, 3000);
        }
    }, [isConfirmed, hash, amount, ethAddress, address]);

    // Generate Monero URI with Payment ID
    // tx_amount is deprecated/specific, 'amount' is standard (XMR)
    const moneroUri = `monero:${xmrAddress}?amount=${amount}&tx_payment_id=${paymentId}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(moneroUri)}`;

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    // Auto-verify: Poll for payment using Payment ID
    const handleAutoVerify = async () => {
        setStatus("confirming");
        // Poll every 5 seconds for up to 5 minutes
        const maxAttempts = 60;
        let attempts = 0;

        const poll = async () => {
            attempts++;
            console.log(`[Tip] Checking for payment ${paymentId} (attempt ${attempts}/${maxAttempts})`);

            const verified = await verifyTip(paymentId, xmrAddress, parseFloat(amount));
            if (verified) {
                setStatus("success");
                console.log("TIP_RECEIPT:", {
                    type: "TIP_RECEIPT",
                    chain_namespace: "monero",
                    paymentId,
                    amount,
                    timestamp: Date.now()
                });
                setTimeout(() => {
                    setShowModal(false);
                    setStatus("idle");
                    setPaymentId("");
                }, 3000);
                return true;
            }

            if (attempts < maxAttempts) {
                setTimeout(poll, 5000); // Check every 5 seconds
            } else {
                setStatus("idle");
                alert("Payment not detected yet. Make sure you included the Payment ID in your transaction and it has at least 1 confirmation.");
            }
            return false;
        };

        poll();
    };

    // Stop polling when modal closes
    const handleCloseModal = () => {
        setShowModal(false);
        setStatus("idle");
        setPaymentId("");
    };

    const handleSendEth = () => {
        if (!isConnected) {
            openWalletModal();
            return;
        }
        // Web3 temporarily disabled
        alert("ETH tipping is temporarily disabled. Use Monero.");
    };

    return (
        <>
            <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white px-4 py-2 rounded-full font-medium transition-all hover:scale-105"
            >
                <Wallet className="w-4 h-4" />
                Tip
            </button>

            {showModal && (
                <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
                    <div className="bg-neutral-900 rounded-2xl p-6 w-full max-w-md border border-neutral-700" onClick={e => e.stopPropagation()}>

                        {/* Mode Switcher */}
                        <div className="flex gap-2 mb-6">
                            <button
                                onClick={() => setTipMode("monero")}
                                className={`flex-1 py-2 rounded-lg font-medium transition flex items-center justify-center gap-2 ${tipMode === "monero" ? "bg-orange-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                                    }`}
                            >
                                <span className="text-lg">◈</span> Monero (Private)
                            </button>
                            <button
                                onClick={() => setTipMode("web3")}
                                className={`flex-1 py-2 rounded-lg font-medium transition flex items-center justify-center gap-2 ${tipMode === "web3" ? "bg-blue-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                                    }`}
                            >
                                <Coins className="w-4 h-4" /> Web3 (ETH)
                            </button>
                        </div>

                        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
                            {tipMode === "monero" ? (
                                <><span className="text-orange-500">◈</span> Tip with Monero</>
                            ) : (
                                <><Coins className="w-6 h-6 text-blue-500" /> Tip with ETH</>
                            )}
                        </h2>

                        {status === "success" ? (
                            <div className="text-center py-8">
                                <div className="text-6xl mb-4">✓</div>
                                <h3 className="text-xl font-bold text-green-400">Tip Confirmed!</h3>
                                <p className="text-neutral-400 mt-2">Thank you for supporting the broadcaster</p>
                            </div>
                        ) : tipMode === "monero" ? (
                            /* Monero Flow */
                            <>
                                <p className="text-neutral-400 text-sm mb-4">Send XMR directly to the broadcaster's wallet</p>

                                <div className="mb-4">
                                    <label className="block text-sm font-medium text-neutral-400 mb-2">Amount (XMR)</label>
                                    <div className="flex gap-2">
                                        {["0.01", "0.05", "0.1", "0.5"].map(preset => (
                                            <button
                                                key={preset}
                                                onClick={() => setAmount(preset)}
                                                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${amount === preset ? 'bg-orange-500 text-white' : 'bg-neutral-800 hover:bg-neutral-700'
                                                    }`}
                                            >
                                                {preset}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-3 mb-4 text-xs text-neutral-400">
                                    <strong>Privacy Guard:</strong> A unique Payment ID has been generated for this tip.
                                </div>

                                <div className="bg-white p-4 rounded-xl mb-4 flex justify-center">
                                    <img src={qrCodeUrl} alt="Monero Payment QR" className="w-40 h-40" />
                                </div>

                                {/* External Wallet Buttons */}
                                <div className="grid grid-cols-3 gap-2 mb-4">
                                    <a
                                        href={moneroUri}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex flex-col items-center justify-center p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs transition-colors group"
                                    >
                                        <span className="text-orange-500 font-bold mb-1 group-hover:scale-110 transition-transform">🍰</span>
                                        <span>Cake</span>
                                    </a>
                                    <a
                                        href={moneroUri}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex flex-col items-center justify-center p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs transition-colors group"
                                    >
                                        <span className="text-blue-400 font-bold mb-1 group-hover:scale-110 transition-transform">📚</span>
                                        <span>Stack</span>
                                    </a>
                                    <a
                                        href={moneroUri}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex flex-col items-center justify-center p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs transition-colors group"
                                    >
                                        <span className="text-purple-400 font-bold mb-1 group-hover:scale-110 transition-transform">🪶</span>
                                        <span>Feather</span>
                                    </a>
                                </div>

                                <div className="mb-4 space-y-2">
                                    <div>
                                        <label className="block text-xs font-medium text-neutral-500 mb-1">Monero Address</label>
                                        <code className="block bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-xs font-mono break-all text-neutral-300">
                                            {xmrAddress.substring(0, 16)}...{xmrAddress.substring(xmrAddress.length - 8)}
                                        </code>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-orange-500 mb-1">Payment ID (unique for this tip)</label>
                                        <div className="flex gap-2">
                                            <code
                                                className="flex-1 bg-neutral-950 border border-orange-900/50 rounded-lg px-3 py-2 text-xs font-mono text-orange-400 break-all overflow-hidden"
                                                title={paymentId}
                                            >
                                                {paymentId ? `${paymentId.substring(0, 16)}...${paymentId.substring(paymentId.length - 8)}` : "Generating..."}
                                            </code>
                                            <button onClick={() => copyToClipboard(paymentId)} className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg shrink-0" title="Copy full Payment ID">
                                                <Copy className="w-4 h-4 text-orange-500" />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Auto-verification section */}
                                <div className="mb-4 p-3 bg-neutral-900/50 border border-neutral-700 rounded-lg">
                                    <p className="text-xs text-neutral-400 mb-2">
                                        After sending payment, click below. We'll automatically detect your transaction using the Payment ID.
                                    </p>
                                    {status === "confirming" && (
                                        <div className="flex items-center gap-2 text-orange-400 text-sm">
                                            <span className="animate-spin">⏳</span>
                                            <span>Watching for payment... (checks every 5s)</span>
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={handleAutoVerify}
                                    disabled={status === "confirming"}
                                    className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold rounded-lg hover:from-orange-600 hover:to-orange-700 disabled:opacity-50 transition"
                                >
                                    {status === "confirming" ? "Watching for Payment..." : "I've Sent the Tip - Verify"}
                                </button>
                            </>
                        ) : (
                            /* Web3 Flow */
                            <>
                                <p className="text-neutral-400 text-sm mb-4">Send ETH directly to the broadcaster's wallet</p>

                                <div className="mb-4">
                                    <label className="block text-sm font-medium text-neutral-400 mb-2">Amount (ETH)</label>
                                    <div className="flex gap-2">
                                        {["0.001", "0.005", "0.01", "0.05"].map(preset => (
                                            <button
                                                key={preset}
                                                onClick={() => setAmount(preset)}
                                                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${amount === preset ? 'bg-blue-500 text-white' : 'bg-neutral-800 hover:bg-neutral-700'
                                                    }`}
                                            >
                                                {preset}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="mb-4 p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg">
                                    <div className="text-xs text-neutral-500 mb-1">Sending to:</div>
                                    <code className="text-sm font-mono text-blue-400 break-all">{ethAddress}</code>
                                </div>

                                {isConnected && address ? (
                                    <div className="mb-4 p-3 bg-green-900/30 border border-green-600 rounded-lg flex items-center gap-2">
                                        <Wallet className="w-4 h-4 text-green-400" />
                                        <span className="text-sm text-green-300 font-mono">
                                            {String(address).substring(0, 6)}...{String(address).substring(String(address).length - 4)}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-600 rounded-lg text-center text-sm text-yellow-300">
                                        Web3 wallet temporarily disabled. Use Monero tipping.
                                    </div>
                                )}

                                {sendError && (
                                    <div className="mb-4 p-3 bg-red-900/30 border border-red-600 rounded-lg text-xs text-red-300">
                                        {String(sendError).substring(0, 100)}...
                                    </div>
                                )}

                                <button
                                    onClick={handleSendEth}
                                    disabled={isPending || isConfirming}
                                    className="w-full py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 transition"
                                >
                                    {!isConnected ? "Connect Wallet & Send" : isPending ? "Confirming in Wallet..." : isConfirming ? "Waiting for Confirmation..." : `Send ${amount} ETH`}
                                </button>
                            </>
                        )}
                    </div>
                </div >
            )
            }
        </>
    );
}
