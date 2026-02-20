import React, { useEffect, useRef, useState } from 'react';
import { useIdentity } from '@/context/IdentityContext';
import { pool, RELAYS } from '@/lib/nostr';
import { decryptSignal, encryptSignal, createSignalEvent, P2PSignal } from '@/lib/p2p';
import { Filter, Event } from 'nostr-tools';

interface P2PPlayerProps {
    broadcasterPubkey: string;
    onStatusChange?: (status: string) => void;
}

export const P2PPlayer: React.FC<P2PPlayerProps> = ({ broadcasterPubkey, onStatusChange }) => {
    const { identity, signNostrEvent } = useIdentity();

    const [connectionState, setConnectionState] = useState<string>('idle');
    const videoRef = useRef<HTMLVideoElement>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const candidateQueue = useRef<RTCIceCandidateInit[]>([]);

    useEffect(() => {
        if (!identity || !broadcasterPubkey) return;

        const startP2P = async () => {
            setConnectionState('connecting');
            onStatusChange?.('Connecting P2P via Nostr...');

            // Create PeerConnection
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });
            pcRef.current = pc;

            pc.ontrack = (event) => {
                console.log("Track received!", event.streams[0]);
                if (videoRef.current) {
                    videoRef.current.srcObject = event.streams[0];
                    setConnectionState('connected');
                    onStatusChange?.('Direct P2P Connection Established');
                }
            };

            // ICE Candidates Batching
            const candidateBufferOut: RTCIceCandidateInit[] = [];
            let flushTimeout: NodeJS.Timeout | null = null;

            const flushCandidates = async () => {
                if (candidateBufferOut.length === 0) return;

                const batch = [...candidateBufferOut];
                candidateBufferOut.length = 0; // Clear buffer

                await sendSignal(broadcasterPubkey, {
                    type: 'candidate',
                    candidates: batch
                });
            };

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    candidateBufferOut.push(event.candidate.toJSON());

                    if (candidateBufferOut.length >= 10) {
                        if (flushTimeout) clearTimeout(flushTimeout);
                        flushCandidates();
                    } else if (!flushTimeout) {
                        flushTimeout = setTimeout(() => {
                            flushCandidates();
                            flushTimeout = null;
                        }, 150);
                    }
                }
            };

            pc.onconnectionstatechange = () => {
                console.log("P2P State:", pc.connectionState);
                if (pc.connectionState === 'failed') {
                    setConnectionState('failed');
                    onStatusChange?.('P2P Connection Failed');
                }
            };

            // Send Connection Request
            await sendSignal(broadcasterPubkey, { type: 'p2p-request' });
        };

        startP2P();

        // Listen for signals (Offer from Broadcaster)
        const filter: Filter = {
            kinds: [4],
            '#p': [identity.nostrPublicKey!],
            since: Math.floor(Date.now() / 1000)
        };

        const processCandidate = async (pc: RTCPeerConnection, candidate: RTCIceCandidateInit) => {
            if (!pc.remoteDescription) {
                console.log("Buffering early candidate (no remote desc)...");
                candidateQueue.current.push(candidate);
            } else {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e: any) {
                    if (e.message?.includes('ufrag') || e.name === 'OperationError') {
                        console.warn("Buffering candidate due to ufrag mismatch (pending offer?)...");
                        candidateQueue.current.push(candidate);
                    } else {
                        console.error("Error adding ICE candidate", e);
                    }
                }
            }
        };

        const sub = pool.subscribeMany(RELAYS, filter as any, {
            onevent: async (event: Event) => {
                try {
                    const sender = event.pubkey;
                    if (sender !== broadcasterPubkey) return; // Only accept signals from broadcaster

                    const signal = await decryptSignal(identity, sender, event.content);
                    if (!signal) return;

                    const pc = pcRef.current;
                    if (!pc) return;

                    if (signal.type === 'offer') {
                        await handleOffer(pc, signal);
                    } else if (signal.type === 'candidate') {
                        // Handle Single Candidate (Backwards Compat)
                        if (signal.candidate) {
                            await processCandidate(pc, signal.candidate);
                        }
                        // Handle Batched Candidates
                        if (signal.candidates) {
                            for (const c of signal.candidates) {
                                await processCandidate(pc, c);
                            }
                        }
                    }

                } catch (e) {
                    console.error("Error handling P2P signal:", e);
                }
            }
        });

        return () => {
            sub.close();
            pcRef.current?.close();
            setConnectionState('idle');
        };
    }, [identity, broadcasterPubkey]);

    const handleOffer = async (pc: RTCPeerConnection, signal: P2PSignal) => {
        if (!signal.sdp) return;

        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
        console.log("Remote Description set (Offer)");

        // Flush buffered candidates
        console.log(`Flushing ${candidateQueue.current.length} buffered candidates...`);
        const remainingCandidates: RTCIceCandidateInit[] = [];

        for (const cand of candidateQueue.current) {
            try {
                // If the candidate ufrag doesn't match current remote description, it might be for a future (or past) offer.
                // However, we can't easily peek ufrag from CandidateInit without parsing. 
                // We just try to add it.
                await pc.addIceCandidate(new RTCIceCandidate(cand));
                console.log("Buffered candidate added successfully");
            } catch (e: any) {
                if (e.message?.includes('ufrag') || e.name === 'OperationError') {
                    console.warn("Candidate still mismatched (re-buffering)...");
                    remainingCandidates.push(cand);
                } else {
                    console.error("Error adding buffered candidate", e);
                }
            }
        }
        candidateQueue.current = remainingCandidates;


        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await sendSignal(broadcasterPubkey, {
            type: 'answer',
            sdp: answer.sdp
        });
        console.log("Sent Answer");
    };

    const sendSignal = async (peerPubkey: string, signal: P2PSignal) => {
        if (!identity) return;
        const eventDraft = await createSignalEvent(identity, peerPubkey, signal);
        const signedEvent = await signNostrEvent(eventDraft);
        pool.publish(RELAYS, signedEvent);
    };

    return (
        <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden group">
            <video
                ref={videoRef}
                autoPlay
                playsInline
                controls
                className="w-full h-full object-contain"
            />

            {connectionState !== 'connected' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                    <div className="text-white bg-black/80 px-4 py-2 rounded-full backdrop-blur-sm border border-white/20">
                        status: {connectionState}
                    </div>
                </div>
            )}

            <div className="absolute top-2 left-2 bg-red-500/80 text-white text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                P2P LIVE
            </div>
        </div>
    );
};
