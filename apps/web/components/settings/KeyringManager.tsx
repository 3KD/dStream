"use client";

import { useState } from "react";
import { Plus, Trash, Shield, ShieldCheck, Key } from "lucide-react";
import { useTrustedPeers } from "@/context/TrustedPeersContext";

export function KeyringManager() {
    const { trustedKeys, addKey, removeKey } = useTrustedPeers();
    const [newKey, setNewKey] = useState("");

    const handleAdd = () => {
        if (newKey.trim()) {
            addKey(newKey.trim());
            setNewKey("");
        }
    };

    return (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-green-500" />
                Trusted Keyring
            </h2>
            <p className="text-neutral-400 text-sm mb-6">
                Add public keys of broadcasters you trust. When "Trusted Only" mode is verified, you will only see streams from these keys.
            </p>

            {/* Add Key Input */}
            <div className="flex gap-2 mb-6">
                <div className="relative flex-1">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                    <input
                        type="text"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        placeholder="Paste Ed25519 Public Key..."
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-green-500 transition-colors"
                        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    />
                </div>
                <button
                    onClick={handleAdd}
                    disabled={!newKey.trim()}
                    className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Add
                </button>
            </div>

            {/* Key List */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
                {trustedKeys.length === 0 ? (
                    <div className="text-center py-8 bg-neutral-950/50 rounded-lg border border-neutral-800/50 dashed">
                        <span className="text-neutral-500 text-sm">Your keyring is empty.</span>
                    </div>
                ) : (
                    trustedKeys.map((key) => (
                        <div key={key} className="flex items-center justify-between bg-neutral-950 p-3 rounded-lg border border-neutral-800 group hover:border-neutral-700 transition-colors">
                            <code className="text-xs text-green-400 font-mono break-all">{key}</code>
                            <button
                                onClick={() => removeKey(key)}
                                className="text-neutral-500 hover:text-red-500 p-2 rounded-lg hover:bg-neutral-900 transition-colors opacity-0 group-hover:opacity-100"
                                title="Remove from Trusted"
                            >
                                <Trash className="w-4 h-4" />
                            </button>
                        </div>
                    ))
                )}
            </div>

            <div className="mt-4 text-xs text-neutral-600 flex justify-between">
                <span>Total Trusted: {trustedKeys.length}</span>
                <span>Storage: Local Device</span>
            </div>
        </div>
    );
}
