"use client";
import { IdentityProvider } from '@/context/IdentityContext';
import { BroadcastProvider } from '@/context/BroadcastContext';
import { KeyringProvider } from '@/context/KeyringContext';
import { TrustedPeersProvider } from '@/context/TrustedPeersContext';
import { TipProvider } from '@/context/TipContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { InboxProvider } from '@/context/InboxContext';
import { FavoritesProvider } from '@/context/FavoritesContext';
import { ReactNode } from 'react';

/**
 * Root provider that wraps all context providers.
 * Add new providers here to make them available app-wide.
 */
export function Providers({ children }: { children: ReactNode }) {
    return (
        <SettingsProvider>
            <IdentityProvider>
                <KeyringProvider>
                    <TrustedPeersProvider>
                        <TipProvider>
                            <FavoritesProvider>
                                <InboxProvider>
                                    <BroadcastProvider>
                                        {children}
                                    </BroadcastProvider>
                                </InboxProvider>
                            </FavoritesProvider>
                        </TipProvider>
                    </TrustedPeersProvider>
                </KeyringProvider>
            </IdentityProvider>
        </SettingsProvider>
    );
}
