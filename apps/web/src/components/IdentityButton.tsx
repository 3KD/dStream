"use client";
import { useState } from 'react';
import { useIdentity } from '@/context/IdentityContext';
import { ProfileDisplay } from '@/components/ProfileDisplay';
import { LoginModal } from '@/components/LoginModal';

export function IdentityButton() {
    const { identity, isLoading } = useIdentity();
    const [showModal, setShowModal] = useState(false);

    if (isLoading) {
        return (
            <div className="w-10 h-10 rounded-full bg-neutral-800 animate-pulse" />
        );
    }

    return (
        <>
            <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-full px-3 py-1.5 transition-colors"
            >
                {identity ? (
                    <ProfileDisplay pubkey={identity.publicKey} size="sm" />
                ) : (
                    <>
                        <span className="text-lg">👤</span>
                        <span className="text-sm font-medium">Sign In</span>
                    </>
                )}
            </button>

            <LoginModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
            />
        </>
    );
}
