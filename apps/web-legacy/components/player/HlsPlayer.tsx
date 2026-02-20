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
    swarmId?: string; // Critical for P2P discovery across different domains (localhost vs public)
}

export function VideoPlayer({ src, className, autoPlay = true, swarmId }: VideoPlayerProps) {
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

    // Scrubber / Time State
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [seekableRange, setSeekableRange] = useState({ start: 0, end: 0 });

    const formatTime = (time: number) => {
        if (!Number.isFinite(time)) return "00:00";
        const totalSeconds = Math.floor(time);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = Number(e.target.value);
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

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
                // Robustly construct manifest URL
                const manifestUrl = src.includes('/hls/')
                    ? src.replace('/hls/', '/api/hls/').replace('index.m3u8', 'manifest.json')
                    : src.replace('index.m3u8', 'manifest.json');

                console.log(`[Integrity] Fetching manifest from: ${manifestUrl}`);
                const response = await fetch(manifestUrl);

                // Graceful handling of 404/500 (Manifest service might be down or not generated yet)
                if (!response.ok) {
                    console.warn(`[Integrity] Manifest not found (${response.status}). Skipping integrity checks.`);
                    return;
                }

                // Ensure it's JSON before parsing
                const contentType = response.headers.get("content-type");
                if (!contentType || !contentType.includes("application/json")) {
                    console.warn(`[Integrity] Invalid content-type for manifest: ${contentType}. Skipping.`);
                    return;
                }

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
                console.warn("Manifest fetch skipped/failed:", e);
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

        // Guard against race conditions/unmounts
        let isMounted = true;

        const initPlayer = async () => {
            if (!isMounted) return;

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

                    // V2 API: Inject P2P capabilities into Hls class
                    const HlsWithP2P = HlsJsP2PEngine.injectMixin(Hls);

                    const p2pConfig = {
                        core: {
                            ...P2P_CONFIG.core,
                            trackerAnnounce: optimizedTrackers,
                        }
                    } as any;

                    // V2 API: Pass p2p config inside hls config
                    const finalHlsConfig = {
                        ...hlsConfig,
                        p2p: {
                            ...p2pConfig,
                            core: {
                                ...p2pConfig.core,
                                swarmId: swarmId || undefined, // Use provided swarmId or auto-generate
                            }
                        }
                    };

                    console.log(`[P2P] Initializing HlsWithP2P for swarm: ${swarmId || 'auto'}...`);
                    // Initialize the enhanced Hls player
                    hls = new HlsWithP2P(finalHlsConfig) as Hls;

                    // Retrieve engine instance for event listeners
                    p2pEngine = (hls as any).p2pEngine;
                    if (p2pEngine) {
                        console.log("[P2P] Engine successfully attached to Hls.js instance.");
                    } else {
                        console.warn("[P2P] HlsWithP2P created but p2pEngine is missing from instance.");
                    }
                } catch (e) {
                    console.error("[P2P] Engine Load FAILURE - Falling back to HTTP-only HLS", e);
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
            isMounted = false;
            if (manifestInterval) clearInterval(manifestInterval);
            if (p2pInterval) clearInterval(p2pInterval);
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            if (hls) hls.destroy();
            if (p2pEngine) p2pEngine.destroy();
        };
    }, [src, autoPlay, swarmId]);

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
    const containerRef = useRef<HTMLDivElement>(null);

    // ESC Key & Outside click to close stats
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setShowStats(false);
        };
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setShowStats(false);
            }
        };

        if (showStats) {
            window.addEventListener("keydown", handleKeyDown);
            window.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("mousedown", handleClickOutside);
        };
    }, [showStats]);

    // UI Sync & Jump to Live Behavior
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const onPlay = () => {
            setIsPlaying(true);

            // Robust Jump-to-Live behavior
            if (hlsInstance) {
                // Ensure data loading is active (it might stop on pause to save bandwidth)
                hlsInstance.startLoad();

                // Check latency
                const latency = hlsInstance.latency || 0;
                const liveSync = hlsInstance.liveSyncPosition;

                // If latency is significant (> 10s), force jump
                if (latency > 10 && Number.isFinite(liveSync)) {
                    console.log(`[Player] Latency ${latency.toFixed(1)}s detected on resume. Jumping to live edge (${liveSync})...`);
                    // Small timeout to allow buffer update if needed, but direct seek usually works
                    video.currentTime = liveSync as number;
                }
            }
        };
        const onPause = () => setIsPlaying(false);
        const onVol = () => setIsMuted(video.muted);

        const onTimeUpdate = () => {
            setCurrentTime(video.currentTime);
            setDuration(video.duration);
            if (video.seekable.length > 0) {
                setSeekableRange({
                    start: video.seekable.start(0),
                    end: video.seekable.end(0)
                });
            }
        };
        const onLoadedMetadata = () => {
            setDuration(video.duration);
            if (video.seekable.length > 0) {
                setSeekableRange({
                    start: video.seekable.start(0),
                    end: video.seekable.end(0)
                });
            }
        };

        const onProgress = () => {
            if (video.seekable.length > 0) {
                setSeekableRange({
                    start: video.seekable.start(0),
                    end: video.seekable.end(0)
                });
            }
        };

        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('volumechange', onVol);
        video.addEventListener('timeupdate', onTimeUpdate);
        video.addEventListener('loadedmetadata', onLoadedMetadata);
        video.addEventListener('durationchange', onLoadedMetadata);
        video.addEventListener('progress', onProgress);

        return () => {
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('volumechange', onVol);
            video.removeEventListener('timeupdate', onTimeUpdate);
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('durationchange', onLoadedMetadata);
            video.removeEventListener('progress', onProgress);
        };
    }, [hlsInstance]);

    return (
        <div
            ref={containerRef}
            className={cn("relative w-full aspect-video bg-black rounded-lg overflow-hidden group", className)}
        >
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
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col p-4 pt-8">
                {/* Progress Bar Container */}
                <div className="w-full mb-1 group/seeker flex flex-col gap-1">
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={(() => {
                            if (Number.isFinite(duration) && duration > 0) {
                                return (currentTime / duration) * 100;
                            }
                            const range = seekableRange.end - seekableRange.start;
                            if (range <= 0) return 100; // Default to end if no range yet

                            // If very close to end (within 10s), pin to 100
                            if (seekableRange.end - currentTime < 10) return 100;

                            const pct = ((currentTime - seekableRange.start) / range) * 100;
                            return Math.min(100, Math.max(0, pct)) || 0;
                        })()}
                        onChange={(e) => {
                            const pct = Number(e.target.value);
                            if (videoRef.current) {
                                const targetTime = Number.isFinite(duration)
                                    ? (pct / 100 * duration)
                                    : (seekableRange.start + (pct / 100 * (seekableRange.end - seekableRange.start)));

                                // If seeking to the very end (>98%), just jump to live sync
                                if (!Number.isFinite(duration) && pct > 98 && hlsInstance?.liveSyncPosition) {
                                    videoRef.current.currentTime = hlsInstance.liveSyncPosition;
                                } else {
                                    videoRef.current.currentTime = targetTime;
                                }
                                setCurrentTime(videoRef.current.currentTime);
                            }
                        }}
                        step="0.01"
                        className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-500 [&::-webkit-slider-thumb]:shadow-lg hover:h-2 transition-all"
                    />

                    {/* Secondary Row: Go Live & Precise Seek (Only for Live) */}
                    {Hls.isSupported() && hlsInstance && (!Number.isFinite(duration) || duration > 3600 * 24) && (
                        <div className="flex justify-end pr-1 min-h-[24px]">
                            <button
                                onClick={() => {
                                    if (hlsInstance.liveSyncPosition) {
                                        videoRef.current!.currentTime = hlsInstance.liveSyncPosition;
                                    }
                                }}
                                className={cn(
                                    "text-[9px] font-black uppercase px-2 py-1 rounded flex items-center gap-1.5 transition-all transform hover:scale-110 active:scale-95 shadow-[0_0_15px_rgba(59,130,246,0.3)] z-50",
                                    (seekableRange.end - currentTime < 10)
                                        ? "bg-red-600/90 text-white"
                                        : "bg-blue-600 text-white animate-bounce-subtle"
                                )}
                            >
                                <div className={cn("w-1.5 h-1.5 rounded-full shadow-[0_0_5px_white]", (seekableRange.end - currentTime < 10) ? "bg-white animate-pulse" : "bg-white")} />
                                {(seekableRange.end - currentTime < 10) ? "LIVE" : "JUMP TO LIVE"}
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4 text-white w-full mt-1">
                    <button onClick={togglePlay} className="hover:text-blue-400 transition">
                        {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
                    </button>

                    <button onClick={toggleMute} className="hover:text-blue-400 transition">
                        {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
                    </button>

                    {/* Time Display */}
                    <div className="flex items-center gap-3">
                        <div className="text-xs font-mono font-medium text-neutral-200">
                            <span className="text-white font-bold">{formatTime(currentTime)}</span>
                            <span className="mx-1 text-neutral-500">/</span>
                            <span className="text-neutral-400">{Number.isFinite(duration) ? formatTime(duration) : "Live"}</span>
                        </div>
                    </div>

                    <div className="ml-auto flex items-center gap-4">
                        {Hls.isSupported() && !error && (
                            <button
                                onClick={() => setShowStats(!showStats)}
                                className="text-xs font-mono text-gray-300 hover:text-white transition flex items-center gap-1"
                                title="P2P Swarm Status"
                            >
                                <span className={cn("text-xs", peers > 0 ? "text-green-400" : "text-neutral-500")}>●</span>
                                <span className="hidden sm:inline text-neutral-400">P2P: <span className="text-white">{peers}</span> peers</span>
                                <span className="sm:hidden">{peers}</span>
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
