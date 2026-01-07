"use client";

import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { AlertCircle, Play, Pause, Volume2, VolumeX, PictureInPicture2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { P2PStats } from "./P2PStats";
import { P2P_CONFIG } from "@/lib/config";
import { startClusterMonitoring, getOptimizedTrackers, updateSwarmHealth, type ClusterInfo } from "@/lib/p2p";

interface VideoPlayerProps {
    src: string;
    className?: string;
    autoPlay?: boolean;
}

export function VideoPlayer({ src, className, autoPlay = true }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const MAX_RECONNECT_ATTEMPTS = 10;

    // Stats State
    const [peers, setPeers] = useState(0);
    const [downloadSpeed, setDownloadSpeed] = useState(0);
    const [uploadSpeed, setUploadSpeed] = useState(0);
    const [totalP2P, setTotalP2P] = useState(0);
    const [totalHTTP, setTotalHTTP] = useState(0);

    // Cluster State
    const [cluster, setCluster] = useState<ClusterInfo | null>(null);

    // Integrity State
    const [manifest, setManifest] = useState<any>(null);
    const manifestRef = useRef<any>(null);
    useEffect(() => { manifestRef.current = manifest; }, [manifest]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Reset error on src change
        setError(null);
        setManifest(null);

        let hls: Hls | null = null;
        let p2pEngine: any = null;
        let manifestInterval: NodeJS.Timeout | null = null;
        let stopClusterMonitor: (() => void) | null = null;
        let p2pInterval: NodeJS.Timeout | null = null;

        const fetchAndVerifyManifest = async () => {
            try {
                const manifestUrl = src.replace('index.m3u8', 'manifest.json');
                const response = await fetch(manifestUrl);
                if (!response.ok) return;

                const data = await response.json();

                // Ed25519 Signature Verification
                if (data.signature && data.channel_pubkey && data.segment_hashes) {
                    try {
                        const { verify } = await import("@noble/ed25519");

                        // Reconstruct signed message (manifest without signature field)
                        const signedData = { ...data };
                        delete signedData.signature;
                        const messageBytes = new TextEncoder().encode(JSON.stringify(signedData));

                        // Parse hex-encoded signature and pubkey
                        const signatureBytes = hexToBytes(data.signature);
                        const pubkeyBytes = hexToBytes(data.channel_pubkey);

                        const isValid = await verify(signatureBytes, messageBytes, pubkeyBytes);

                        if (isValid) {
                            console.log(`[Integrity] Manifest signature VERIFIED from ${data.channel_pubkey.substring(0, 8)}...`);
                            setManifest(data);
                        } else {
                            console.error(`[Integrity] Manifest signature INVALID - rejecting manifest`);
                            setError("Security Alert: Manifest signature verification failed.");
                        }
                    } catch (verifyErr) {
                        console.error("[Integrity] Signature verification error:", verifyErr);
                        // Fail-closed: reject manifest on verification error
                        setError("Security Alert: Unable to verify manifest signature.");
                    }
                } else if (data.segment_hashes) {
                    // No signature present - allow in dev mode with warning
                    console.warn("[Integrity] Manifest has no signature - allowing in dev mode");
                    setManifest(data);
                }
            } catch (e) {
                console.error("Manifest fetch failed:", e);
            }
        };

        // Helper to convert hex string to Uint8Array
        const hexToBytes = (hex: string): Uint8Array => {
            const bytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < hex.length; i += 2) {
                bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
            }
            return bytes;
        };

        // Poll manifest (every 4s matches HLS segment duration approx)
        manifestInterval = setInterval(fetchAndVerifyManifest, 4000);
        fetchAndVerifyManifest();

        const initPlayer = async () => {
            if (Hls.isSupported()) {
                const hlsConfig = {
                    debug: false,
                    enableWorker: true,
                    lowLatencyMode: true,
                    backBufferLength: 90,
                    liveSyncDurationCount: 3,
                };

                try {
                    // Start cluster monitoring for optimized peer selection
                    stopClusterMonitor = startClusterMonitoring((c) => setCluster(c));

                    // Get latency-optimized tracker list
                    const optimizedTrackers = await getOptimizedTrackers();
                    console.log(`[P2P] Using optimized trackers:`, optimizedTrackers);

                    const { HlsJsP2PEngine } = await import("p2p-media-loader-hlsjs");
                    const p2pConfig = {
                        core: {
                            ...P2P_CONFIG.core,
                            trackerAnnounce: optimizedTrackers,
                        }
                    } as any; // P2P loader types are strict, config is validated at runtime
                    p2pEngine = new HlsJsP2PEngine(p2pConfig);
                    hls = new Hls(p2pEngine.getHlsConfig ? p2pEngine.getHlsConfig(hlsConfig) : hlsConfig);
                    p2pEngine.bindHls(hls);
                } catch (e) {
                    console.warn("P2P Load Failed", e);
                    hls = new Hls(hlsConfig);
                }

                if (!hls) return;

                hls.loadSource(src);
                hls.attachMedia(video);

                // --- P2P Events with Swarm Health Tracking ---
                // --- P2P Events with Swarm Health Tracking ---
                if (p2pEngine) {
                    // Handle different library versions (Core vs Engine events)
                    const emitter = typeof p2pEngine.on === 'function' ? p2pEngine :
                        (p2pEngine.getCore && typeof p2pEngine.getCore().on === 'function') ? p2pEngine.getCore() : null;

                    if (emitter) {
                        emitter.on("peer_connect", () => {
                            setPeers(p => {
                                const newCount = p + 1;
                                updateSwarmHealth({ peerCount: newCount });
                                return newCount;
                            });
                        });
                        emitter.on("peer_close", () => {
                            setPeers(p => {
                                const newCount = Math.max(0, p - 1);
                                updateSwarmHealth({ peerCount: newCount });
                                return newCount;
                            });
                        });
                        emitter.on("piece_bytes_downloaded", (method: string, size: number) => {
                            if (method === "p2p") {
                                setTotalP2P(prev => {
                                    const newTotal = prev + size;
                                    updateSwarmHealth({ downloadBytes: newTotal });
                                    return newTotal;
                                });
                                setDownloadSpeed(prev => prev + size);
                            } else {
                                setTotalHTTP(prev => prev + size);
                            }
                        });
                        emitter.on("piece_bytes_uploaded", (method: string, size: number) => {
                            setUploadSpeed(prev => {
                                const newUp = prev + size;
                                updateSwarmHealth({ uploadBytes: newUp });
                                return newUp;
                            });
                        });
                    }
                }

                hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                    if (autoPlay) {
                        video.muted = true;
                        video.play().catch(() => setIsPlaying(false));
                    }
                });

                hls.on(Hls.Events.ERROR, (event, data) => {
                    console.log(`[HLS] Error: ${data.type} / ${data.details}`, data);

                    if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
                        data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR ||
                        data.type === Hls.ErrorTypes.NETWORK_ERROR) {

                        // Check if we've exhausted reconnection attempts
                        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
                            console.log(`[HLS] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
                            setIsReconnecting(false);
                            setError("Stream ended or unavailable. The broadcaster may have stopped streaming.");
                            hls?.destroy();
                            return;
                        }

                        reconnectAttemptsRef.current += 1;
                        console.log(`[HLS] Reconnection attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}`);

                        setIsReconnecting(true);
                        setError(null);

                        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                        reconnectTimeoutRef.current = setTimeout(() => {
                            if (hls) {
                                console.log("[HLS] Attempting reconnection...");
                                hls.startLoad();
                            }
                        }, 3000); // Retry every 3s

                        return;
                    }

                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                hls?.recoverMediaError();
                                break;
                            default:
                                hls?.destroy();
                                setIsReconnecting(false);
                                setError("Unable to load stream. Please try again later.");
                                break;
                        }
                    }
                });

                hls.on(Hls.Events.MANIFEST_LOADED, () => {
                    setIsReconnecting(false);
                    setError(null);
                    reconnectAttemptsRef.current = 0; // Reset counter on success
                    if (reconnectTimeoutRef.current) {
                        clearTimeout(reconnectTimeoutRef.current);
                        reconnectTimeoutRef.current = null;
                    }
                });

                // --- INTEGRITY CHECK (Phase 10) ---
                hls.on(Hls.Events.FRAG_LOADED, async (event, data) => {
                    const currentManifest = manifestRef.current;
                    if (!currentManifest) return;

                    const url = data.frag.relurl || '';
                    // Usually filename like "stream_123.ts" or path.
                    // We match against manifest keys.
                    // Manifest keys are usually filenames in watcher.ts: "files.set(filename, ...)"
                    const filename = url.split('/').pop()?.split('?')[0];

                    if (!filename || !url) return;

                    const expected = currentManifest.segment_hashes.find((s: any) =>
                        s.uri_or_path_hint === filename || s.uri_or_path_hint.endsWith(filename)
                    );

                    if (expected) {
                        try {
                            const buffer = data.payload as ArrayBuffer;
                            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
                            const hashArray = Array.from(new Uint8Array(hashBuffer));
                            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

                            if (hashHex !== expected.sha256_hex) {
                                console.error(`[Integrity] TAMPERING DETECTED for ${filename}. Expected: ${expected.sha256_hex}, Got: ${hashHex}`);
                                hls?.destroy();
                                setError(`Security Alert: Segment ${filename} failed verification.`);
                            } else {
                                // console.log(`[Integrity] Verified ${filename}`);
                            }
                        } catch (err) {
                            console.error("Verification error", err);
                        }
                    }
                });

                setHlsInstance(hls);
            } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = src;
                video.addEventListener("loadedmetadata", () => {
                    if (autoPlay) {
                        video.muted = true;
                        video.play().catch(console.error);
                    }
                });
            } else {
                setError("HLS not supported.");
            }
        };

        initPlayer();

        // Speedometer reset
        p2pInterval = setInterval(() => {
            setDownloadSpeed(0);
            setUploadSpeed(0);
        }, 1000);

        return () => {
            if (manifestInterval) clearInterval(manifestInterval);
            if (p2pInterval) clearInterval(p2pInterval);
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            if (hls) hls.destroy();
            if (p2pEngine) p2pEngine.destroy();
        };
    }, [src, autoPlay]);

    const togglePlay = () => {
        if (!videoRef.current) return;
        if (isPlaying) videoRef.current.pause();
        else videoRef.current.play();
        setIsPlaying(!isPlaying);
    };

    const toggleMute = () => {
        if (!videoRef.current) return;
        videoRef.current.muted = !isMuted;
        setIsMuted(!isMuted);
    };

    const toggleFullscreen = () => {
        if (!videoRef.current) return;
        if (!document.fullscreenElement) {
            videoRef.current.parentElement?.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };

    const [isPiPActive, setIsPiPActive] = useState(false);

    const togglePictureInPicture = async () => {
        const video = videoRef.current;
        if (!video) return;

        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                setIsPiPActive(false);
            } else if (document.pictureInPictureEnabled) {
                await video.requestPictureInPicture();
                setIsPiPActive(true);
            }
        } catch (err) {
            console.error('[PiP] Failed to toggle:', err);
        }
    };

    // Sync PiP state when user exits via browser controls
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onEnterPiP = () => setIsPiPActive(true);
        const onExitPiP = () => setIsPiPActive(false);
        video.addEventListener('enterpictureinpicture', onEnterPiP);
        video.addEventListener('leavepictureinpicture', onExitPiP);
        return () => {
            video.removeEventListener('enterpictureinpicture', onEnterPiP);
            video.removeEventListener('leavepictureinpicture', onExitPiP);
        };
    }, []);

    const [showStats, setShowStats] = useState(false);

    // UI Sync
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onVol = () => setIsMuted(video.muted);
        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('volumechange', onVol);
        return () => {
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('volumechange', onVol);
        };
    }, []);

    return (
        <div className={cn("relative w-full aspect-video bg-black rounded-lg overflow-hidden group", className)}>
            {isReconnecting && !error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20 text-white">
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <p className="font-bold tracking-tight">Reconnecting...</p>
                        <p className="text-xs text-neutral-400">Broadcaster connection dropped or shifting.</p>
                    </div>
                </div>
            )}
            {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20 text-white">
                    <div className="flex flex-col items-center gap-2">
                        <AlertCircle className="w-8 h-8 text-red-500" />
                        <p>{error}</p>
                    </div>
                </div>
            )}
            <video ref={videoRef} className="w-full h-full object-contain" playsInline muted={isMuted} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                <div className="flex items-center gap-4 text-white w-full">
                    <button onClick={togglePlay} className="hover:text-primary transition">
                        {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                    </button>
                    <button onClick={toggleMute} className="hover:text-primary transition">
                        {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
                    </button>
                    <div className="ml-auto flex items-center gap-4">
                        {Hls.isSupported() && !error && (
                            <button
                                onClick={() => setShowStats(!showStats)}
                                className="text-xs font-mono text-gray-300 hover:text-white transition flex items-center gap-1"
                            >
                                {peers > 0 ? (
                                    <>
                                        <span className="text-green-400">●</span> P2P Active ({peers} peers)
                                    </>
                                ) : (
                                    <>
                                        <span className="text-gray-500">●</span> P2P Stats
                                    </>
                                )}
                            </button>
                        )}
                        <button
                            onClick={togglePictureInPicture}
                            className={`hover:text-primary transition ${isPiPActive ? 'text-blue-400' : ''}`}
                            title={isPiPActive ? "Exit Picture-in-Picture" : "Picture-in-Picture"}
                        >
                            <PictureInPicture2 className="w-5 h-5" />
                        </button>
                        <button onClick={toggleFullscreen} className="hover:text-primary transition" title="Fullscreen">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                        </button>
                    </div>
                </div>
                {showStats && Hls.isSupported() && !error && (
                    <P2PStats
                        peers={peers}
                        downloadSpeed={downloadSpeed}
                        uploadSpeed={uploadSpeed}
                        totalP2P={totalP2P}
                        totalHTTP={totalHTTP}
                    />
                )}
            </div>
        </div>
    );
}
