"use client";
import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { BroadcastSession, Stream, StreamStatus } from '@/lib/types';
import { WhipClient } from '@/lib/whip';
import { PORTS, MEDIA_CONFIG } from '@/lib/config';
import { useIdentity } from '@/context/IdentityContext';
import { announceStream } from '@/lib/nostr';

interface BroadcastContextValue {
    /** Current broadcast session */
    session: BroadcastSession | null;
    /** Start a new broadcast */
    startBroadcast: (streamKey: string, mediaStream: MediaStream, metadata?: Partial<Stream>) => Promise<void>;
    /** Stop the current broadcast */
    stopBroadcast: () => void;
    /** Update stream metadata */
    updateMetadata: (metadata: Partial<Stream>) => void;
}

const BroadcastContext = createContext<BroadcastContextValue | null>(null);

export function BroadcastProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<BroadcastSession | null>(null);
    const whipClientRef = useRef<WhipClient | null>(null);

    const startBroadcast = useCallback(async (
        streamKey: string,
        mediaStream: MediaStream,
        metadata?: Partial<Stream>
    ) => {
        // Initialize session
        const initialSession: BroadcastSession = {
            streamKey,
            stream: {
                id: streamKey,
                title: metadata?.title || streamKey,
                broadcasterPubkey: '', // Will be set when identity is available
                status: 'starting',
                viewerCount: 0,
                tags: metadata?.tags || [],
                description: metadata?.description,
            },
            mediaStream,
            connectionStatus: 'connecting',
        };

        setSession(initialSession);

        try {
            // Connect to MediaMTX via WHIP (Proxied)
            const endpoint = `${window.location.origin}${MEDIA_CONFIG.whipUrl}/${streamKey}/whip`;
            console.log('[Broadcast] Connecting to WHIP endpoint:', endpoint);
            const client = new WhipClient(endpoint);

            console.log('[Broadcast] Publishing stream...');
            await client.publish(mediaStream);
            console.log('[Broadcast] Publish successful. Setting session to live.');

            whipClientRef.current = client;

            // Update session to connected
            setSession(prev => prev ? {
                ...prev,
                stream: { ...prev.stream, status: 'live', startedAt: Math.floor(Date.now() / 1000) },
                connectionStatus: 'connected',
            } : null);

        } catch (error: any) {
            console.error('[Broadcast] Connection failed:', error);
            let errorMessage = error.message;
            if (errorMessage.includes('Failed to fetch')) {
                errorMessage = 'Streaming server unavailable (Connection Refused). Is MediaMTX running?';
            }

            setSession(prev => prev ? {
                ...prev,
                stream: { ...prev.stream, status: 'offline' },
                connectionStatus: 'error',
                error: errorMessage,
            } : null);
            // Do not re-throw, let the state handle the UI feedback
        }
    }, []);

    const stopBroadcast = useCallback(() => {
        console.log('[Broadcast] Stopping broadcast session...');
        if (whipClientRef.current) {
            try {
                whipClientRef.current.close();
                console.log('[Broadcast] WHIP client closed.');
            } catch (err) {
                console.error('[Broadcast] Error closing WHIP client:', err);
            }
            whipClientRef.current = null;
        }

        // NOTE: We do NOT stop the mediaStream tracks here anymore. 
        // The camera lifecycle is managed by useCamera / the UI. 
        // We only stop the *broadcasting* (PeerConnection).

        setSession(null);
    }, [session]);

    const updateMetadata = useCallback((metadata: Partial<Stream>) => {
        setSession(prev => prev ? {
            ...prev,
            stream: { ...prev.stream, ...metadata },
        } : null);
    }, []);

    return (
        <BroadcastContext.Provider value={{
            session,
            startBroadcast,
            stopBroadcast,
            updateMetadata,
        }}>
            {children}
        </BroadcastContext.Provider>
    );
}

export function useBroadcast() {
    const context = useContext(BroadcastContext);
    if (!context) {
        throw new Error('useBroadcast must be used within a BroadcastProvider');
    }
    return context;
}
