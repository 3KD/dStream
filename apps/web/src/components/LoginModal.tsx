"use client";
import { useState } from 'react';
import { useIdentity } from '@/context/IdentityContext';
import { ProfileDisplay } from '@/components/ProfileDisplay';

interface LoginModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
    const { identity, isLoading, generateIdentity, connectExtension, logout } = useIdentity();
    const [error, setError] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);

    if (!isOpen) return null;

    const handleGenerate = async () => {
        setError(null);
        setIsGenerating(true);
        try {
            await generateIdentity();
            onClose();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleExtension = async () => {
        setError(null);
        setIsConnecting(true);
        try {
            await connectExtension();
            onClose();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsConnecting(false);
        }
    };

    const handleLogout = () => {
        logout();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-neutral-900 border border-neutral-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
                <h2 className="text-xl font-bold mb-6">
                    {identity ? 'Your Identity' : 'Sign In'}
                </h2>

                {error && (
                    <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg mb-4 text-sm">
                        {error}
                    </div>
                )}

                {identity ? (
                    /* Logged in state */
                    <div className="space-y-4">
                        <div className="bg-neutral-800 rounded-xl p-4">
                            <ProfileDisplay pubkey={identity.publicKey} size="lg" />
                        </div>

                        <div className="bg-neutral-800 rounded-lg p-3">
                            <div className="text-xs text-neutral-500 mb-1">Public Key</div>
                            <div className="font-mono text-xs text-neutral-300 break-all">
                                {identity.publicKey}
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleLogout}
                                className="flex-1 bg-red-900/50 hover:bg-red-900 border border-red-700 text-red-200 py-2 rounded-lg text-sm"
                            >
                                Logout
                            </button>
                            <button
                                onClick={onClose}
                                className="flex-1 bg-neutral-700 hover:bg-neutral-600 py-2 rounded-lg text-sm"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Logged out state */
                    <div className="space-y-4">
                        <p className="text-neutral-400 text-sm">
                            Create a new identity or connect with a Nostr extension like Alby.
                        </p>

                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-3 rounded-xl font-semibold flex items-center justify-center gap-2"
                        >
                            {isGenerating ? (
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <>🔑 Generate New Identity</>
                            )}
                        </button>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-neutral-700" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="bg-neutral-900 px-2 text-neutral-500">or</span>
                            </div>
                        </div>

                        <button
                            onClick={handleExtension}
                            disabled={isConnecting}
                            className="w-full bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 py-3 rounded-xl font-semibold flex items-center justify-center gap-2"
                        >
                            {isConnecting ? (
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <>🦊 Connect Extension</>
                            )}
                        </button>

                        <p className="text-neutral-500 text-xs text-center">
                            Extensions: Alby, nos2x, Flamingo
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
