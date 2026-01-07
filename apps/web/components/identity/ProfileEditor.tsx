"use client";

import { useState, useEffect } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { pool, RELAYS } from "@/lib/nostr";
import { X, Save, Upload, User, Image as ImageIcon, AtSign, AlignLeft, ShieldCheck, AlertTriangle } from "lucide-react";

interface ProfileMetadata {
    name: string;
    display_name: string;
    about: string;
    picture: string;
    nip05: string;
}

interface ProfileEditorProps {
    isOpen?: boolean;
    onClose?: () => void;
    inline?: boolean;
}

export function ProfileEditor({ isOpen, onClose, inline = false }: ProfileEditorProps) {
    const { identity, signNostrEvent, updateIdentity, verifyNip05 } = useIdentity();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState<string | null>(null);
    const [metadata, setMetadata] = useState<ProfileMetadata>({
        name: "",
        display_name: "",
        about: "",
        picture: "",
        nip05: ""
    });

    // Close on Escape (Modal only)
    useEffect(() => {
        if (inline || !isOpen || !onClose) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose, inline]);

    // Load profile (Cache-first strategy)
    useEffect(() => {
        if ((!inline && !isOpen) || !identity?.nostrPublicKey) return;

        const loadProfile = async () => {
            // 1. Try Cache
            const cacheKey = `dstream_profile_${identity.nostrPublicKey}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    setMetadata({ ...JSON.parse(cached), nip05: JSON.parse(cached).nip05 || "" });
                } catch (e) { /* ignore corrupt cache */ }
            }

            setLoading(true);
            try {
                // 2. Fetch Fresh from Relays
                const event = await pool.get(RELAYS, {
                    authors: [identity.nostrPublicKey!],
                    kinds: [0]
                });

                if (event) {
                    try {
                        const content = JSON.parse(event.content);
                        const newMetadata = {
                            name: content.name || "",
                            display_name: content.display_name || "",
                            about: content.about || "",
                            picture: content.picture || "",
                            nip05: content.nip05 || ""
                        };
                        setMetadata(newMetadata);
                        localStorage.setItem(cacheKey, JSON.stringify(newMetadata));
                    } catch (e) {
                        console.error("Failed to parse metadata content", e);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch profile", e);
            } finally {
                setLoading(false);
            }
        };

        loadProfile();
    }, [isOpen, identity, inline]);

    const handleSave = async () => {
        if (!identity?.nostrPublicKey) return;
        setSaving(true);

        try {
            // 1. Construct Event
            const content = JSON.stringify(metadata);
            const baseEvent = {
                kind: 0,
                created_at: Math.floor(Date.now() / 1000),
                tags: [],
                content: content,
                pubkey: identity.nostrPublicKey,
            };

            // 2. Sign
            const signedEvent = await signNostrEvent(baseEvent);

            // 3. Publish
            await Promise.any(pool.publish(RELAYS, signedEvent));

            // 4. Update Local State (Identity Context)
            // We use display_name or name for the generic "displayName" field in our app context
            updateIdentity({
                displayName: metadata.display_name || metadata.name || "Anon",
                picture: metadata.picture || undefined
            });

            onClose();
        } catch (e) {
            console.error("Failed to save profile", e);
            alert("Failed to save profile. See console for details.");
        } finally {
            setSaving(false);
        }
    };

    const handleVerify = async () => {
        if (!metadata.nip05) return;
        setVerifying(true);
        setVerifyError(null);
        try {
            const valid = await verifyNip05(metadata.nip05);
            if (!valid) {
                setVerifyError("Verification failed. Check your domain settings.");
            }
        } catch (e) {
            setVerifyError("Network error during verification.");
        } finally {
            setVerifying(false);
        }
    };

    if (!inline && !isOpen) return null;

    // Inner Content
    const content = (
        <div className={inline ? "space-y-6" : "flex flex-col h-full"}>
            {!inline && (
                <div className="flex items-center justify-between p-6 border-b border-neutral-800 flex-shrink-0">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <User className="w-5 h-5 text-blue-500" />
                        Edit Profile
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-neutral-800 rounded-full transition text-neutral-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            )}

            <div className={`flex-1 overflow-y-auto ${inline ? "" : "p-6 space-y-6"}`}>
                {inline && (
                    <div className="flex items-center gap-3 mb-6 pb-6 border-b border-neutral-800">
                        <div className="w-12 h-12 rounded-full overflow-hidden bg-neutral-800 flex-shrink-0 border-2 border-neutral-700">
                            {metadata.picture ? (
                                <img src={metadata.picture} alt="Avatar" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-neutral-500">
                                    <User className="w-6 h-6" />
                                </div>
                            )}
                        </div>
                        <div>
                            <h3 className="font-bold text-lg">{metadata.display_name || "New User"}</h3>
                            <p className="text-sm text-neutral-500 font-mono">{identity?.publicKey?.substring(0, 12)}...</p>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-4">
                        <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                        <p className="text-neutral-500 text-sm">Fetching profile from relays...</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-neutral-500 uppercase mb-1 block">Display Name</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-2.5 w-4 h-4 text-neutral-500" />
                                    <input
                                        type="text"
                                        value={metadata.display_name}
                                        onChange={e => setMetadata({ ...metadata, display_name: e.target.value })}
                                        placeholder="Cool User"
                                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-neutral-500 uppercase mb-1 block">Username</label>
                                <input
                                    type="text"
                                    value={metadata.name}
                                    onChange={e => setMetadata({ ...metadata, name: e.target.value })}
                                    placeholder="cooluser"
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-neutral-500 uppercase mb-1 block">About</label>
                            <div className="relative">
                                <AlignLeft className="absolute left-3 top-3 w-4 h-4 text-neutral-500" />
                                <textarea
                                    value={metadata.about}
                                    onChange={e => setMetadata({ ...metadata, about: e.target.value })}
                                    placeholder="I love streaming!"
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition min-h-[80px]"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-neutral-500 uppercase mb-1 block">Avatar URL</label>
                            <div className="relative">
                                <ImageIcon className="absolute left-3 top-2.5 w-4 h-4 text-neutral-500" />
                                <input
                                    type="url"
                                    value={metadata.picture}
                                    onChange={e => setMetadata({ ...metadata, picture: e.target.value })}
                                    placeholder="https://..."
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-neutral-500 uppercase mb-1 block">NIP-05 (Verification)</label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <span className={`absolute left-3 top-2.5 w-4 h-4 flex items-center justify-center font-bold text-xs select-none pointer-events-none transition-colors ${identity?.nip05Verified && metadata.nip05 === identity.nip05 ? 'text-green-500' : 'text-neutral-500'}`}>
                                        <AtSign className="w-4 h-4" />
                                    </span>
                                    <input
                                        type="text"
                                        value={metadata.nip05}
                                        onChange={e => {
                                            setMetadata({ ...metadata, nip05: e.target.value });
                                            setVerifyError(null);
                                        }}
                                        placeholder="name@domain.com"
                                        className={`w-full bg-neutral-950 border rounded-lg pl-10 pr-4 py-2 text-sm focus:ring-1 outline-none transition ${identity?.nip05Verified && metadata.nip05 === identity.nip05 ? 'border-green-500/50 focus:border-green-500 focus:ring-green-500' : verifyError ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500' : 'border-neutral-800 focus:border-blue-500 focus:ring-blue-500'}`}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleVerify();
                                        }}
                                    />
                                </div>
                                <button
                                    onClick={handleVerify}
                                    disabled={verifying || !metadata.nip05}
                                    className={`px-4 py-2 rounded-lg font-bold text-xs transition flex items-center gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${identity?.nip05Verified && metadata.nip05 === identity.nip05 ? 'bg-green-600/20 text-green-500 border border-green-500/30' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}
                                >
                                    {verifying ? (
                                        <>
                                            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                            Checking...
                                        </>
                                    ) : (identity?.nip05Verified && metadata.nip05 === identity.nip05 ? (
                                        <>
                                            <ShieldCheck className="w-3 h-3" />
                                            Verified
                                        </>
                                    ) : (
                                        'Verify Now'
                                    ))}
                                </button>
                            </div>

                            {/* Feedback Area */}
                            <div className="min-h-[20px] ml-1 mt-1">
                                {verifyError ? (
                                    <p className="text-[10px] text-red-500 flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                                        <AlertTriangle className="w-3 h-3" />
                                        {verifyError}
                                    </p>
                                ) : identity?.nip05Verified && metadata.nip05 === identity.nip05 ? (
                                    <p className="text-[10px] text-green-500 flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                                        <ShieldCheck className="w-3 h-3" />
                                        <span>Successfully verified as <span className="font-mono font-bold text-green-400">{metadata.nip05}</span></span>
                                    </p>
                                ) : (
                                    <p className="text-[10px] text-neutral-600">
                                        Enter your identifier (e.g. user@nostr.com) to verify your pubkey.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className={inline ? "pt-4 flex justify-end" : "p-6 border-t border-neutral-800 flex gap-4 flex-shrink-0"}>
                {!inline && (
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 font-medium transition"
                    >
                        Cancel
                    </button>
                )}
                <button
                    onClick={handleSave}
                    disabled={saving || loading}
                    className={`${inline ? "w-full md:w-auto px-6" : "flex-1"} px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 font-bold transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    {saving ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Publishing...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4" />
                            Save Profile
                        </>
                    )}
                </button>
            </div>
        </div>
    );

    if (inline) {
        return <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">{content}</div>;
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
                {content}
            </div>
        </div>
    );
}

