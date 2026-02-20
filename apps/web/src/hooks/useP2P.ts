"use client";
import { useState, useEffect, useRef } from 'react';
import { P2P_TRACKERS } from '@/lib/config';

interface SwarmHealth {
    peerCount: number;
    uploadSpeed: number; // Bytes per second
    downloadSpeed: number; // Bytes per second
    p2pRatio: number; // 0 to 1
    bandwidthSaved: number; // Bytes
}

export function useP2P() {
    const engineRef = useRef<any>(null);
    const [health, setHealth] = useState<SwarmHealth>({
        peerCount: 0,
        uploadSpeed: 0,
        downloadSpeed: 0,
        p2pRatio: 0,
        bandwidthSaved: 0,
    });

    const initP2P = async () => {
        if (typeof window === 'undefined') return null;

        try {
            const { Engine } = await import('p2p-media-loader-core') as any;
            const { HlsJsP2PEngine } = await import('p2p-media-loader-hlsjs') as any;

            if (!engineRef.current) {
                const engine = new HlsJsP2PEngine({
                    loader: {
                        trackerAnnounce: P2P_TRACKERS,
                        rtcConfig: {
                            iceServers: [
                                { urls: 'stun:stun.l.google.com:19302' },
                                { urls: 'stun:global.stun.twilio.com:3478' }
                            ]
                        }
                    }
                });

                // Casting to any to avoid vendor-specific event mismatch in TS
                const engineAny = engine as any;
                if (engineAny.on) {
                    engineAny.on('peerConnect', (peer: any) => {
                        console.log('[P2P] Peer connected:', peer.id);
                    });

                    engineAny.on('peerClose', (peerId: string) => {
                        console.log('[P2P] Peer closed:', peerId);
                    });
                }

                engineRef.current = engine;
            }

            return engineRef.current;
        } catch (e) {
            console.error('[P2P] Failed to initialize engine:', e);
            return null;
        }
    };

    // Update stats on interval
    useEffect(() => {
        const interval = setInterval(() => {
            if (engineRef.current) {
                // p2p-media-loader stats polling
            }
        }, 2000);

        return () => clearInterval(interval);
    }, []);

    return {
        health,
        initP2P,
        isSupported: typeof window !== 'undefined' && !!(window as any).RTCPeerConnection
    };
}
