"use client";

import { useState, useRef } from 'react';
import { Download, Upload, AlertTriangle, Check, Shield, Key, Settings, Users, Ban, Ticket } from 'lucide-react';
import { createBackup, downloadBackup, parseBackupFile, restoreBackup, getBackupSummary, BackupData } from '@/lib/backup';

export function BackupRestore() {
    const [pendingBackup, setPendingBackup] = useState<BackupData | null>(null);
    const [restoreSuccess, setRestoreSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDownload = () => {
        const backup = createBackup();
        downloadBackup(backup);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);
        setRestoreSuccess(false);

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            const backup = parseBackupFile(content);

            if (backup) {
                setPendingBackup(backup);
            } else {
                setError('Invalid backup file. Please select a valid dStream backup.');
                setPendingBackup(null);
            }
        };
        reader.onerror = () => {
            setError('Failed to read file.');
        };
        reader.readAsText(file);
    };

    const handleConfirmRestore = () => {
        if (!pendingBackup) return;

        restoreBackup(pendingBackup);
        setPendingBackup(null);
        setRestoreSuccess(true);

        // Reload page after short delay to apply changes
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    };

    const handleCancelRestore = () => {
        setPendingBackup(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const summary = pendingBackup ? getBackupSummary(pendingBackup) : null;

    return (
        <div className="space-y-6">
            {/* Backup Section */}
            <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl">
                <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                    <Download className="w-5 h-5 text-blue-400" />
                    Backup Your Identity
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                    Download a backup file containing your Nostr identity, stream settings, and trusted peers.
                    <br />
                    <span className="text-yellow-500 font-medium">Store this file securely — it contains your private keys.</span>
                </p>
                <button
                    onClick={handleDownload}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center gap-2 transition"
                >
                    <Download className="w-4 h-4" />
                    Download Backup
                </button>
            </div>

            {/* Restore Section */}
            <div className="p-4 bg-neutral-900/50 border border-neutral-800 rounded-xl">
                <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                    <Upload className="w-5 h-5 text-green-400" />
                    Restore From Backup
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                    Upload a previously downloaded backup file to restore your identity and settings.
                </p>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="backup-file-input"
                />

                {!pendingBackup && !restoreSuccess && (
                    <label
                        htmlFor="backup-file-input"
                        className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white font-medium rounded-lg flex items-center gap-2 transition cursor-pointer inline-flex"
                    >
                        <Upload className="w-4 h-4" />
                        Select Backup File
                    </label>
                )}

                {error && (
                    <div className="mt-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        {error}
                    </div>
                )}

                {restoreSuccess && (
                    <div className="mt-4 p-3 bg-green-900/30 border border-green-800 rounded-lg text-green-300 text-sm flex items-center gap-2">
                        <Check className="w-4 h-4" />
                        Restore successful! Reloading...
                    </div>
                )}

                {/* Restore Preview */}
                {pendingBackup && summary && (
                    <div className="mt-4 p-4 bg-neutral-800/50 border border-yellow-800/50 rounded-lg">
                        <div className="flex items-center gap-2 text-yellow-400 mb-3">
                            <AlertTriangle className="w-5 h-5" />
                            <span className="font-bold">Confirm Restore</span>
                        </div>

                        <p className="text-sm text-neutral-300 mb-4">
                            This will <span className="text-red-400 font-medium">overwrite</span> your current identity and settings.
                        </p>

                        <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                            <div className="flex items-center gap-2 text-neutral-300">
                                <Shield className="w-4 h-4 text-purple-400" />
                                Identity: {summary.displayName || 'Anonymous'}
                            </div>
                            <div className="flex items-center gap-2 text-neutral-300">
                                <Key className="w-4 h-4 text-blue-400" />
                                Stream Key: {summary.hasStreamKey ? 'Yes' : 'No'}
                            </div>
                            <div className="flex items-center gap-2 text-neutral-300">
                                <Settings className="w-4 h-4 text-green-400" />
                                Settings: {summary.hasSettings ? 'Yes' : 'No'}
                            </div>
                            <div className="flex items-center gap-2 text-neutral-300">
                                <Users className="w-4 h-4 text-cyan-400" />
                                Trusted Peers: {summary.trustedPeersCount}
                            </div>
                            <div className="flex items-center gap-2 text-neutral-300">
                                <Ban className="w-4 h-4 text-red-400" />
                                Banned Peers: {summary.bannedPeersCount}
                            </div>
                            <div className="flex items-center gap-2 text-neutral-300">
                                <Ticket className="w-4 h-4 text-yellow-400" />
                                Tickets: {summary.ticketCount}
                            </div>
                        </div>

                        <p className="text-xs text-neutral-500 mb-4">
                            Backup created: {new Date(pendingBackup.createdAt).toLocaleString()}
                        </p>

                        <div className="flex gap-3">
                            <button
                                onClick={handleConfirmRestore}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg flex items-center gap-2 transition"
                            >
                                <Check className="w-4 h-4" />
                                Confirm Restore
                            </button>
                            <button
                                onClick={handleCancelRestore}
                                className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white font-medium rounded-lg transition"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
