"use client";

import { useTrustedPeers } from "@/context/TrustedPeersContext";
import { useKeyring } from "@/context/KeyringContext";
import { ShieldAlert, Trash2, CheckCircle, Search, UserX, Download } from "lucide-react";
import { useState } from "react";
import { shortPubKey } from "@/lib/identity";

export function ModerationView() {
    const { bannedKeys, unbanKey, banKey, bulkBan } = useTrustedPeers();
    const { getAlias } = useKeyring();
    const [manualBanInput, setManualBanInput] = useState("");
    const [showImport, setShowImport] = useState(false);
    const [bulkInput, setBulkInput] = useState("");
    const [importing, setImporting] = useState(false);

    const handleManualBan = () => {
        if (!manualBanInput.trim()) return;
        // Basic validation for hex pubkey length (approx)
        if (manualBanInput.length < 60) {
            alert("Please enter a valid hex public key.");
            return;
        }
        banKey(manualBanInput.trim());
        setManualBanInput("");
    };

    const handleExport = () => {
        if (bannedKeys.length === 0) {
            alert("No banned users to export.");
            return;
        }
        const exportData = {
            exportedAt: new Date().toISOString(),
            count: bannedKeys.length,
            bannedKeys: bannedKeys.map(key => ({
                pubkey: key,
                alias: getAlias(key)
            }))
        };
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `dstream-banlist-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };



    const [searchTerm, setSearchTerm] = useState("");

    const filteredBannedKeys = bannedKeys.filter(key => {
        const alias = getAlias(key).toLowerCase();
        const pub = key.toLowerCase();
        const search = searchTerm.toLowerCase();
        return alias.includes(search) || pub.includes(search);
    });

    return (
        <div className="space-y-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4">
                    <div>
                        <h3 className="text-xl font-bold flex items-center gap-2 mb-1">
                            <ShieldAlert className="w-6 h-6 text-red-500" />
                            Ban List (Muted)
                        </h3>
                        <p className="text-neutral-400 text-sm">
                            Blocked from chat and gated streams. Syncs with Nostr.
                        </p>
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                        <button
                            onClick={handleExport}
                            disabled={bannedKeys.length === 0}
                            className="flex-1 md:flex-none text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-4 py-2 rounded-lg transition-colors border border-neutral-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Download className="w-4 h-4" />
                            Export
                        </button>
                        <button
                            onClick={() => setShowImport(!showImport)}
                            className="flex-1 md:flex-none text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-4 py-2 rounded-lg transition-colors border border-neutral-700"
                        >
                            {showImport ? "Cancel" : "Import"}
                        </button>
                    </div>
                </div>

                {showImport && (
                    <div className="mb-8 p-4 bg-neutral-950 rounded-lg border border-neutral-800 animate-in slide-in-from-top-2 fade-in">
                        <h4 className="font-bold text-white mb-2">Bulk Import</h4>
                        <p className="text-xs text-neutral-500 mb-3">Paste a list of pubkeys (hex) or npubs. Separated by newlines, commas, or spaces.</p>
                        <textarea
                            value={bulkInput}
                            onChange={(e) => setBulkInput(e.target.value)}
                            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-3 text-sm font-mono text-neutral-300 focus:outline-none focus:border-red-500 min-h-[100px]"
                            placeholder={`8237...abc\ncf45...123`}
                        />
                        <div className="flex justify-end gap-2 mt-3">
                            <button
                                onClick={() => {
                                    setShowImport(false);
                                    setBulkInput("");
                                }}
                                className="px-4 py-2 text-sm text-neutral-400 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    if (!bulkInput.trim()) return;
                                    setImporting(true);
                                    try {
                                        const hexRegex = /[0-9a-fA-F]{64}/g;
                                        const matches = bulkInput.match(hexRegex);
                                        if (matches && matches.length > 0) {
                                            const unique = Array.from(new Set(matches));
                                            if (confirm(`Found ${unique.length} valid hex keys. Ban them all?`)) {
                                                await bulkBan(unique);
                                                setShowImport(false);
                                                setBulkInput("");
                                            }
                                        } else {
                                            alert("No valid hex public keys found.");
                                            return;
                                        }
                                    } catch (e) {
                                        alert("Import failed: " + e);
                                    } finally {
                                        setImporting(false);
                                    }
                                }}
                                disabled={importing || !bulkInput.trim()}
                                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {importing ? "Processing..." : "Process Import"}
                            </button>
                        </div>
                    </div>
                )}

                {/* Search & Manual Ban */}
                {!showImport && (
                    <div className="flex flex-col md:flex-row gap-4 mb-6">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search banned users..."
                                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-neutral-700"
                            />
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={manualBanInput}
                                onChange={(e) => setManualBanInput(e.target.value)}
                                placeholder="Paste pubkey to ban..."
                                className="bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-red-500 w-full md:w-64"
                            />
                            <button
                                onClick={handleManualBan}
                                disabled={!manualBanInput}
                                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                                <UserX className="w-4 h-4" />
                                Ban
                            </button>
                        </div>
                    </div>
                )}

                {/* List */}
                <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
                    {filteredBannedKeys.length === 0 ? (
                        <div className="text-center py-12 text-neutral-500 border border-dashed border-neutral-800 rounded-lg flex flex-col items-center">
                            {searchTerm ? (
                                <>
                                    <Search className="w-8 h-8 opacity-20 mb-2" />
                                    <p>No results for "{searchTerm}"</p>
                                </>
                            ) : (
                                <>
                                    <ShieldAlert className="w-8 h-8 opacity-20 mb-2" />
                                    <p>No banned users.</p>
                                    <p className="text-xs mt-1">Peace and quiet.</p>
                                </>
                            )}
                        </div>
                    ) : (
                        filteredBannedKeys.map((key) => (
                            <div key={key} className="flex items-center justify-between p-3 bg-neutral-950/50 border border-neutral-800 rounded-lg group hover:border-neutral-700 transition">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-900/40 to-red-950 flex items-center justify-center text-red-500 font-bold shrink-0 border border-red-900/20">
                                        {getAlias(key)[0].toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-bold text-white mb-0.5 truncate">{getAlias(key)}</div>
                                        <div className="font-mono text-[10px] text-neutral-500 truncate">{key}</div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => unbanKey(key)}
                                    className="px-3 py-1.5 text-neutral-500 hover:text-green-400 hover:bg-green-900/20 rounded-md transition-colors flex items-center gap-2 text-xs font-bold border border-transparent hover:border-green-900/30"
                                    title="Unban User"
                                >
                                    UNBAN
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {bannedKeys.length > 0 && (
                    <div className="mt-4 text-xs text-neutral-600 text-center">
                        Total Banned: {bannedKeys.length}
                    </div>
                )}
            </div>
        </div>
    );
}
