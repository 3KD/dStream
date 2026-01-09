"use client";

import { useState, useRef, useEffect } from "react";
import { CaptionOverlay } from "@/components/player/CaptionOverlay";
import { P2PBroadcaster } from '@/components/p2p/P2PBroadcaster';
import { useNostrGuilds } from '@/hooks/useNostrGuilds'; // reusing for pool/relays
import Link from "next/link";
import { MessageSquare, Settings, Radio, Square, Eye, Shield, ShieldAlert, ShieldCheck, AtSign, Video, VideoOff, Mic, MicOff, Wifi, WifiOff, RefreshCw, Mail } from "lucide-react";
import { IdentityBadge } from "@/components/identity/IdentityBadge";
import { useIdentity } from "@/context/IdentityContext";
import { WHIPClient } from "@/lib/whipClient";
import { finalizeEvent } from "nostr-tools";
import { publishEvent, KIND_STREAM_ANNOUNCE, minePow } from "@/lib/nostr";
import { deriveStreamPath } from "@/lib/streamId";
import { validateMoneroAddress } from "@/lib/monero";
import { AnalyticsView } from "@/components/dashboard/AnalyticsView";
import { ProfileEditor } from "@/components/identity/ProfileEditor";
import { ModerationView } from "@/components/dashboard/ModerationView";
import { ChatBox } from "@/components/chat/ChatBox";
import { useBroadcast } from "@/context/BroadcastContext";
// Header removed - this is now a component within the dashboard
import { useInbox } from "@/context/InboxContext";

interface MediaDevice {
    deviceId: string;
    label: string;
}

export function BroadcastView() {
    const { identity, createIdentity, updateIdentity, sign, signNostrEvent, isLoading: isIdentityLoading } = useIdentity();
    const {
        session: broadcastSession,
        isLive,
        startBroadcast,
        endBroadcast,
        stream,
        setStream,
        whipClient,
        setWhipClient,
        whipStatus,
        setWhipStatus
    } = useBroadcast();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [streamKey, setStreamKey] = useState("my-stream");
    // Enhanced Metadata State
    const [streamName, setStreamName] = useState("");
    const [description, setDescription] = useState("");
    const [tags, setTags] = useState(""); // Comma separated
    const [contentWarning, setContentWarning] = useState("");
    const [language, setLanguage] = useState("en");

    // Toast notification state
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };
    // Monetization
    const [streamPrice, setStreamPrice] = useState(0); // XMR
    const [streamDuration, setStreamDuration] = useState(24); // Hours default
    const [showCaptions, setShowCaptions] = useState(false);
    const [isP2PEnabled, setIsP2PEnabled] = useState(false);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [escrowAmount, setEscrowAmount] = useState(0.01);
    const [currentStreamId, setCurrentStreamId] = useState<string | null>(null); // Identity-bound path

    // Media state
    const [hasPermission, setHasPermission] = useState(false);
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [cameras, setCameras] = useState<MediaDevice[]>([]);
    const [mics, setMics] = useState<MediaDevice[]>([]);
    const [selectedCamera, setSelectedCamera] = useState("");
    const [selectedMic, setSelectedMic] = useState("");
    const [error, setError] = useState<string | null>(null);
    // Removed local whipStatus state, using context
    // Removed local whipClientRef, using context

    // Settings Persistence System (Cookies/LocalStorage)
    useEffect(() => {
        const saved = localStorage.getItem('dstream_broadcast_settings');
        if (saved) {
            try {
                const s = JSON.parse(saved);
                if (s.streamKey) setStreamKey(s.streamKey);
                if (s.streamName) setStreamName(s.streamName);
                if (s.description) setDescription(s.description);
                if (s.tags) setTags(s.tags);
                if (s.contentWarning) setContentWarning(s.contentWarning);
                if (s.language) setLanguage(s.language);
                if (s.streamPrice) setStreamPrice(s.streamPrice);
                if (s.streamDuration) setStreamDuration(s.streamDuration);
                if (s.escrowAmount) setEscrowAmount(s.escrowAmount);
                if (s.selectedCamera) setSelectedCamera(s.selectedCamera);
                if (s.selectedMic) setSelectedMic(s.selectedMic);
                if (typeof s.videoEnabled === 'boolean') setVideoEnabled(s.videoEnabled);
                if (typeof s.audioEnabled === 'boolean') setAudioEnabled(s.audioEnabled);
            } catch (e) {
                console.error("Failed to load broadcast settings", e);
            }
        } else {
            // Legacy/Initial Fallback
            const legacyKey = localStorage.getItem("dstream_key");
            if (legacyKey) setStreamKey(legacyKey);
            else if (identity?.publicKey) setStreamKey(`user-${identity.publicKey.substring(0, 8)}`);
        }
    }, [identity?.publicKey]);

    useEffect(() => {
        const settings = {
            streamKey, streamName, description, tags, contentWarning, language,
            streamPrice, streamDuration, escrowAmount,
            selectedCamera, selectedMic, videoEnabled, audioEnabled
        };
        localStorage.setItem('dstream_broadcast_settings', JSON.stringify(settings));
        if (streamKey && streamKey !== "my-stream") {
            localStorage.setItem("dstream_key", streamKey); // Keep legacy key in sync for internal refs
        }
    }, [streamKey, streamName, description, tags, contentWarning, language, streamPrice, streamDuration, escrowAmount, selectedCamera, selectedMic, videoEnabled, audioEnabled]);

    // Auto-reconnection: restore stream when mounting with active session
    useEffect(() => {
        const reconnect = async () => {
            if (!broadcastSession?.isLive || isReconnecting) return;
            if (whipClient) return; // Already connected in context
            if (!stream || !identity) return; // Need media and identity first

            setIsReconnecting(true);
            console.log("[Broadcast] Auto-reconnecting to session:", broadcastSession.streamId);

            try {
                const pubkey = identity.publicKey || identity.nostrPublicKey || 'anonymous';
                const timestamp = Date.now().toString();
                const messageToSign = `${broadcastSession.streamId}:${timestamp}`;
                const authSignature = await sign(messageToSign);
                if (!authSignature) throw new Error("Failed to sign for reconnection");

                const authParams = new URLSearchParams({
                    pubkey: pubkey,
                    sig: authSignature,
                    t: timestamp,
                    name: broadcastSession.streamKey
                }).toString();

                setWhipStatus("connecting");
                const client = new WHIPClient(broadcastSession.streamId, authParams);
                setWhipClient(client);
                await client.connect(stream);
                setWhipStatus("streaming");
                setCurrentStreamId(broadcastSession.streamId);
                console.log("[Broadcast] Reconnected successfully!");
            } catch (err: any) {
                console.error("[Broadcast] Reconnection failed:", err);
                setWhipStatus("error");
                setError("Failed to reconnect stream. You may need to go live again.");
            } finally {
                setIsReconnecting(false);
            }
        };

        reconnect();
    }, [broadcastSession, stream, identity, sign, isReconnecting, whipClient]);

    // Rate limiting state (60s cooldown between broadcasts)
    const [lastBroadcastTime, setLastBroadcastTime] = useState<number>(0);
    const BROADCAST_COOLDOWN_MS = 60_000; // 60 seconds

    // Get available devices
    useEffect(() => {
        const initDevices = async () => {
            try {
                // If stream exists in context, ensure it's attached and just enumerate devices
                if (stream) {
                    setHasPermission(true);
                    if (videoRef.current && !videoRef.current.srcObject) {
                        videoRef.current.srcObject = stream;
                    }
                    // Only return if we have devices enumerated? No, we should still enumerate below
                } else {
                    // Check for secure context (HTTPS or localhost required for getUserMedia)
                    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                        const isSecure = window.isSecureContext;
                        const msg = isSecure
                            ? "Camera API not available in this browser."
                            : "Camera requires HTTPS. If accessing via LAN IP, use localhost or set up HTTPS.";
                        setError(msg);
                        console.error(`[Camera] ${msg} (isSecureContext: ${isSecure})`);
                        return;
                    }

                    // 1. Try requesting both permissions and KEEP the stream
                    let initialStream: MediaStream | undefined;
                    try {
                        initialStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        setHasPermission(true);
                        setStream(initialStream);
                        if (videoRef.current) {
                            videoRef.current.srcObject = initialStream;
                        }
                    } catch (err: any) {
                        console.warn("Combined access failed, trying individual:", err.name);
                        // Fallback: Try Audio Only (common if no webcam)
                        try {
                            initialStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                            setHasPermission(true);
                            // Don't set video source if only audio
                        } catch (audioErr) {
                            // Try Video Only (Critical fallback if mic is broken)
                            try {
                                initialStream = await navigator.mediaDevices.getUserMedia({ video: true });
                                setHasPermission(true);
                                setStream(initialStream);
                                if (videoRef.current) {
                                    videoRef.current.srcObject = initialStream;
                                }
                            } catch (videoErr) {
                                throw err; // Throw original error if nothing works
                            }
                        }
                    }
                }

                // 2. Enumerate devices (Now that we definitely have permission active)
                const devices = await navigator.mediaDevices.enumerateDevices();
                let videoDevices = devices.filter(d => d.kind === 'videoinput');
                let audioDevices = devices.filter(d => d.kind === 'audioinput');

                // Fallback for empty enumeration
                if (videoDevices.length === 0) {
                    // @ts-ignore
                    videoDevices = [{ deviceId: "default", label: "Default Camera", kind: 'videoinput' }];
                }
                if (audioDevices.length === 0) {
                    // @ts-ignore
                    audioDevices = [{ deviceId: "default", label: "Default Microphone", kind: 'audioinput' }];
                }

                const mappedCameras = videoDevices.map(d => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.substring(0, 8)}` }));
                const mappedMics = audioDevices.map(d => ({ deviceId: d.deviceId, label: d.label || `Mic ${d.deviceId.substring(0, 8)}` }));

                setCameras(mappedCameras);
                setMics(mappedMics);

                // Set initial selection based on what we actually got
                // Only if NOT already selected (persistence)
                if (!selectedCamera) {
                    if (stream) {
                        const vidTrack = stream.getVideoTracks()[0];
                        if (vidTrack) setSelectedCamera(vidTrack.getSettings().deviceId || videoDevices[0].deviceId);
                        else setSelectedCamera(videoDevices[0].deviceId);
                    } else if (videoDevices.length > 0) {
                        setSelectedCamera(videoDevices[0].deviceId);
                    }
                }

                if (!selectedMic) {
                    if (stream) {
                        const audTrack = stream.getAudioTracks()[0];
                        if (audTrack) setSelectedMic(audTrack.getSettings().deviceId || audioDevices[0].deviceId);
                        else setSelectedMic(audioDevices[0].deviceId);
                    } else if (audioDevices.length > 0) {
                        setSelectedMic(audioDevices[0].deviceId);
                    }
                }

            } catch (err: any) {
                console.error("Initialization failed:", err);
                if (err.name === 'NotAllowedError') {
                    setError("Camera/Mic access denied. Reset permissions in address bar.");
                } else if (err.name === 'NotFoundError') {
                    setError("No camera or microphone found.");
                } else {
                    setError(`Device Error: ${err.message}`);
                }
            }
        };
        initDevices();
    }, [stream]); // Added stream dependency so it re-runs if stream becomes available externally (or initially)

    // Start preview when device selected
    useEffect(() => {
        // If sharing screen, ignore camera selection changes
        if (selectedCamera === "screen") return;

        // Auto-select first camera if none selected but available
        if (!selectedCamera && cameras.length > 0) {
            setSelectedCamera(cameras[0].deviceId);
            return;
        }

        if (!selectedCamera) return;
        // Note: Removed "!hasPermission" check to allow retry/force logic

        const startPreview = async () => {
            try {
                if (stream) {
                    const vidTrack = stream.getVideoTracks()[0];
                    if (vidTrack && vidTrack.getSettings().deviceId === selectedCamera) {
                        if (videoRef.current && !videoRef.current.srcObject) {
                            videoRef.current.srcObject = stream;
                        }
                        return;
                    }
                    if (selectedCamera !== "default") {
                        stream.getTracks().forEach(t => t.stop());
                    }
                }

                console.log("Starting preview with:", selectedCamera);

                const videoConstraints = selectedCamera === "default"
                    ? true
                    : { deviceId: { ideal: selectedCamera } };

                const audioConstraints = selectedMic === "default" || !selectedMic
                    ? true
                    : { deviceId: { ideal: selectedMic } };

                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: videoConstraints,
                    audio: audioConstraints
                });

                setStream(newStream);
                if (videoRef.current) {
                    videoRef.current.srcObject = newStream;
                }
                setHasPermission(true);
            } catch (err: any) {
                console.error("Camera preview error:", err);

                // Fallback Strategy
                try {
                    console.log("[dStream] Attempting fallback 1: Any video/audio device");
                    const fallbackStream1 = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    setStream(fallbackStream1);
                    if (videoRef.current) videoRef.current.srcObject = fallbackStream1;
                    return;
                } catch (e1) {
                    console.warn("[dStream] Fallback 1 failed:", e1);
                }

                try {
                    console.log("[dStream] Attempting fallback 2: Video only (no audio)");
                    const fallbackStream2 = await navigator.mediaDevices.getUserMedia({ video: true });
                    setStream(fallbackStream2);
                    if (videoRef.current) videoRef.current.srcObject = fallbackStream2;
                    return;
                } catch (e2) {
                    console.error("[dStream] Fallback 2 failed:", e2);

                    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
                    if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
                        setError(`Camera not found. ${isMac ? 'Mac users: Check System Settings -> Privacy & Security -> Camera.' : 'Please ensure your camera is plugged in.'}`);
                    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                        setError("Camera is in use by another application (Zoom, OBS, etc).");
                    } else {
                        setError(`Camera Error: ${err.message || err.name}`);
                    }
                }
            }
        };
        startPreview();

        return () => {
            // Optional cleanup
        };
    }, [selectedCamera, selectedMic, cameras]);

    const startScreenShare = async () => {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true // System audio
            });

            // To add Mic:
            try {
                const micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: selectedMic } });
                screenStream.addTrack(micStream.getAudioTracks()[0]);
            } catch (e) {
                console.warn("Could not add mic to screen share", e);
            }

            setStream(screenStream);
            setSelectedCamera("screen"); // Marker state
            if (videoRef.current) {
                videoRef.current.srcObject = screenStream;
            }

            // Handle user stopping share via browser UI
            screenStream.getVideoTracks()[0].onended = () => {
                setSelectedCamera(cameras[0]?.deviceId || "default"); // Revert to cam
            };

        } catch (err) {
            console.error("Screen share failed:", err);
            // User cancelled?
        }
    };

    // Cleanup on browser close/refresh
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isLive && whipClient) {
                if (identity?.nostrPrivateKey) {
                    const endEvent = {
                        kind: KIND_STREAM_ANNOUNCE,
                        created_at: Math.floor(Date.now() / 1000),
                        tags: [
                            ['d', streamKey],
                            ['status', 'ended'],
                        ],
                        content: '',
                    };
                    const signedEvent = finalizeEvent(endEvent, (identity.nostrPrivateKey as any).length === 64 ? Uint8Array.from(Buffer.from(identity.nostrPrivateKey, 'hex')) : new Uint8Array(0));
                }
                whipClient.disconnect();
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isLive, identity, streamKey, currentStreamId, whipClient]);

    const toggleVideo = () => {
        if (stream) {
            stream.getVideoTracks().forEach(t => t.enabled = !videoEnabled);
            setVideoEnabled(!videoEnabled);
        }
    };

    const toggleAudio = () => {
        if (stream) {
            stream.getAudioTracks().forEach(t => t.enabled = !audioEnabled);
            setAudioEnabled(!audioEnabled);
        }
    };

    // Helper
    const hexToBytes = (hex: string) => {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        return bytes;
    };

    const goLive = async () => {
        // Rate limiting check
        const now = Date.now();
        const timeSinceLastBroadcast = now - lastBroadcastTime;
        if (timeSinceLastBroadcast < BROADCAST_COOLDOWN_MS && lastBroadcastTime > 0) {
            const remainingSeconds = Math.ceil((BROADCAST_COOLDOWN_MS - timeSinceLastBroadcast) / 1000);
            setError(`Please wait ${remainingSeconds}s before broadcasting again (spam prevention)`);
            return;
        }
        setLastBroadcastTime(now);

        let currentIdentity = identity;
        if (!currentIdentity) {
            currentIdentity = await createIdentity();
        }

        // Derive identity-bound stream path to prevent hijacking
        const pubkey = currentIdentity?.publicKey || currentIdentity?.nostrPublicKey || 'anonymous';
        const derivedPath = await deriveStreamPath(pubkey, streamKey);
        setCurrentStreamId(derivedPath);
        console.log(`[Stream] Derived path: ${derivedPath} (from ${pubkey.substring(0, 8)}... + "${streamKey}")`);

        try {
            // Build announce payload with derived path
            const announcePayload = {
                type: 'STREAM_ANNOUNCE',
                pubkey: pubkey,
                stream_id: derivedPath,  // Use derived path, not raw streamKey
                stream_name: streamName || streamKey,   // Use custom name or streamKey
                metadata: {
                    title: streamName || `${streamKey} - Live Stream`,
                    description: description || 'Broadcasting live',
                    escrow_amount: escrowAmount,
                    monero_address: currentIdentity?.moneroAddress,
                    tags: tags.split(',').map(t => t.trim()).filter(Boolean),
                    content_warning: contentWarning,
                    language: language,
                    price: streamPrice > 0 ? { amount: streamPrice, currency: 'XMR' } : undefined,
                    term: streamPrice > 0 ? { unit: 'hours', value: streamDuration } : undefined
                }
            };

            // Sign the payload if we have an identity
            let signature: string | undefined;
            if (currentIdentity) {
                const messageToSign = JSON.stringify(announcePayload);
                signature = await sign(messageToSign) || undefined;
            }

            // 1. Announce to Legacy Registry (Optional / Low Priority)
            let registrySuccess = false;
            try {
                const response = await fetch('http://localhost:3002/announce', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...announcePayload, signature })
                });
                if (response.ok) registrySuccess = true;
            } catch (regErr) {
                console.warn("Registry announcement failed (expected if ownerless):", regErr);
            }

            // 2. Announce to Nostr Relays (Ownerless - Primary)
            let nostrSuccess = false;
            if (currentIdentity && currentIdentity.nostrPrivateKey) {
                // 1. Create Event
                const event = {
                    kind: KIND_STREAM_ANNOUNCE,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                        ['d', derivedPath], // Use derivedPath instead of streamId
                        ['title', streamName || `${streamKey} - Live Stream`],
                        ['summary', description || "Live on dStream"],
                        ['image', currentIdentity.picture || "https://via.placeholder.com/1280x720.png?text=dStream+Live"],
                        ['t', "streaming"],
                        // Custom Tags
                        ...tags.split(',').map(t => ['t', t.trim().toLowerCase()]).filter(t => t[1]),
                        // Content Warning (NIP-36)
                        ...(contentWarning ? [['content-warning', contentWarning]] : []),
                        // Language (NIP-31 -ish, usually 'L' tag for other kinds, but good usage here too)
                        ['L', language],
                        // Monetization Tags
                        ...(streamPrice > 0 ? [
                            ['price', streamPrice.toString(), 'XMR'],
                            ['term', 'hours', streamDuration.toString()]
                        ] : []),
                        ['streaming', `http://localhost:8880/${derivedPath}/index.m3u8`], // Use derivedPath for streaming URL
                        ['status', 'live'],
                        ['starts', Math.floor(Date.now() / 1000).toString()],
                        // Broadcaster profile info
                        ['broadcaster_name', currentIdentity.displayName || 'Anonymous'],
                        // Add Monero Address and Escrow Amount if set
                        ...(currentIdentity.moneroAddress ? [['monero_address', currentIdentity.moneroAddress]] : []), // Use currentIdentity
                        ['escrow_amount', escrowAmount.toString()]
                    ],
                    content: `🔴 Live: ${streamName || streamKey}

${description}

Watch at: ${window.location.origin}/watch/${derivedPath}`, // Use streamKey and derivedPath
                    pubkey: currentIdentity.nostrPublicKey, // Use currentIdentity
                };

                // 2. PoW Mining (Optional - improves propagation)
                const PO_DIFFICULTY = 16; // Re-using original difficulty for consistency
                console.log(`[PoW] Mining announcement (diff ${PO_DIFFICULTY})...`);
                const powEvent = minePow(event, PO_DIFFICULTY); // Use PO_DIFFICULTY

                // 3. Sign using Context (Supports Extension/Hardware)
                const signedEvent = await signNostrEvent(powEvent);

                // 4. Publish
                const published = await publishEvent(signedEvent);
                nostrSuccess = true;
                console.log(`[Nostr] Announced stream ${streamKey} as path ${derivedPath} (Kind 30311, PoW ${PO_DIFFICULTY})`);
            }

            if (registrySuccess || nostrSuccess || true) {
                // Save to persistent context
                startBroadcast({
                    streamId: derivedPath,
                    streamKey: streamKey,
                    selectedCamera,
                    selectedMic,
                    videoEnabled,
                    audioEnabled,
                });
                setError(null);

                // Now connect via WHIP to actually stream
                if (stream) {
                    setWhipStatus("connecting");
                    try {
                        const timestamp = Date.now().toString();
                        // Sign the path + timestamp for replay protection
                        const messageToSign = `${derivedPath}:${timestamp}`;
                        const authSignature = await sign(messageToSign);
                        if (!authSignature) throw new Error("Failed to sign stream path for authentication");

                        // Construct auth params: pubkey + sig + t + original_name
                        const authParams = new URLSearchParams({
                            pubkey: pubkey,
                            sig: authSignature,
                            t: timestamp,
                            name: streamKey
                        }).toString();

                        const client = new WHIPClient(derivedPath, authParams);
                        setWhipClient(client);
                        await client.connect(stream);
                        setWhipStatus("streaming");
                        console.log(`[WHIP] WebRTC stream connected!`);
                    } catch (whipErr: any) {
                        console.error(`[WHIP] Failed to connect:`, whipErr);
                        setWhipStatus("error");
                        // Don't fail the whole flow, WHIP is optional
                    }
                }
            } else {
                throw new Error('Failed to announce stream to any network (Nostr or Registry)');
            }
        } catch (err: any) {
            setError(`Failed to go live: ${err.message}`);
        }
    };

    const stopStream = async () => {
        // Disconnect WHIP
        if (whipClient) {
            whipClient.disconnect();
            setWhipClient(null);
            setWhipStatus("idle");
        }

        // Publish stream ended to Nostr
        if (identity && identity.nostrPrivateKey) {
            try {
                const endEvent = {
                    kind: KIND_STREAM_ANNOUNCE,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                        ['d', currentStreamId || streamKey], // Use the active ID if live
                        ['title', `${streamKey} - Stream Ended`],
                        ['status', 'ended'],
                        ['t', 'dstream'],
                    ],
                    content: '',
                };

                const signedEvent = finalizeEvent(endEvent, hexToBytes(identity.nostrPrivateKey));
                await publishEvent(signedEvent);
                console.log(`[Nostr] Published stream ended event for ${streamKey}`);
            } catch (err) {
                console.error('[Nostr] Failed to publish stream ended event:', err);
            }
        }

        endBroadcast();
        console.log(`Stream "${streamKey}" ended`);
    };

    // Dashboard Tabs
    const [activeTab, setActiveTab] = useState<"settings" | "analytics" | "studio" | "messages" | "moderation" | "chat">("settings");
    const { openInbox } = useInbox();
    const [showProfileEditor, setShowProfileEditor] = useState(false);

    // NOTE: Removed auto-switch to analytics when going live - user can switch manually

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Radio className="w-8 h-8 text-purple-500" />
                <h2 className="text-2xl font-bold">{isLive ? "Live Dashboard" : "Go Live"}</h2>
            </div>

            {error && (
                <div className="bg-red-900/50 border border-red-600 rounded-lg p-4 mb-6 flex flex-col items-center text-center">
                    <p className="text-red-200 mb-3">{error}</p>
                    <div className="flex gap-4">
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm text-white"
                        >
                            Refresh Page
                        </button>
                        {/* Browser might block programmatic re-request after denial, but we can try or guide user */}
                        <button
                            onClick={() => navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(() => window.location.reload())}
                            className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm text-white"
                        >
                            Try Again
                        </button>
                    </div>
                    <p className="text-xs text-neutral-400 mt-3">
                        Check the lock icon in your address bar to reset permissions.
                    </p>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_450px] gap-6 items-start">
                {/* Preview + Status */}
                <div className="lg:col-span-1 flex flex-col gap-4">
                    {/* Status Badges - Above Video */}
                    {(isLive || isReconnecting) && (
                        <div className="flex gap-4 px-1">
                            <div className={`text-xs font-bold flex items-center gap-1.5 tracking-wider ${isReconnecting ? 'text-yellow-500' : 'text-red-500'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isReconnecting ? 'bg-yellow-500' : 'bg-red-500'}`} />
                                {isReconnecting ? 'RECONNECTING...' : 'LIVE'}
                            </div>
                            <div className={`text-xs font-bold flex items-center gap-1.5 tracking-wider ${whipStatus === 'streaming' ? 'text-green-500' :
                                whipStatus === 'connecting' ? 'text-yellow-500' :
                                    whipStatus === 'error' ? 'text-red-400' : 'text-neutral-500'
                                }`}>
                                {whipStatus === 'streaming' ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                                {whipStatus === 'streaming' ? 'CONNECTED' :
                                    whipStatus === 'connecting' ? 'CONNECTING...' :
                                        whipStatus === 'error' ? 'FALLBACK: OBS' : 'IDLE'}
                            </div>
                        </div>
                    )}

                    <div className="relative aspect-video bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 shadow-2xl">
                        <video
                            ref={videoRef}
                            autoPlay
                            muted
                            playsInline
                            className={`w-full h-full object-cover ${!videoEnabled ? 'opacity-0' : ''}`}
                        />
                        {/* Caption Overlay */}
                        <CaptionOverlay
                            streamId={currentStreamId || ""}
                            isBroadcaster={true}
                        />

                        {/* P2P Broadcaster (Hidden Logic) */}
                        {isP2PEnabled && isLive && localStream && (
                            <div className="absolute bottom-20 left-4 z-50 animate-in fade-in slide-in-from-bottom-5">
                                <P2PBroadcaster stream={localStream} isP2PEnabled={isP2PEnabled} />
                            </div>
                        )}

                        {!videoEnabled && (
                            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
                                <VideoOff className="w-16 h-16 text-neutral-600" />
                            </div>
                        )}

                        {/* Debug: Show camera status when no stream */}
                        {!stream && videoEnabled && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900/90 text-center p-4">
                                <Video className="w-12 h-12 text-neutral-500 mb-4" />
                                <p className="text-neutral-400 mb-2">
                                    {!hasPermission ? "Waiting for camera permission..." :
                                        cameras.length === 0 ? "No cameras detected" :
                                            !selectedCamera ? "No camera selected" :
                                                "Starting camera preview..."}
                                </p>
                                <p className="text-xs text-neutral-600">
                                    Cameras: {cameras.length} | Mics: {mics.length} | Permission: {hasPermission ? "✓" : "✗"}
                                </p>
                                <div className="flex gap-3 mt-4">
                                    {!hasPermission && (
                                        <button
                                            onClick={() => navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(() => window.location.reload())}
                                            className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm transition font-medium"
                                        >
                                            Grant Permissions
                                        </button>
                                    )}
                                    <button
                                        onClick={() => window.location.reload()}
                                        className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition font-medium flex items-center gap-2"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                        Retry Initialization
                                    </button>
                                </div>
                                {error && (
                                    <div className="mt-4 p-3 bg-red-900/30 border border-red-800/50 rounded-lg max-w-sm">
                                        <p className="text-red-400 text-xs leading-relaxed">
                                            {error}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Control Bar (Moving controls out of overlay) */}
                    <div className="flex items-center justify-between bg-neutral-900 p-3 rounded-xl border border-neutral-800">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={toggleVideo}
                                className={`p-3 rounded-lg transition-colors ${videoEnabled ? 'bg-neutral-800 hover:bg-neutral-700 text-white' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'}`}
                                title={videoEnabled ? "Turn Camera Off" : "Turn Camera On"}
                            >
                                {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                            </button>
                            <button
                                onClick={toggleAudio}
                                className={`p-3 rounded-lg transition-colors ${audioEnabled ? 'bg-neutral-800 hover:bg-neutral-700 text-white' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'}`}
                                title={audioEnabled ? "Mute Microphone" : "Unmute Microphone"}
                            >
                                {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                            </button>
                        </div>

                        <div className="flex items-center gap-2 text-sm text-neutral-500">
                            {/* Device Info */}
                            <span className="hidden sm:inline-block">
                                {cameras.find(c => c.deviceId === selectedCamera)?.label.substring(0, 20)}...
                            </span>
                        </div>
                    </div>

                    {/* Go Live Button - Quick Access */}
                    {!isLive ? (
                        <button
                            onClick={goLive}
                            disabled={!hasPermission || !identity?.moneroAddress}
                            className="w-full py-4 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                        >
                            <Radio className="w-5 h-5" />
                            Go Live
                        </button>
                    ) : (
                        <div className="space-y-3">
                            <button
                                onClick={stopStream}
                                className="w-full py-4 bg-neutral-800 hover:bg-neutral-700 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                            >
                                <Square className="w-5 h-5 fill-current" />
                                End Stream
                            </button>
                            <div className="bg-green-900/30 border border-green-600 rounded-xl p-3">
                                <p className="text-xs text-green-400 font-medium mb-1">Share your stream:</p>
                                <div className="flex gap-2">
                                    <input
                                        readOnly
                                        value={`${typeof window !== 'undefined' ? window.location.origin : ''}/watch/${currentStreamId || streamKey}`}
                                        className="flex-1 bg-neutral-950 px-2 py-1.5 rounded text-[10px] font-mono text-neutral-400 border border-neutral-700"
                                    />
                                    <button
                                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/watch/${currentStreamId || streamKey}`)}
                                        className="px-3 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded text-xs font-bold"
                                    >
                                        Copy
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Settings / Analytics Panel */}
                <div className="space-y-6">
                    {/* Tabs */}
                    <div className="flex gap-4 border-b border-neutral-800 pb-2">
                        <button
                            onClick={() => setActiveTab("settings")}
                            className={`pb-2 px-1 text-sm font-bold transition-colors ${activeTab === "settings" ? "text-white border-b-2 border-purple-500" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            Settings
                        </button>
                        <button
                            onClick={() => setActiveTab("analytics")}
                            className={`pb-2 px-1 text-sm font-bold transition-colors ${activeTab === "analytics" ? "text-white border-b-2 border-purple-500" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            Analytics
                        </button>
                        <button
                            onClick={() => setActiveTab("messages")}
                            className={`pb-2 px-1 text-sm font-bold transition-colors ${activeTab === "messages" ? "text-white border-b-2 border-purple-500" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            Messages
                        </button>
                        <button
                            onClick={() => setActiveTab("chat")}
                            className={`pb-2 px-1 text-sm font-bold transition-colors flex items-center gap-1.5 ${activeTab === "chat" ? "text-white border-b-2 border-green-500" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            <MessageSquare className="w-3.5 h-3.5" />
                            Chat
                        </button>
                    </div>

                    {activeTab === "analytics" ? (
                        <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                            <AnalyticsView streamId={currentStreamId} />
                        </div>
                    ) : activeTab === "studio" ? (
                        <div className="bg-neutral-900 rounded-xl p-8 border border-neutral-800 shadow-xl">
                            <div className="flex items-center justify-between mb-8">
                                <h3 className="font-bold text-2xl flex items-center gap-3">
                                    <div className="p-2 bg-purple-500/20 rounded-lg">
                                        <Radio className="w-6 h-6 text-purple-500" />
                                    </div>
                                    Broadcaster Studio
                                </h3>
                                {identity?.publicKey && (
                                    <div className="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full flex items-center gap-2">
                                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                        <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest">Identity Active</span>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-8">
                                {/* Verification Status */}
                                <div className="flex items-center gap-4 p-4 bg-neutral-950 border border-neutral-800 rounded-2xl">
                                    <div className={`p-3 rounded-full ${identity?.publicKey ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                        <Shield className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-bold">{identity?.publicKey ? 'Cryptographic Identity Verified' : 'No Identity Detected'}</p>
                                        <p className="text-xs text-neutral-500 mt-1">
                                            {identity?.publicKey ? 'Your identity is properly configured for decentralized broadcasting and tipping.' : 'You must generate or import an identity to access broadcast features.'}
                                        </p>
                                    </div>
                                </div>

                                {/* Public Key Display */}
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                        <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Public App ID (ED25519)</label>
                                        {identity?.publicKey && (
                                            <span className="text-[10px] text-green-500 font-mono">PROTOCOL READY</span>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            readOnly
                                            value={identity?.publicKey || (isIdentityLoading ? "Loading identity..." : "No identity - generate one below")}
                                            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm font-mono text-neutral-300 select-all focus:border-purple-500 outline-none transition-colors"
                                        />
                                        <button
                                            onClick={() => {
                                                if (identity?.publicKey) {
                                                    navigator.clipboard.writeText(identity.publicKey);
                                                    showToast('Public key copied to clipboard!', 'success');
                                                } else {
                                                    showToast('No public key available', 'error');
                                                }
                                            }}
                                            className="bg-neutral-800 hover:bg-neutral-700 px-6 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
                                            disabled={!identity?.publicKey}
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </div>

                                <div className={`border rounded-xl p-5 ${identity?.nip05Verified ? 'bg-green-600/10 border-green-500/20' : 'bg-blue-600/10 border-blue-500/20'}`}>
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className={`p-2 rounded-lg ${identity?.nip05Verified ? 'bg-green-500/20' : 'bg-blue-500/20'}`}>
                                            {identity?.nip05Verified ? <ShieldCheck className="w-5 h-5 text-green-400" /> : <AtSign className="w-5 h-5 text-blue-400" />}
                                        </div>
                                        <div className="flex-1">
                                            <h4 className={`text-sm font-bold tracking-tight ${identity?.nip05Verified ? 'text-green-300' : 'text-blue-300'}`}>
                                                {identity?.nip05Verified ? 'Identity Verified' : 'What is NIP-05 Verification?'}
                                            </h4>
                                            <p className={`text-[11px] leading-tight ${identity?.nip05Verified ? 'text-green-300/60' : 'text-blue-300/60'}`}>
                                                {identity?.nip05Verified ? `Verified as ${identity.nip05}` : 'Secure your brand on the Nostr network.'}
                                            </p>
                                        </div>
                                        {identity?.nip05Verified && (
                                            <div className="bg-green-500/20 text-green-500 text-[10px] font-bold px-2 py-1 rounded border border-green-500/30">
                                                ACTIVE
                                            </div>
                                        )}
                                    </div>
                                    {!identity?.nip05Verified && (
                                        <p className="text-xs text-blue-200/80 leading-relaxed mb-4">
                                            NIP-05 allows you to verify your identity through a domain name (like <strong>user@domain.com</strong>). It acts as a decentralized "Blue Checkmark" so viewers know it's really you.
                                        </p>
                                    )}
                                    <button
                                        onClick={() => setShowProfileEditor(true)}
                                        className={`w-full border py-2.5 rounded-lg text-xs font-bold transition-all ${identity?.nip05Verified ? 'bg-green-600/10 hover:bg-green-600/20 text-green-400 border-green-600/30' : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border-blue-600/30'}`}
                                    >
                                        {identity?.nip05Verified ? 'Update NIP-05 Settings' : 'Configure NIP-05 in Profile Editor'}
                                    </button>
                                </div>

                                {/* Identity Actions */}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setIsP2PEnabled(!isP2PEnabled)}
                                        className={`px-3 py-1 rounded text-xs font-bold ${isP2PEnabled
                                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50'
                                            : 'bg-neutral-800 text-neutral-400 border border-neutral-700 hover:bg-neutral-700'
                                            }`}
                                    >
                                        {isP2PEnabled ? 'P2P ON' : 'P2P OFF'}
                                    </button>
                                    <button
                                        onClick={() => setShowCaptions(!showCaptions)}
                                        className={`px-3 py-1 rounded text-xs font-bold ${showCaptions
                                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                                            : 'bg-neutral-800 text-neutral-400 border border-neutral-700 hover:bg-neutral-700'
                                            }`}
                                    >
                                        {showCaptions ? 'CAPTIONS ON' : 'CAPTIONS OFF'}
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        onClick={() => {
                                            if (!identity?.privateKey) {
                                                showToast('No identity found. Generate one first.', 'error');
                                                return;
                                            }
                                            try {
                                                const comprehensiveProfile = {
                                                    version: '2.0',
                                                    exportedAt: new Date().toISOString(),
                                                    identity: { ...identity },
                                                    broadcastSettings: {
                                                        streamKey, streamName, description, tags,
                                                        contentWarning, language, streamPrice,
                                                        streamDuration, escrowAmount, selectedCamera,
                                                        selectedMic, videoEnabled, audioEnabled
                                                    }
                                                };
                                                const data = JSON.stringify(comprehensiveProfile, null, 2);
                                                const blob = new Blob([data], { type: 'application/json' });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = `dstream-full-profile-${identity.publicKey.substring(0, 8)}.json`;
                                                a.click();
                                                URL.revokeObjectURL(url);
                                                showToast('Complete profile exported successfully!', 'success');
                                            } catch (err) {
                                                showToast('Failed to export profile', 'error');
                                            }
                                        }}
                                        className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-4 rounded-xl font-bold text-sm transition-all border border-neutral-700 active:scale-95 flex flex-col items-center gap-1"
                                    >
                                        <span className="text-purple-400">Export Profile</span>
                                        <span className="text-[10px] font-normal opacity-50">Identity + All Settings</span>
                                    </button>
                                    <button
                                        onClick={() => {
                                            const input = document.createElement('input');
                                            input.type = 'file';
                                            input.accept = '.json';
                                            input.onchange = (e) => {
                                                const file = (e.target as HTMLInputElement).files?.[0];
                                                if (file) {
                                                    const reader = new FileReader();
                                                    reader.onload = (event) => {
                                                        try {
                                                            const data = JSON.parse(event.target?.result as string);
                                                            if (data.identity) {
                                                                // New format
                                                                localStorage.setItem('dstream_identity', JSON.stringify(data.identity));
                                                                if (data.identity.nostrPrivateKey) localStorage.setItem('nostr_key', data.identity.nostrPrivateKey);
                                                                if (data.broadcastSettings) localStorage.setItem('dstream_broadcast_settings', JSON.stringify(data.broadcastSettings));
                                                                showToast('Full profile imported! Reloading...', 'success');
                                                            } else if (data.privateKey && data.publicKey) {
                                                                // Legacy format
                                                                localStorage.setItem('dstream_identity', JSON.stringify(data));
                                                                if (data.nostrPrivateKey) localStorage.setItem('nostr_key', data.nostrPrivateKey);
                                                                showToast('Identity imported! Reloading...', 'success');
                                                            } else {
                                                                showToast('Invalid profile format', 'error');
                                                                return;
                                                            }
                                                            setTimeout(() => window.location.reload(), 1500);
                                                        } catch (err) {
                                                            showToast('Failed to parse file', 'error');
                                                        }
                                                    };
                                                    reader.readAsText(file);
                                                }
                                            };
                                            input.click();
                                        }}
                                        className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-4 rounded-xl font-bold text-sm transition-all border border-neutral-700 active:scale-95 flex flex-col items-center gap-1"
                                    >
                                        <span className="text-purple-400">Import Profile</span>
                                        <span className="text-[10px] font-normal opacity-50">Replace Current Profile</span>
                                    </button>
                                </div>

                                <button
                                    onClick={() => {
                                        if (confirm('⚠️ WARNING: Generate a new identity?\n\nThis will permanently replace your current identity on this device. Make sure you have exported your current profile if you want to keep it!')) {
                                            createIdentity().then(() => {
                                                showToast('New identity generated! Reloading...', 'success');
                                                setTimeout(() => window.location.reload(), 1500);
                                            });
                                        }
                                    }}
                                    className="w-full bg-red-900/20 hover:bg-red-900/40 text-red-500 border border-red-500/20 py-4 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
                                >
                                </button>
                            </div>
                        </div>
                    ) : activeTab === "messages" ? (
                        <div className="bg-neutral-900 rounded-xl p-8 border border-neutral-800 shadow-xl min-h-[400px] flex flex-col items-center justify-center text-center">
                            <div className="p-4 bg-purple-500/10 rounded-full mb-4">
                                <Mail className="w-12 h-12 text-purple-500" />
                            </div>
                            <h3 className="text-2xl font-bold mb-2">Private Messaging</h3>
                            <p className="text-neutral-400 mb-6 max-w-sm">
                                Secure, end-to-end encrypted DMs via Nostr. Chat privately with your viewers and other broadcasters.
                            </p>
                            <button
                                onClick={openInbox}
                                className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-3 rounded-xl font-bold transition-all active:scale-95"
                            >
                                Open Inbox
                            </button>
                        </div>
                    ) : activeTab === "moderation" ? (
                        <div className="bg-neutral-900 rounded-xl p-8 border border-neutral-800 shadow-xl">
                            <ModerationView />
                        </div>
                    ) : activeTab === "chat" ? (
                        <div className="bg-neutral-900 rounded-xl border border-neutral-800 shadow-xl overflow-hidden">
                            {isLive ? (
                                <ChatBox
                                    channel={currentStreamId || streamKey}
                                    pubkey={identity?.nostrPublicKey}
                                    broadcasterPubkey={identity?.nostrPublicKey}
                                    adminPubkeys={[]}
                                />
                            ) : (
                                <div className="p-8 text-center min-h-[400px] flex flex-col items-center justify-center">
                                    <div className="p-4 bg-green-500/10 rounded-full mb-4">
                                        <MessageSquare className="w-12 h-12 text-green-500" />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-2">Stream Chat</h3>
                                    <p className="text-neutral-400 max-w-sm">
                                        Chat will be available once you go live. Your viewers will be able to send messages here.
                                    </p>
                                </div>
                            )}
                        </div>
                    ) : (<>
                        <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                            <h3 className="font-bold mb-4 flex items-center gap-2">
                                <Settings className="w-4 h-4" />
                                Stream Settings
                            </h3>

                            <div className="space-y-6">
                                {/* Stream Info Section */}
                                <div className="space-y-4">
                                    <h4 className="text-xs text-purple-400 font-bold uppercase tracking-wider border-b border-neutral-800 pb-2">Stream Information</h4>
                                    <div>
                                        <label className="block text-sm text-neutral-400 mb-2">Stream Title</label>
                                        <input
                                            type="text"
                                            value={streamName}
                                            onChange={(e) => setStreamName(e.target.value)}
                                            className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-white focus:border-purple-500 transition"
                                            placeholder="My Awesome Stream"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-neutral-400 mb-2">Description <span className="text-neutral-600">({description.length}/150)</span></label>
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value.substring(0, 150))}
                                            className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-white focus:border-purple-500 min-h-[80px] resize-none transition"
                                            placeholder="What's your stream about?"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm text-neutral-400 mb-2">Tags</label>
                                            <input
                                                type="text"
                                                value={tags}
                                                onChange={(e) => setTags(e.target.value)}
                                                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm"
                                                placeholder="gaming, crypto"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm text-neutral-400 mb-2">Language</label>
                                            <select
                                                value={language}
                                                onChange={(e) => setLanguage(e.target.value)}
                                                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2"
                                            >
                                                <option value="en">English</option>
                                                <option value="es">Spanish</option>
                                                <option value="de">German</option>
                                                <option value="fr">French</option>
                                                <option value="ja">Japanese</option>
                                                <option value="ko">Korean</option>
                                                <option value="zh">Chinese</option>
                                                <option value="pt">Portuguese</option>
                                                <option value="ru">Russian</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm text-neutral-400 mb-2">Content Warning <span className="text-neutral-600">(optional)</span></label>
                                        <input
                                            type="text"
                                            value={contentWarning}
                                            onChange={(e) => setContentWarning(e.target.value)}
                                            className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm"
                                            placeholder="e.g., Strong language, adult themes"
                                        />
                                    </div>
                                </div>

                                {/* Devices Section */}
                                <div className="space-y-4">
                                    <h4 className="text-xs text-blue-400 font-bold uppercase tracking-wider border-b border-neutral-800 pb-2">Devices</h4>
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="block text-sm text-neutral-400">Camera</label>
                                            <button
                                                onClick={startScreenShare}
                                                className="text-xs bg-purple-900/50 text-purple-300 px-2 py-1 rounded hover:bg-purple-800 transition"
                                            >
                                                Share Screen
                                            </button>
                                        </div>
                                        <select
                                            value={selectedCamera}
                                            onChange={e => setSelectedCamera(e.target.value)}
                                            className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2"
                                            disabled={selectedCamera === "screen"}
                                        >
                                            {selectedCamera === "screen" && <option value="screen">🖥️ Screen Share</option>}
                                            {cameras.map(cam => (
                                                <option key={cam.deviceId} value={cam.deviceId}>{cam.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm text-neutral-400 mb-2">Microphone</label>
                                        <select
                                            value={selectedMic}
                                            onChange={e => setSelectedMic(e.target.value)}
                                            className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2"
                                        >
                                            {mics.map(mic => (
                                                <option key={mic.deviceId} value={mic.deviceId}>{mic.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* Advanced Section */}
                                <div className="space-y-4">
                                    <h4 className="text-xs text-orange-400 font-bold uppercase tracking-wider border-b border-neutral-800 pb-2">Advanced</h4>
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="block text-sm text-neutral-400">Stream Key</label>
                                            <button
                                                onClick={() => identity && setStreamKey(`user-${identity.publicKey.substring(0, 8)}`)}
                                                className="text-xs bg-neutral-800 text-neutral-400 hover:text-white px-2 py-1 rounded transition"
                                                disabled={!identity}
                                            >
                                                Use Identity
                                            </button>
                                        </div>
                                        <input
                                            type="text"
                                            value={streamKey}
                                            onChange={e => setStreamKey(e.target.value)}
                                            className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 font-mono text-sm"
                                            placeholder="my-stream"
                                        />
                                        <p className="text-xs text-neutral-600 mt-1">Unique identifier for your stream channel</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* OBS Connection Info */}
                        <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                            <h3 className="font-bold mb-4 flex items-center gap-2">
                                <Radio className="w-4 h-4 text-red-500" />
                                Connect via OBS / Streamlabs
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm text-neutral-400 mb-1">RTMP Server URL</label>
                                    <div className="flex gap-2">
                                        <input readOnly value="rtmp://dstream.stream/live" className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm font-mono text-neutral-400" />
                                        <button onClick={() => navigator.clipboard.writeText("rtmp://dstream.stream/live")} className="bg-neutral-800 hover:bg-neutral-700 px-3 rounded text-xs text-white">Copy</button>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm text-neutral-400 mb-1">Stream Key</label>
                                    <div className="flex gap-2">
                                        <input readOnly type="password" value={streamKey} className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm font-mono text-neutral-400" />
                                        <button onClick={() => navigator.clipboard.writeText(streamKey)} className="bg-neutral-800 hover:bg-neutral-700 px-3 rounded text-xs text-white">Copy</button>
                                    </div>
                                </div>
                                <p className="text-xs text-neutral-500">
                                    Paste these into OBS Settings &gt; Stream &gt; Custom...
                                </p>
                            </div>
                        </div>

                        {/* Go Live Controls with Escrow Input */}
                        {!isLive ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm text-neutral-400 mb-2">Wallet Address (XMR)</label>
                                    <input
                                        type="text"
                                        value={identity?.moneroAddress || ""}
                                        onChange={(e) => updateIdentity({ moneroAddress: e.target.value })}
                                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 font-mono text-xs"
                                        placeholder="4... or 8... (Subaddress)"
                                    />
                                    {(() => {
                                        const validation = identity?.moneroAddress ? validateMoneroAddress(identity.moneroAddress) : { valid: false, type: 'invalid', warning: undefined };
                                        if (identity?.moneroAddress && !validation.valid) {
                                            return <p className="text-xs text-red-500 mt-1">Invalid Monero Address format</p>;
                                        }
                                        // Cast to access optional warning
                                        if ((validation as any).warning) {
                                            return <p className="text-xs text-yellow-500 mt-1 flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> {(validation as any).warning}</p>;
                                        }
                                        return <p className="text-xs text-neutral-500 mt-1">Required to receive stakes.</p>;
                                    })()}
                                </div>

                                <div>
                                    <label className="block text-sm text-neutral-400 mb-2">Escrow Fee (XMR)</label>
                                    <input
                                        type="number"
                                        step="0.001"
                                        value={escrowAmount}
                                        onChange={(e) => setEscrowAmount(parseFloat(e.target.value))}
                                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 font-mono"
                                        placeholder="0.01"
                                    />
                                    <p className="text-xs text-neutral-500 mt-1">Anti-leech stake required for unverified viewers.</p>
                                </div>

                                {/* Monetization Section */}
                                <div className="pt-4 border-t border-neutral-800">
                                    <h4 className="text-sm font-bold text-neutral-300 mb-3 flex items-center gap-2">
                                        <span className="text-green-500">$</span> Admission Fee (Optional)
                                    </h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm text-neutral-400 mb-2">Price (XMR)</label>
                                            <input
                                                type="number"
                                                step="0.001"
                                                value={streamPrice}
                                                onChange={(e) => setStreamPrice(parseFloat(e.target.value))}
                                                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-green-400 font-mono"
                                                placeholder="0"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm text-neutral-400 mb-2">Access Duration (Hours)</label>
                                            <input
                                                type="number"
                                                value={streamDuration}
                                                onChange={(e) => setStreamDuration(parseInt(e.target.value))}
                                                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 font-mono"
                                                placeholder="24"
                                                disabled={streamPrice === 0}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-xs text-neutral-500 mt-2">
                                        {streamPrice > 0
                                            ? `Viewers must pay ${streamPrice} XMR to watch for ${streamDuration} hours.`
                                            : "Stream is free to watch (standard escrow may still apply)."}
                                    </p>
                                </div>

                                {/* Note about Settings */}
                                <p className="text-xs text-neutral-600 text-center py-2">
                                    ℹ️ Configure stream title, description, and tags in the <button onClick={() => setActiveTab("settings")} className="text-purple-400 hover:underline">Settings</button> tab.
                                </p>

                                <button
                                    onClick={goLive}
                                    disabled={!hasPermission || (!!identity && !identity.moneroAddress)}
                                    className="w-full py-4 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 disabled:opacity-50 rounded-xl font-bold text-lg flex items-center justify-center gap-2"
                                >
                                    <Radio className="w-5 h-5" />
                                    Go Live
                                </button>

                            </div>
                        ) : (
                            <div className="space-y-4">
                                <button
                                    onClick={stopStream}
                                    className="w-full py-4 bg-neutral-800 hover:bg-neutral-700 rounded-xl font-bold text-lg flex items-center justify-center gap-2"
                                >
                                    <Square className="w-5 h-5 fill-current" />
                                    End Stream
                                </button>

                                <div className="bg-neutral-800/50 p-4 rounded-lg border border-neutral-700 text-center">
                                    <span className="text-sm text-neutral-400">Current Escrow Fee:</span>
                                    <span className="block text-xl font-mono font-bold text-white">{escrowAmount} XMR</span>
                                </div>
                            </div>
                        )}
                        {isLive && (
                            <div className="bg-green-900/30 border border-green-600 rounded-xl p-4">
                                <p className="font-bold text-green-400 mb-2">You're Live!</p>
                                <p className="text-sm text-neutral-400 mb-3">
                                    Your stream is available at:
                                </p>
                                <div className="mt-2 bg-neutral-950 p-2 rounded border border-neutral-700 font-mono text-xs break-all select-all text-neutral-300">
                                    {typeof window !== 'undefined' ? `${window.location.origin}/watch/${currentStreamId || streamKey}` : `/watch/${currentStreamId || streamKey}`}
                                </div>
                                <div className="mt-2 flex gap-2">
                                    <Link
                                        href={`/watch/${currentStreamId || streamKey}`}
                                        target="_blank"
                                        className="flex-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 py-2 rounded text-sm font-medium flex items-center justify-center gap-2"
                                    >
                                        <Eye className="w-4 h-4" />
                                        Watch Stream
                                    </Link>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(`${window.location.origin}/watch/${currentStreamId || streamKey}`);
                                            // Optional: simple alert or toast if we had one, but copy works silently
                                        }}
                                        className="px-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-sm font-medium"
                                        title="Copy Link"
                                    >
                                        Copy
                                    </button>
                                </div>
                            </div>
                        )}

                        {!isLive && (
                            <div className="text-xs text-neutral-600 text-center">
                                Your stream will be announced to the network.
                                To send video, use OBS with RTMP: rtmp://localhost:1940/{currentStreamId || '...'}
                            </div>
                        )}
                    </>
                    )}
                </div>
            </div>

            {/* Toast Notification */}
            {toast && (
                <div className={`fixed bottom-6 right-6 px-6 py-4 rounded-lg shadow-2xl border-2 flex items-center gap-3 animate-slide-in-right z-50 ${toast.type === 'success'
                    ? 'bg-green-900/90 border-green-500 text-green-100'
                    : 'bg-red-900/90 border-red-500 text-red-100'
                    }`}>
                    {toast.type === 'success' ? (
                        <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-xs">✓</div>
                    ) : (
                        <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-white font-bold text-xs">!</div>
                    )}
                    <span className="font-medium">{toast.message}</span>
                </div>
            )}

            {/* Modals */}
            <ProfileEditor isOpen={showProfileEditor} onClose={() => setShowProfileEditor(false)} />
        </div>
    );
}
