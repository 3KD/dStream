"use client";
import { useIdentity } from '@/context/IdentityContext';
import { useProfile } from '@/hooks/useProfile';

interface ProfileDisplayProps {
    pubkey?: string;
    size?: 'sm' | 'md' | 'lg';
    showName?: boolean;
}

export function ProfileDisplay({ pubkey, size = 'md', showName = true }: ProfileDisplayProps) {
    const { identity } = useIdentity();
    const targetPubkey = pubkey || identity?.publicKey;
    const { profile, isLoading } = useProfile(targetPubkey);

    const sizeClasses = {
        sm: 'w-6 h-6 text-xs',
        md: 'w-10 h-10 text-sm',
        lg: 'w-16 h-16 text-base',
    };

    const shortPubkey = targetPubkey ? targetPubkey.slice(0, 8) : '???';
    const displayName = profile?.name || shortPubkey;

    return (
        <div className="flex items-center gap-2">
            {/* Avatar */}
            <div className={`${sizeClasses[size]} rounded-full bg-neutral-700 overflow-hidden flex-shrink-0`}>
                {profile?.picture ? (
                    <img
                        src={profile.picture}
                        alt={displayName}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-400">
                        {displayName.charAt(0).toUpperCase()}
                    </div>
                )}
            </div>

            {/* Name */}
            {showName && (
                <div className="min-w-0">
                    <div className={`font-medium truncate ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
                        {isLoading ? '...' : displayName}
                    </div>
                    {profile?.nip05 && size !== 'sm' && (
                        <div className="text-xs text-neutral-500 truncate">
                            {profile.nip05}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
