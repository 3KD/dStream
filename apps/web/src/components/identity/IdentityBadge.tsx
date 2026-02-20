"use client";

import { useState, useEffect, useRef } from 'react';
import { useIdentity } from '@/context/IdentityContext';
import { useInbox } from '@/context/InboxContext';
import Link from 'next/link';
import { Key, Copy, Check, Download, Upload, Trash2, RefreshCw, LayoutDashboard, Mail, ShieldCheck } from 'lucide-react';
import { ProfileEditor } from './ProfileEditor';

interface IdentityBadgeProps {
    hideActions?: boolean;
}

// Utility to shorten pubkey
const shortPubKey = (key: string) => `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;

export function IdentityBadge({ hideActions = false }: IdentityBadgeProps) {
    const { identity, isLoading, generateIdentity, logout } = useIdentity();
    const { openInbox, unreadCount } = useInbox();
    const [copied, setCopied] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [showEditor, setShowEditor] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importText, setImportText] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Auto-close on click outside and Escape key
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.identity-badge-container')) {
                setShowMenu(false);
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowMenu(false);
            }
        };

        if (showMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [showMenu]);

    if (isLoading) {
        return <div className="w-32 h-8 bg-neutral-800 rounded-full animate-pulse" />;
    }

    const handleCopy = () => {
        if (identity?.publicKey) {
            navigator.clipboard.writeText(identity.publicKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleExport = () => {
        if (identity?.privateKey) {
            const json = JSON.stringify(identity, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `dstream-identity-${identity.publicKey.substring(0, 8)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } else {
            alert("This identity is managed by an extension and cannot be exported as a file.");
        }
    };

    const handleImportText = () => {
        try {
            // In a real implementation we would have a unified import method in context
            // For now we just alert as this requires Context update
            alert("For security, please clear your data and import via the main login screen.");
        } catch (e) { /* */ }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            alert("For security, please clear your data and import via the main login screen.");
        };
        reader.readAsText(file);
    };

    if (!identity) {
        return (
            <div className="relative identity-badge-container">
                <button
                    onClick={() => generateIdentity()}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 rounded-full font-medium text-sm transition"
                >
                    <Key className="w-4 h-4" />
                    Create Identity
                </button>
            </div>
        );
    }

    /* We don't have nip05Verified in the base Identity type, assuming true/false or missing for now. 
       Use 'displayName' if available (mapped from metadata). */
    const displayName = (identity as any).displayName || "Anon";
    const isVerified = (identity as any).nip05Verified;

    return (
        <>
            <div className="relative identity-badge-container">
                <div className="flex items-center gap-1 bg-neutral-800 rounded-full pr-1">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="flex items-center gap-2 pl-3 py-1.5 pr-2 hover:bg-neutral-700 rounded-l-full text-sm font-mono transition"
                    >
                        <div className={`w-2 h-2 rounded-full ${isVerified ? 'bg-blue-500' : 'bg-green-500'}`} />
                        <span className="text-neutral-400 max-w-[100px] truncate flex items-center gap-1">
                            {displayName}
                            {isVerified && <ShieldCheck className="w-3 h-3 text-blue-400" />}
                        </span>
                        <span className="text-neutral-600">({shortPubKey(identity.publicKey)})</span>
                    </button>

                    {/* Inbox Button */}
                    {!hideActions && (
                        <button
                            onClick={openInbox}
                            className="p-1.5 hover:bg-neutral-700 rounded-full text-neutral-500 hover:text-white transition relative"
                            title="Inbox"
                        >
                            <Mail className="w-3 h-3" />
                            {unreadCount > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full border border-neutral-900" />
                            )}
                        </button>
                    )}

                    {/* Quick Copy Button Outside Menu */}
                    <button
                        onClick={handleCopy}
                        className="p-1.5 hover:bg-neutral-700 rounded-full text-neutral-500 hover:text-white transition"
                        title="Copy Public Key"
                    >
                        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                </div>

                {showMenu && (
                    <div className="absolute right-0 mt-2 w-72 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl z-50 p-4 space-y-3">
                        <div className="text-xs text-neutral-500">Public Key</div>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs bg-neutral-950 p-2 rounded font-mono break-all text-neutral-400">
                                {identity.publicKey}
                            </code>
                            <button onClick={handleCopy} className="p-2 hover:bg-neutral-800 rounded">
                                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            </button>
                        </div>

                        <div className="border-t border-neutral-800 pt-3 space-y-2">
                            {/* Dashboard Link - Always Show */}
                            <Link
                                href="/dashboard"
                                onClick={() => setShowMenu(false)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-800 rounded transition text-white"
                            >
                                <LayoutDashboard className="w-4 h-4 text-blue-500" /> Broadcaster Studio
                            </Link>

                            {!hideActions && (
                                <>
                                    <button
                                        onClick={() => { setShowMenu(false); setShowEditor(true); }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-800 rounded transition text-blue-400"
                                    >
                                        <Key className="w-4 h-4" /> Edit Profile (Nostr)
                                    </button>
                                </>
                            )}

                            <button
                                onClick={handleExport}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-800 rounded transition"
                            >
                                <Download className="w-4 h-4" /> Export Identity
                            </button>

                            {/* Deprecated import in menu for now, relying on logout -> import */}

                            <button
                                onClick={() => { logout(); setShowMenu(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-800 rounded transition text-red-500"
                            >
                                <Trash2 className="w-4 h-4" /> Disconnect / Logout
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <ProfileEditor isOpen={showEditor} onClose={() => setShowEditor(false)} />
        </>
    );
}
