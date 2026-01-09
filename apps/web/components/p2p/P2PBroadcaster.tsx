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
    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (msg: string) => setLogs(prev => [msg, ...prev].slice(0, 50));

    useEffect(() => {
        if (!isP2PEnabled || !identity || !stream) return;

        addLog("Starting P2P Broadcaster...");

        // Subscribe to DMs (Kind 4)
        const filter: Filter = {
            kinds: [4],
            '#p': [identity.nostrPublicKey!],
            since: Math.floor(Date.now() / 1000)
        };

        const sub = pool.subscribeMany(RELAYS, [filter] as any, {
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
            peers.forEach(pc => pc.close());
            setPeers(new Map());
            addLog("P2P Broadcaster stopped.");
        };
    }, [isP2PEnabled, identity, stream]);

    const handleConnectionRequest = async (peerPubkey: string) => {
        if (!stream || !identity) return;
        addLog(`Connection request from ${peerPubkey.slice(0, 8)}...`);

        // Create PeerConnection
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        // Add Tracks
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        // ICE Candidates
        pc.onicecandidate = async (event) => {
            if (event.candidate) {
                const signal: P2PSignal = {
                    type: 'candidate',
                    candidate: event.candidate.toJSON()
                };
                await sendSignal(peerPubkey, signal);
            }
        };

        pc.onconnectionstatechange = () => {
            addLog(`Peer ${peerPubkey.slice(0, 8)} state: ${pc.connectionState}`);
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                pc.close();
                setPeers(prev => {
                    const next = new Map(prev);
                    next.delete(peerPubkey);
                    return next;
                });
            }
        };

        // Create Offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        setPeers(prev => new Map(prev).set(peerPubkey, pc));

        // Send Offer
        const signal: P2PSignal = {
            type: 'offer',
            sdp: offer.sdp
        };
        await sendSignal(peerPubkey, signal);
        addLog(`Sent Offer to ${peerPubkey.slice(0, 8)}`);
    };

    const handleAnswer = async (peerPubkey: string, signal: P2PSignal) => {
        const pc = peers.get(peerPubkey);
        if (!pc || !signal.sdp) return;

        addLog(`Received Answer from ${peerPubkey.slice(0, 8)}`);
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
    };

    const handleCandidate = async (peerPubkey: string, signal: P2PSignal) => {
        const pc = peers.get(peerPubkey);
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
