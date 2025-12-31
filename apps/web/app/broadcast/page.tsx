"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Video, Mic, MicOff, VideoOff, Radio, Settings, Eye, Wifi, WifiOff, Square, RefreshCw } from "lucide-react";
import { IdentityBadge } from "@/components/identity/IdentityBadge";
import { useIdentity } from "@/context/IdentityContext";
import { WHIPClient } from "@/lib/whipClient";
import { finalizeEvent } from "nostr-tools";
import { publishEvent, KIND_STREAM_ANNOUNCE, minePow } from "@/lib/nostr";
import { deriveStreamPath } from "@/lib/streamId";
import { validateMoneroAddress } from "@/lib/monero";
import { ShieldAlert } from "lucide-react";

interface MediaDevice {
    deviceId: string;
    label: string;
}

export default function BroadcastPage() {
    const { identity, createIdentity, updateIdentity, sign, signNostrEvent } = useIdentity();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isLive, setIsLive] = useState(false);
    const [streamKey, setStreamKey] = useState("my-stream");
    // Enhanced Metadata State
    const [streamName, setStreamName] = useState("");
    const [description, setDescription] = useState("");
    const [tags, setTags] = useState(""); // Comma separated
    const [contentWarning, setContentWarning] = useState("");
    const [language, setLanguage] = useState("en");
    // Monetization
    const [streamPrice, setStreamPrice] = useState(0); // XMR
    const [streamDuration, setStreamDuration] = useState(24); // Hours default
    const [escrowAmount, setEscrowAmount] = useState(0.01);
    const [currentStreamId, setCurrentStreamId] = useState<string | null>(null); // Identity-bound path

    // Persist Stream Key
    useEffect(() => {
        const stored = localStorage.getItem("dstream_key");
        if (stored) setStreamKey(stored);
    }, []);

    useEffect(() => {
        localStorage.setItem("dstream_key", streamKey);
    }, [streamKey]);

    // Persist ALL Broadcast Settings
    const [settingsLoaded, setSettingsLoaded] = useState(false);

    useEffect(() => {
        const settings = localStorage.getItem("dstream_settings");
        if (settings) {
            try {
                const parsed = JSON.parse(settings);
                if (parsed.streamName) setStreamName(parsed.streamName);
                if (parsed.description) setDescription(parsed.description);
                if (parsed.tags) setTags(parsed.tags);
                if (parsed.language) setLanguage(parsed.language);
                if (parsed.contentWarning) setContentWarning(parsed.contentWarning);
                if (typeof parsed.escrowAmount === 'number') setEscrowAmount(parsed.escrowAmount);
                if (typeof parsed.streamPrice === 'number') setStreamPrice(parsed.streamPrice);
                if (typeof parsed.streamDuration === 'number') setStreamDuration(parsed.streamDuration);
            } catch (e) {
                console.warn("Failed to parse stored settings");
            }
        }
        setSettingsLoaded(true); // Mark as loaded AFTER restoring
    }, []);

    // Save settings on change (only after initial load)
    useEffect(() => {
        if (!settingsLoaded) return; // Don't save until we've loaded first
        const settings = {
            streamName,
            description,
            tags,
            language,
            contentWarning,
            escrowAmount,
            streamPrice,
            streamDuration
        };
        localStorage.setItem("dstream_settings", JSON.stringify(settings));
    }, [settingsLoaded, streamName, description, tags, language, contentWarning, escrowAmount, streamPrice, streamDuration]);


    // Media state
    const [hasPermission, setHasPermission] = useState(false);
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [cameras, setCameras] = useState<MediaDevice[]>([]);
    const [mics, setMics] = useState<MediaDevice[]>([]);
    const [selectedCamera, setSelectedCamera] = useState("");
    const [selectedMic, setSelectedMic] = useState("");
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [whipStatus, setWhipStatus] = useState<"idle" | "connecting" | "streaming" | "error">("idle");
    const whipClientRef = useRef<WHIPClient | null>(null);

    // Rate limiting state (60s cooldown between broadcasts)
    const [lastBroadcastTime, setLastBroadcastTime] = useState<number>(0);
    const BROADCAST_COOLDOWN_MS = 60_000; // 60 seconds

    // Get available devices
    useEffect(() => {
        const getDevices = async () => {
            try {
                // 1. Try requesting both permissions
                let stream: MediaStream | undefined;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    setHasPermission(true);
                } catch (err: any) {
                    console.warn("Combined access failed, trying individual:", err.name);
                    // Fallback: Try Audio Only (common if no webcam)
                    try {
                        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        setHasPermission(true);
                    } catch (audioErr) {
                        // Try Video Only
                        try {
                            stream = await navigator.mediaDevices.getUserMedia({ video: true });
                            setHasPermission(true);
                        } catch (videoErr) {
                            throw err; // Throw original error if nothing works
                        }
                    }
                }

                if (stream) stream.getTracks().forEach(t => t.stop());

            } catch (err: any) {
                console.error("Permission request failed:", err);
                // Don't set global error yet, let enumeration try
                if (err.name === 'NotFoundError') {
                    // This specifically means no devices found for criteria
                    // We'll still enumerate and see what the browser reports
                } else if (err.name === 'NotAllowedError') {
                    setError("Camera/Mic access denied. Reset permissions in address bar.");
                }
            }

            // 2. Always enumerate devices
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                let videoDevices = devices.filter(d => d.kind === 'videoinput');
                let audioDevices = devices.filter(d => d.kind === 'audioinput');

                // FALLBACK: If enumeration returns empty (common privacy feature) but we got a stream,
                // blindly add a "Default" device so the UI works.
                if (videoDevices.length === 0) {
                    // Even if hasPermission is false, we might want to show this if we suspect
                    // BUT safe to assume if stream existed above, we are good.
                    // For safety, let's just ALWAYS add it if list is empty, 
                    // relying on getUserMedia to fail later if truly no device.
                    console.warn("Enumeration empty. Adding default camera fallback.");
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

                // Default selection
                if (videoDevices.length > 0) {
                    const physicalCamera = videoDevices.find(d =>
                        d.label.toLowerCase().includes('facetime') ||
                        d.label.toLowerCase().includes('built-in') ||
                        d.label.toLowerCase().includes('webcam') ||
                        !d.label.toLowerCase().includes('virtual') &&
                        !d.label.toLowerCase().includes('immersed') &&
                        !d.label.toLowerCase().includes('obs')
                    );
                    setSelectedCamera(physicalCamera?.deviceId || videoDevices[0].deviceId);
                }
                if (audioDevices.length > 0) {
                    const physicalMic = audioDevices.find(d =>
                        d.label.toLowerCase().includes('built-in') ||
                        d.label.toLowerCase().includes('macbook') ||
                        !d.label.toLowerCase().includes('virtual') &&
                        !d.label.toLowerCase().includes('immersed')
                    );
                    setSelectedMic(physicalMic?.deviceId || audioDevices[0].deviceId);
                }
            } catch (enumErr) {
                console.error("Enumerate devices failed:", enumErr);
                // Fallback for catastrophic enumeration failure
                // @ts-ignore
                setCameras([{ deviceId: "default", label: "Default Camera" }]);
                // @ts-ignore
                setMics([{ deviceId: "default", label: "Default Mic" }]);
                setSelectedCamera("default");
                setSelectedMic("default");
            }
        };
        getDevices();
    }, []);

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
            if (isLive && whipClientRef.current) {
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
                whipClientRef.current.disconnect();
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isLive, identity, streamKey, currentStreamId]);

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
            await createIdentity();
            // Wait for state update - createIdentity is async so we need to grab fresh value
            // For now, we'll use a fallback
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
                        ['image', "https://via.placeholder.com/1280x720.png?text=dStream+Live"],
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

            // Proceed if either succeeded, OR if we are just testing (allow soft fail)
            if (registrySuccess || nostrSuccess || true) {
                setIsLive(true);
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

                        const whipClient = new WHIPClient(derivedPath, authParams);
                        whipClientRef.current = whipClient;
                        await whipClient.connect(stream);
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
        if (whipClientRef.current) {
            whipClientRef.current.disconnect();
            whipClientRef.current = null;
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

        setIsLive(false);
        console.log(`Stream "${streamKey}" ended`);
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-white">
            <header className="border-b border-neutral-800 p-6">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <Link href="/" className="text-2xl font-black tracking-tighter bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                        dStream
                    </Link>
                    <div className="flex gap-4 items-center">
                        <IdentityBadge />
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-6">
                <h1 className="text-3xl font-bold mb-6 flex items-center gap-3">
                    <Radio className="w-8 h-8 text-purple-500" />
                    Go Live
                </h1>

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

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Preview */}
                    <div className="lg:col-span-2">
                        <div className="relative aspect-video bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800">
                            <video
                                ref={videoRef}
                                autoPlay
                                muted
                                playsInline
                                className={`w-full h-full object-cover ${!videoEnabled ? 'opacity-0' : ''}`}
                            />

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

                            {isLive && (
                                <div className="absolute top-4 left-4 flex gap-2">
                                    <div className="bg-red-600 text-white text-sm font-bold px-3 py-1 rounded-full flex items-center gap-2">
                                        <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                        LIVE
                                    </div>
                                    <div className={`text-sm font-medium px-3 py-1 rounded-full flex items-center gap-2 ${whipStatus === 'streaming' ? 'bg-green-600' :
                                        whipStatus === 'connecting' ? 'bg-yellow-600' :
                                            whipStatus === 'error' ? 'bg-red-800' : 'bg-neutral-700'
                                        }`}>
                                        {whipStatus === 'streaming' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                                        {whipStatus === 'streaming' ? 'WebRTC' :
                                            whipStatus === 'connecting' ? 'Connecting...' :
                                                whipStatus === 'error' ? 'Fallback: OBS' : 'No WebRTC'}
                                    </div>
                                </div>
                            )}

                            {/* Controls */}
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                                <button
                                    onClick={toggleVideo}
                                    className={`p-3 rounded-full ${videoEnabled ? 'bg-neutral-800 hover:bg-neutral-700' : 'bg-red-600 hover:bg-red-700'}`}
                                >
                                    {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={toggleAudio}
                                    className={`p-3 rounded-full ${audioEnabled ? 'bg-neutral-800 hover:bg-neutral-700' : 'bg-red-600 hover:bg-red-700'}`}
                                >
                                    {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Settings */}
                    <div className="space-y-6">
                        <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                            <h3 className="font-bold mb-4 flex items-center gap-2">
                                <Settings className="w-4 h-4" />
                                Stream Settings
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="block text-sm text-neutral-400">Stream Key</label>
                                        <button
                                            onClick={() => identity && setStreamKey(`user-${identity.publicKey.substring(0, 8)}`)}
                                            className="text-xs bg-neutral-800 text-neutral-400 hover:text-white px-2 py-1 rounded transition"
                                            disabled={!identity}
                                            title="Use my ID"
                                        >
                                            Use Identity
                                        </button>
                                    </div>
                                    <input
                                        type="text"
                                        value={streamKey}
                                        onChange={e => setStreamKey(e.target.value)}
                                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2"
                                        placeholder="my-stream"
                                    />
                                </div>

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

                                <div className="space-y-4 pt-4 border-t border-neutral-800">
                                    <div>
                                        <label className="block text-sm text-neutral-400 mb-2">Stream Title</label>
                                        <input
                                            type="text"
                                            value={streamName}
                                            onChange={(e) => setStreamName(e.target.value)}
                                            className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2"
                                            placeholder="My Awesome Stream"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm text-neutral-400 mb-2">Description (150 chars)</label>
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value.substring(0, 150))}
                                            className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 h-20 resize-none"
                                            placeholder="What are you streaming about?"
                                        />
                                        <p className="text-xs text-right text-neutral-500">{description.length}/150</p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm text-neutral-400 mb-2">Tags (comma sep)</label>
                                            <input
                                                type="text"
                                                value={tags}
                                                onChange={(e) => setTags(e.target.value)}
                                                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2"
                                                placeholder="gaming, crypto, irl"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm text-neutral-400 mb-2">Language</label>
                                            <select
                                                value={language}
                                                onChange={(e) => setLanguage(e.target.value)}
                                                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2"
                                            >
                                                <option value="en">English 🇺🇸</option>
                                                <option value="es">Spanish 🇪🇸</option>
                                                <option value="pt">Portuguese 🇧🇷</option>
                                                <option value="fr">French 🇫🇷</option>
                                                <option value="de">German 🇩🇪</option>
                                                <option value="jp">Japanese 🇯🇵</option>
                                                <option value="cn">Chinese 🇨🇳</option>
                                                <option value="ru">Russian 🇷🇺</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm text-neutral-400 mb-2">Content Warning (Optional)</label>
                                        <input
                                            type="text"
                                            value={contentWarning}
                                            onChange={(e) => setContentWarning(e.target.value)}
                                            className="w-full bg-neutral-950 border border-red-900/30 rounded-lg px-3 py-2 text-red-200 placeholder-red-900/50 focus:border-red-600"
                                            placeholder="NSFW, Sensitive, etc."
                                        />
                                    </div>

                                    {/* Monetization Section */}
                                    <div className="pt-4 border-t border-neutral-800">
                                        <h4 className="text-sm font-bold text-neutral-300 mb-3 flex items-center gap-2">
                                            <span className="text-green-500">$</span> Admission Fee
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
                                </div>

                                <button
                                    onClick={goLive}
                                    disabled={!hasPermission || !identity?.moneroAddress}
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
                    </div>
                </div>
            </main>
        </div>
    );
}
