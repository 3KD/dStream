"use client";

import { useState } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { useInbox } from "@/context/InboxContext";
import { shortPubKey, exportIdentity, importIdentity, saveIdentity } from "@/lib/identity";
import { Key, Copy, Check, Download, Upload, Trash2, RefreshCw, Shield, ShieldCheck, Eye, EyeOff, Mail, AlertTriangle } from "lucide-react";
import { ProfileEditor } from "@/components/identity/ProfileEditor";

export function NostrIdentitySettings() {
    const { identity, isLoading, createIdentity, deleteIdentity, loginWithExtension } = useIdentity();
    const { openInbox, unreadCount } = useInbox();
    const [copied, setCopied] = useState<string | null>(null);
    const [showPrivateKey, setShowPrivateKey] = useState(false);
    const [showEditor, setShowEditor] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importText, setImportText] = useState("");

    const handleCopy = (text: string, key: string) => {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    const handleExport = () => {
        if (identity) {
            const json = exportIdentity(identity);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `dstream-identity-${identity.publicKey.substring(0, 8)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    const handleImport = () => {
        const parsed = importIdentity(importText);
        if (parsed) {
            saveIdentity(parsed);
            window.location.reload();
        }
    };

    if (isLoading) {
        return (
            <div className="animate-pulse space-y-4">
                <div className="h-8 bg-neutral-800 rounded w-1/3" />
                <div className="h-32 bg-neutral-800 rounded" />
            </div>
        );
    }

    if (!identity) {
        return (
            <div className="max-w-2xl space-y-8">
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 text-center">
                    <Key className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
                    <h2 className="text-xl font-bold mb-2">No Identity Found</h2>
                    <p className="text-neutral-400 mb-6">Create or import an identity to access broadcasting features.</p>

                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <button
                            onClick={() => createIdentity()}
                            className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 rounded-lg font-bold flex items-center gap-2 justify-center"
                        >
                            <Key className="w-5 h-5" />
                            Generate New Identity
                        </button>
                        <button
                            onClick={() => loginWithExtension()}
                            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-bold flex items-center gap-2 justify-center"
                        >
                            <Shield className="w-5 h-5" />
                            Login with Extension
                        </button>
                    </div>

                    <div className="mt-8 pt-6 border-t border-neutral-800">
                        <button
                            onClick={() => setImporting(!importing)}
                            className="text-sm text-neutral-400 hover:text-white flex items-center gap-2 mx-auto"
                        >
                            <Upload className="w-4 h-4" />
                            Import existing identity
                        </button>
                        {importing && (
                            <div className="mt-4 space-y-3 max-w-sm mx-auto">
                                <textarea
                                    value={importText}
                                    onChange={(e) => setImportText(e.target.value)}
                                    placeholder="Paste identity JSON..."
                                    className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-3 text-sm font-mono h-24 text-white"
                                />
                                <button
                                    onClick={handleImport}
                                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold"
                                >
                                    Import
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-2xl space-y-8">
            {/* Identity Overview */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-bold mb-2">Nostr Identity</h2>
                        <p className="text-neutral-400">Manage your broadcasting identity and profile.</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={openInbox}
                            className="relative p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition group"
                            title="Inbox"
                        >
                            <Mail className="w-5 h-5 text-neutral-400 group-hover:text-white" />
                            {unreadCount > 0 && (
                                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] flex items-center justify-center text-white font-bold">
                                    {unreadCount}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Inline Profile Editor */}
                <ProfileEditor inline={true} />
            </div>

            {/* Keys Section */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-6">
                <h3 className="text-lg font-bold flex items-center gap-2">
                    <Shield className="w-5 h-5 text-purple-500" />
                    Cryptographic Keys
                </h3>

                {/* Nostr Public Key (npub) */}
                <div className="space-y-2">
                    <label className="text-xs text-purple-500 font-bold uppercase tracking-wider">
                        Nostr Public Key (npub)
                    </label>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 font-mono text-sm text-neutral-300 break-all">
                            {identity.nostrPublicKey}
                        </code>
                        <button
                            onClick={() => handleCopy(identity.nostrPublicKey || "", "npub")}
                            className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition"
                        >
                            {copied === "npub" ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                        </button>
                    </div>
                </div>

                {/* Protocol Public Key (Ed25519) */}
                <div className="space-y-2">
                    <label className="text-xs text-blue-500 font-bold uppercase tracking-wider">
                        Protocol Public Key (Ed25519)
                    </label>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 font-mono text-sm text-neutral-300 break-all">
                            {identity.publicKey}
                        </code>
                        <button
                            onClick={() => handleCopy(identity.publicKey, "pubkey")}
                            className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition"
                        >
                            {copied === "pubkey" ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                        </button>
                    </div>
                </div>

                {/* Private Key (Hidden by Default) */}
                {identity.nostrPrivateKey && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs text-red-500 font-bold uppercase tracking-wider flex items-center gap-2">
                                <AlertTriangle className="w-3 h-3" />
                                Private Key (nsec) - KEEP SECRET
                            </label>
                            <button
                                onClick={() => setShowPrivateKey(!showPrivateKey)}
                                className="text-xs text-neutral-500 hover:text-white flex items-center gap-1"
                            >
                                {showPrivateKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                {showPrivateKey ? "Hide" : "Show"}
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 bg-neutral-950 border border-red-900/30 rounded-lg px-4 py-3 font-mono text-sm text-neutral-300 break-all">
                                {showPrivateKey ? identity.nostrPrivateKey : "••••••••••••••••••••••••••••••••"}
                            </code>
                            {showPrivateKey && (
                                <button
                                    onClick={() => handleCopy(identity.nostrPrivateKey || "", "nsec")}
                                    className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition"
                                >
                                    {copied === "nsec" ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Actions Section */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-4">
                <h3 className="text-lg font-bold">Identity Management</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-3 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition text-left"
                    >
                        <Download className="w-5 h-5 text-blue-500" />
                        <div>
                            <div className="font-medium">Export Identity</div>
                            <div className="text-xs text-neutral-500">Download backup JSON</div>
                        </div>
                    </button>

                    <button
                        onClick={() => setImporting(!importing)}
                        className="flex items-center gap-3 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition text-left"
                    >
                        <Upload className="w-5 h-5 text-green-500" />
                        <div>
                            <div className="font-medium">Import Identity</div>
                            <div className="text-xs text-neutral-500">Restore from backup</div>
                        </div>
                    </button>

                    <button
                        onClick={() => createIdentity()}
                        className="flex items-center gap-3 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition text-left"
                    >
                        <RefreshCw className="w-5 h-5 text-yellow-500" />
                        <div>
                            <div className="font-medium">Generate New</div>
                            <div className="text-xs text-neutral-500">Create fresh identity</div>
                        </div>
                    </button>

                    <button
                        onClick={() => {
                            if (confirm("Are you sure you want to delete your identity? This cannot be undone.")) {
                                deleteIdentity();
                            }
                        }}
                        className="flex items-center gap-3 px-4 py-3 bg-red-900/20 hover:bg-red-900/30 border border-red-900/50 rounded-lg transition text-left"
                    >
                        <Trash2 className="w-5 h-5 text-red-500" />
                        <div>
                            <div className="font-medium text-red-400">Delete Identity</div>
                            <div className="text-xs text-neutral-500">Remove from device</div>
                        </div>
                    </button>
                </div>

                {importing && (
                    <div className="mt-4 space-y-3 p-4 bg-neutral-950 rounded-lg border border-neutral-800">
                        <textarea
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                            placeholder="Paste identity JSON..."
                            className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-3 text-sm font-mono h-24 text-white"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => setImporting(false)}
                                className="flex-1 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleImport}
                                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold"
                            >
                                Import
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <ProfileEditor isOpen={showEditor} onClose={() => setShowEditor(false)} />
        </div >
    );
}
