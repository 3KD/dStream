"use client";

import { useState, useEffect } from 'react';
import { Server, Trash2, Save, Check, Key } from 'lucide-react';
import { configureMonero, MoneroVerificationMode } from '@/lib/monero';
import { clearChannel } from '@/lib/chatStorage';

interface SettingsPanelProps {
    onClose?: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
    // Monero Config State
    const [moneroMode, setMoneroMode] = useState<MoneroVerificationMode>('public-api');
    const [nodeUrl, setNodeUrl] = useState('http://localhost:18081');
    const [moneroSaved, setMoneroSaved] = useState(false);

    // Chat State
    const [chatCleared, setChatCleared] = useState(false);
    const [clearingChat, setClearingChat] = useState(false);

    useEffect(() => {
        // Load saved Monero config from localStorage
        const savedMoneroConfig = localStorage.getItem('dstream_monero_config');
        if (savedMoneroConfig) {
            try {
                const config = JSON.parse(savedMoneroConfig);
                setMoneroMode(config.mode || 'public-api');
                setNodeUrl(config.nodeUrl || 'http://localhost:18081');
            } catch { }
        }
    }, []);

    const handleSaveMonero = () => {
        const config = {
            mode: moneroMode,
            nodeUrl: moneroMode === 'node' ? nodeUrl : undefined,
        };

        // Save to localStorage
        localStorage.setItem('dstream_monero_config', JSON.stringify(config));

        // Apply to runtime
        configureMonero(config);

        setMoneroSaved(true);
        setTimeout(() => setMoneroSaved(false), 2000);
    };

    const handleClearChat = async () => {
        setClearingChat(true);
        try {
            // Clear all channels (we'll clear a few common patterns)
            // In reality, you'd want to track which channels the user has visited
            const keys = Object.keys(localStorage).filter(k => k.startsWith('ticket_'));
            for (const key of keys) {
                const channel = key.replace('ticket_', '');
                await clearChannel(channel);
            }
            setChatCleared(true);
            setTimeout(() => setChatCleared(false), 2000);
        } catch (e) {
            console.error('Failed to clear chat:', e);
        }
        setClearingChat(false);
    };

    return (
        <div className="space-y-6">
            {/* Monero Node Config */}
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-4">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <Server className="w-5 h-5 text-orange-400" aria-hidden="true" />
                    Monero Verification
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm text-neutral-400 mb-2">
                            Verification Mode
                        </label>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="monero-mode"
                                    value="public-api"
                                    checked={moneroMode === 'public-api'}
                                    onChange={() => setMoneroMode('public-api')}
                                    className="accent-blue-500"
                                />
                                <span className="text-sm">Public API (easier)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="monero-mode"
                                    value="node"
                                    checked={moneroMode === 'node'}
                                    onChange={() => setMoneroMode('node')}
                                    className="accent-blue-500"
                                />
                                <span className="text-sm">Self-hosted Node (private)</span>
                            </label>
                        </div>
                    </div>

                    {moneroMode === 'node' && (
                        <div>
                            <label htmlFor="node-url" className="block text-sm text-neutral-400 mb-1">
                                Node RPC URL
                            </label>
                            <input
                                id="node-url"
                                type="text"
                                value={nodeUrl}
                                onChange={(e) => setNodeUrl(e.target.value)}
                                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
                                placeholder="http://localhost:18081"
                            />
                        </div>
                    )}

                    <div className="text-xs text-neutral-500 p-2 bg-neutral-950/50 rounded-lg">
                        {moneroMode === 'public-api' ? (
                            <p>Uses xmrchain.net API. Simple but less private.</p>
                        ) : (
                            <p>Uses your own Monero node for maximum privacy. Requires a running node with RPC enabled.</p>
                        )}
                    </div>

                    <button
                        onClick={handleSaveMonero}
                        className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition"
                    >
                        {moneroSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                        {moneroSaved ? 'Saved!' : 'Save Monero Config'}
                    </button>
                </div>
            </div>

            {/* Clear Chat History */}
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-4">
                <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                    <Trash2 className="w-5 h-5 text-red-400" aria-hidden="true" />
                    Chat History
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                    Clear all locally stored chat messages from all channels.
                </p>

                {chatCleared ? (
                    <div className="flex items-center gap-2 text-green-400 text-sm">
                        <Check className="w-4 h-4" />
                        <span>Chat history cleared!</span>
                    </div>
                ) : (
                    <button
                        onClick={handleClearChat}
                        disabled={clearingChat}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium rounded-lg transition"
                    >
                        <Trash2 className="w-4 h-4" />
                        {clearingChat ? 'Clearing...' : 'Clear All Chat History'}
                    </button>
                )}
            </div>
        </div>
    );
}
