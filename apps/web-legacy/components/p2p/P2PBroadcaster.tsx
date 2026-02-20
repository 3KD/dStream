import React, { useEffect, useRef, useState } from 'react';
import { useIdentity } from '@/context/IdentityContext';
import { pool, RELAYS } from '@/lib/nostr';
import { decryptSignal, encryptSignal, createSignalEvent, P2PSignal } from '@/lib/p2p';
import { Filter, Event } from 'nostr-tools';

interface P2PBroadcasterProps {
    stream: MediaStream | null;
    isP2PEnabled: boolean;
}

export const P2PBroadcaster: React.FC<P2PBroadcasterProps> = ({ stream, isP2PEnabled }) => {
    const { identity, signNostrEvent } = useIdentity();
    const [peers, setPeers] = useState<Map<string, RTCPeerConnection>>(new Map());
    const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map()); // Ref for access in callbacks
    const streamRef = useRef<MediaStream | null>(stream);
    const [logs, setLogs] = useState<string[]>([]);

    // Keep stream ref up to date
    useEffect(() => {
        streamRef.current = stream;

        // Update tracks for existing peers if stream changes
        if (stream) {
            peersRef.current.forEach((pc) => {
                const senders = pc.getSenders();
                const videoTrack = stream.getVideoTracks()[0];
                const audioTrack = stream.getAudioTracks()[0];

                if (videoTrack) {
                    const videoSender = senders.find(s => s.track?.kind === 'video');
                    if (videoSender) videoSender.replaceTrack(videoTrack).catch(e => console.error("Replace video track error", e));
                    else pc.addTrack(videoTrack, stream);
                }

                if (audioTrack) {
                    const audioSender = senders.find(s => s.track?.kind === 'audio');
                    if (audioSender) audioSender.replaceTrack(audioTrack).catch(e => console.error("Replace audio track error", e));
                    else pc.addTrack(audioTrack, stream);
                }
            });
        }
    }, [stream]);

    const addLog = (msg: string) => setLogs(prev => [msg, ...prev].slice(0, 50));

    // Signal Handling (Stable, does not depend on stream changes)
    useEffect(() => {
        if (!isP2PEnabled || !identity) return;

        addLog("Starting P2P Broadcaster (Signal Channel)...");

        // Subscribe to DMs (Kind 4)
        const filter = {
            kinds: [4],
            '#p': [identity.nostrPublicKey!],
            since: Math.floor(Date.now() / 1000)
        };

        const sub = pool.subscribeMany(RELAYS, filter as any, {
            onevent: async (event: Event) => {
                try {
                    // Decrypt
                    const sender = event.pubkey;
                    const signal = await decryptSignal(identity, sender, event.content);

                    if (!signal) return; // Decryption failed or not for us

                    if (signal.type === 'p2p-request') {
                        handleConnectionRequest(sender);
                    } else if (signal.type === 'answer') {
                        handleAnswer(sender, signal);
                    } else if (signal.type === 'candidate') {
                        handleCandidate(sender, signal);
                    }
                } catch (e) {
                    console.error("Error handling P2P signal:", e);
                }
            }
        });

        return () => {
            sub.close();
            // Cleanup peers
            peersRef.current.forEach(pc => pc.close());
            peersRef.current.clear();
            setPeers(new Map());
            addLog("P2P Broadcaster stopped.");
        };
    }, [isP2PEnabled, identity?.nostrPublicKey]); // Only restart if Identity/Enabled changes

    const handleConnectionRequest = async (peerPubkey: string) => {
        // Updated: Allow connection even if stream is temporary (tracks added later via effect)
        if (!identity) {
            addLog(`Request from ${peerPubkey.slice(0, 8)} ignored (No Identity)`);
            return;
        }
        addLog(`Connection request from ${peerPubkey.slice(0, 8)}...`);

        // Check if we already have a stable connection
        if (peersRef.current.has(peerPubkey)) {
            const existingPC = peersRef.current.get(peerPubkey);
            if (existingPC && (existingPC.connectionState === 'connected' || existingPC.connectionState === 'connecting')) {
                addLog(`Ignoring duplicate request from ${peerPubkey.slice(0, 8)}`);
                return;
            }
        }

        // Create PeerConnection
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        // Add Tracks from CURRENT stream ref
        // Add Tracks from CURRENT stream ref if available
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => {
                if (streamRef.current) pc.addTrack(track, streamRef.current);
            });
        } else {
            addLog(`Peer ${peerPubkey.slice(0, 8)} connected (Waiting for tracks...)`);
        }

        // ICE Candidates Batching
        const candidateBuffer: RTCIceCandidateInit[] = [];
        let flushTimeout: NodeJS.Timeout | null = null;

        const flushCandidates = async () => {
            if (candidateBuffer.length === 0) return;

            const batch = [...candidateBuffer];
            candidateBuffer.length = 0; // Clear buffer

            const signal: P2PSignal = {
                type: 'candidate',
                candidates: batch
            };
            await sendSignal(peerPubkey, signal);
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                candidateBuffer.push(event.candidate.toJSON());

                // Flush if buffer gets large
                if (candidateBuffer.length >= 10) {
                    if (flushTimeout) clearTimeout(flushTimeout);
                    flushCandidates();
                }
                // Debounce flush
                else if (!flushTimeout) {
                    flushTimeout = setTimeout(() => {
                        flushCandidates();
                        flushTimeout = null;
                    }, 150);
                }
            }
        };

        pc.onconnectionstatechange = () => {
            addLog(`Peer ${peerPubkey.slice(0, 8)} state: ${pc.connectionState}`);
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                pc.close();
                peersRef.current.delete(peerPubkey);
                setPeers(new Map(peersRef.current));
            }
        };

        // Create Offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        peersRef.current.set(peerPubkey, pc);
        setPeers(new Map(peersRef.current));

        // Send Offer
        const signal: P2PSignal = {
            type: 'offer',
            sdp: offer.sdp
        };
        await sendSignal(peerPubkey, signal);
        addLog(`Sent Offer to ${peerPubkey.slice(0, 8)}`);
    };

    const handleAnswer = async (peerPubkey: string, signal: P2PSignal) => {
        const pc = peersRef.current.get(peerPubkey);
        if (!pc || !signal.sdp) return;

        addLog(`Received Answer from ${peerPubkey.slice(0, 8)}`);
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
    };

    const handleCandidate = async (peerPubkey: string, signal: P2PSignal) => {
        const pc = peersRef.current.get(peerPubkey);
        if (!pc || !signal.candidate) return;

        try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (e) {
            console.error("Error adding ICE candidate", e);
        }
    };

    const sendSignal = async (peerPubkey: string, signal: P2PSignal) => {
        if (!identity) return;
        const eventDraft = await createSignalEvent(identity, peerPubkey, signal);
        const signedEvent = await signNostrEvent(eventDraft);
        pool.publish(RELAYS, signedEvent);
    };

    return (
        <div className="bg-neutral-900/50 p-4 rounded-lg border border-neutral-800 text-xs font-mono">
            <div className="font-bold mb-2 text-cyan-400">P2P Broadcaster Active</div>
            <div className="h-32 overflow-y-auto space-y-1">
                {logs.map((log, i) => (
                    <div key={i} className="opacity-70">{log}</div>
                ))}
            </div>
            <div className="mt-2 text-neutral-500">
                Connected Peers: {peers.size}
            </div>
        </div>
    );
};
