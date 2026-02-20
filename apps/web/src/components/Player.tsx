"use client";
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface PlayerProps {
    src: string;
    autoPlay?: boolean;
    useP2P?: boolean;
    onStatus?: (status: string) => void;
}

export function Player({ src, autoPlay = true, useP2P: enableP2P = true, onStatus }: PlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!src || !videoRef.current) return;

        const initPlayer = async () => {
            // Clean up existing instance
            if (hlsRef.current) {
                hlsRef.current.destroy();
            }

            if (Hls.isSupported()) {
                let HlsConstructor: typeof Hls = Hls;
                let hlsConfig: any = {
                    enableWorker: true,
                    lowLatencyMode: true,
                };

                // Inject P2P if enabled
                if (enableP2P) {
                    try {
                        const { HlsJsP2PEngine } = await import('p2p-media-loader-hlsjs');

                        // v2.x API: Use injectMixin to create enhanced Hls class
                        HlsConstructor = HlsJsP2PEngine.injectMixin(Hls);

                        // P2P configuration goes into the Hls config
                        hlsConfig.p2p = {
                            core: {
                                swarmId: src, // Use stream URL as swarm identifier
                            }
                        };

                        console.log('[Player] P2P Engine injected via mixin');
                    } catch (e) {
                        console.warn('[Player] P2P failed to initialize, falling back to standard HLS:', e);
                        // Fall back to regular Hls
                    }
                }

                const hls = new HlsConstructor(hlsConfig);
                hlsRef.current = hls;

                hls.loadSource(src);
                if (videoRef.current) {
                    hls.attachMedia(videoRef.current);
                }

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    onStatus?.('Playing');
                    if (autoPlay) {
                        videoRef.current?.play().catch(() => {
                            onStatus?.('Click to play');
                        });
                    }
                });

                hls.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                setError('Network error, retrying...');
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                setError('Media error, recovering...');
                                hls.recoverMediaError();
                                break;
                            default:
                                setError('Fatal error');
                                hls.destroy();
                                break;
                        }
                    }
                });

            } else if (videoRef.current && videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
                // Safari native HLS
                videoRef.current.src = src;
                videoRef.current.addEventListener('loadedmetadata', () => {
                    if (autoPlay && videoRef.current) videoRef.current.play();
                });
            }
        };

        initPlayer();

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
            }
        };
    }, [src, enableP2P, autoPlay, onStatus]);

    return (
        <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden group">
            <video
                ref={videoRef}
                className="w-full h-full"
                playsInline
                controls
            />
            {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm text-white p-4 text-center">
                    <div>
                        <p className="font-medium">{error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-2 text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full transition-colors"
                        >
                            Reload
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
