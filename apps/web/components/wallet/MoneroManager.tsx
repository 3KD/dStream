"use client";

import { useState, useEffect } from "react";
import { Wallet, ExternalLink, Copy, Eye, EyeOff, ShieldCheck, ArrowRight, Settings, Save } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { saveIdentity } from "@/lib/identity";

export function MoneroManager() {
    const { identity } = useIdentity();
    const [showAddress, setShowAddress] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editAddress, setEditAddress] = useState("");

    // In a real app, we'd fetch the user's Monero address from their profile or local storage
    // For now we use a demo address or one stored in identity 
    // (Assuming identity might have moneroAddress, logic to be refined)
    const demoAddress = "888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H";
    const xmrAddress = identity?.moneroAddress || demoAddress;

    useEffect(() => {
        if (identity?.moneroAddress) {
            setEditAddress(identity.moneroAddress);
        }
    }, [identity]);

    const saveAddress = () => {
        if (!identity) return;
        const updated = { ...identity, moneroAddress: editAddress.trim() || undefined };
        saveIdentity(updated);
        // Force refresh identity context if needed, but saveIdentity updates storage.
        // IdentityContext listens to storage? Maybe not directly.
        // But for now let's manually trigger a reload or rely on next refresh.
        // Ideally contextual updateIdentity should be used.
        // But saveIdentity handles persistence.
        setIsEditing(false);
        window.location.reload(); // Simple way to refresh context
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const moneroUri = `monero:${xmrAddress}`;

    return (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-900/50">
                <div className="flex items-center gap-2">
                    <span className="text-orange-500 font-bold text-lg">◈</span>
                    <h3 className="font-bold text-white">Monero Wallet</h3>
                </div>
                <div className="flex gap-2">
                    <span className="text-xs bg-green-900/30 text-green-400 px-2 py-1 rounded border border-green-900/50 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" />
                        Private
                    </span>
                </div>
            </div>

            <div className="p-6">

                {/* Connect Section */}
                <div className="mb-8">
                    <h4 className="text-sm text-neutral-400 font-medium mb-4 uppercase tracking-wider">Connect External Wallet</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <a
                            href={moneroUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-xl transition-all group"
                        >
                            <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                                🍰
                            </div>
                            <div>
                                <div className="font-bold text-white text-sm">Cake Wallet</div>
                                <div className="text-xs text-neutral-500">Mobile & Desktop</div>
                            </div>
                            <ExternalLink className="w-4 h-4 text-neutral-500 ml-auto group-hover:text-white" />
                        </a>

                        <a
                            href={moneroUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-xl transition-all group"
                        >
                            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                                📚
                            </div>
                            <div>
                                <div className="font-bold text-white text-sm">Stack Wallet</div>
                                <div className="text-xs text-neutral-500">Privacy Focused</div>
                            </div>
                            <ExternalLink className="w-4 h-4 text-neutral-500 ml-auto group-hover:text-white" />
                        </a>

                        <a
                            href={moneroUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-xl transition-all group"
                        >
                            <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                                🪶
                            </div>
                            <div>
                                <div className="font-bold text-white text-sm">Feather Wallet</div>
                                <div className="text-xs text-neutral-500">Desktop Power User</div>
                            </div>
                            <ExternalLink className="w-4 h-4 text-neutral-500 ml-auto group-hover:text-white" />
                        </a>
                    </div>
                </div>

                {/* My Address Section */}
                <div className="mb-6">
                    <h4 className="text-sm text-neutral-400 font-medium mb-4 uppercase tracking-wider flex items-center justify-between">
                        <span>Your Receiving Address</span>
                        <div className="flex gap-2">
                            {isEditing ? (
                                <button
                                    onClick={saveAddress}
                                    className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 font-bold"
                                >
                                    <Save className="w-3 h-3" />
                                    Save
                                </button>
                            ) : (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                >
                                    <Settings className="w-3 h-3" />
                                    Edit
                                </button>
                            )}
                            <button
                                onClick={() => setShowAddress(!showAddress)}
                                className="text-neutral-500 hover:text-white text-xs flex items-center gap-1"
                            >
                                {showAddress ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                {showAddress ? "Hide" : "Show"}
                            </button>
                        </div>
                    </h4>

                    {isEditing ? (
                        <div className="mb-2">
                            <input
                                type="text"
                                value={editAddress}
                                onChange={(e) => setEditAddress(e.target.value)}
                                className="w-full bg-neutral-950 border border-neutral-700 rounded-xl p-4 font-mono text-xs text-white focus:border-orange-500 focus:outline-none"
                                placeholder="Paste your Monero address (starts with 4 or 8)..."
                            />
                            <p className="text-xs text-neutral-500 mt-2">
                                We recommend using a subaddress (starts with 8) for better privacy.
                            </p>
                        </div>
                    ) : (
                        <div className="relative group">
                            <div className={`
                                bg-neutral-950 border border-neutral-800 rounded-xl p-4 font-mono text-xs break-all
                                ${showAddress ? 'text-neutral-300' : 'text-neutral-700 blur-[2px] hover:blur-none transition-all cursor-pointer'}
                            `}
                                onClick={() => setShowAddress(true)}
                            >
                                {xmrAddress}
                            </div>
                            <button
                                onClick={() => copyToClipboard(xmrAddress)}
                                className="absolute top-2 right-2 p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Copy className="w-4 h-4 text-orange-500" />
                            </button>
                        </div>
                    )}
                    {!isEditing && (
                        <p className="text-xs text-neutral-500 mt-2">
                            Share this address to receive tips. Use the buttons above to open in your wallet to confirm payments.
                        </p>
                    )}
                </div>
            </div>

            <div className="bg-neutral-800/30 p-4 border-t border-neutral-800 flex justify-between items-center text-xs text-neutral-500">
                <span>View-Key Scanning coming soon</span>
                <button className="flex items-center gap-1 hover:text-white transition-colors">
                    <Settings className="w-3 h-3" />
                    Advanced Settings
                </button>
            </div>
        </div>
    );
}
