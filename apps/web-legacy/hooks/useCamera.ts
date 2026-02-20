import { useState, useCallback, useEffect, useRef } from 'react';

export interface DeviceInfo {
    deviceId: string;
    label: string;
    kind: MediaDeviceKind;
}

export function useCamera() {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Device Management
    const [devices, setDevices] = useState<DeviceInfo[]>([]);
    const [videoDeviceId, setVideoDeviceId] = useState<string>('');
    const [audioDeviceId, setAudioDeviceId] = useState<string>('');

    const streamRef = useRef<MediaStream | null>(null);

    // Enumerate devices
    const getDevices = useCallback(async () => {
        try {
            // Must request permission first to get labels
            // In legacy, we might want to check if we already have permission via existing logic, 
            // but getting a temp stream is the safest cross-browser way to ensure labels exist if not already granted.
            // Do NOT eagerly request permission here.
            // Just return what we can see (which might be empty labels).
            // Requesting stream here causes "NotFoundError" if hardware is finicky.

            const deviceInfos = await navigator.mediaDevices.enumerateDevices();
            console.log('[Camera] RAW Enumerate Devices Output:', deviceInfos.map(d => ({ kind: d.kind, label: d.label, id: d.deviceId })));

            const formattedDevices = deviceInfos.map(d => ({
                deviceId: d.deviceId,
                label: d.label || `${d.kind} (${d.deviceId.slice(0, 5)}...)`,
                kind: d.kind
            }));

            setDevices(formattedDevices);

            // Set defaults if not set, BUT ONLY if we have labels (active permission)
            // If labels are missing, we likely have restricted IDs that shouldn't be constrained against.
            if (!videoDeviceId) {
                const videos = formattedDevices.filter(d => d.kind === 'videoinput');
                // Check against the raw deviceInfos to see if label was empty
                const firstRaw = deviceInfos.find(raw => raw.deviceId === videos[0]?.deviceId);

                if (videos.length > 0 && firstRaw?.label) {
                    setVideoDeviceId(videos[0].deviceId);
                }
            }
            if (!audioDeviceId) {
                const audios = formattedDevices.filter(d => d.kind === 'audioinput');
                const firstRaw = deviceInfos.find(raw => raw.deviceId === audios[0]?.deviceId);

                if (audios.length > 0 && firstRaw?.label) {
                    setAudioDeviceId(audios[0].deviceId);
                }
            }

            return formattedDevices;
        } catch (err) {
            console.error('[Camera] Error listing devices:', err);
            return [];
        }
    }, [videoDeviceId, audioDeviceId]);

    // Force release any existing streams
    const releaseCamera = useCallback(() => {
        if (streamRef.current) {
            console.log('[Camera] Releasing existing stream');
            streamRef.current.getTracks().forEach(track => {
                track.stop();
            });
            streamRef.current = null;
        }
        setStream(null);
    }, []);

    const startCamera = useCallback(async (forcedVideoId?: string, forcedAudioId?: string) => {
        releaseCamera();
        setIsLoading(true);
        setError(null);

        const targetVideoId = forcedVideoId || videoDeviceId;
        const targetAudioId = forcedAudioId || audioDeviceId;

        const tryGetStream = async (constraints: MediaStreamConstraints) => {
            console.log("[Camera] Requesting User Media with:", JSON.stringify(constraints));
            return await navigator.mediaDevices.getUserMedia(constraints);
        };

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("Browser API missing. Ensure HTTPS is used.");
            }

            let mediaStream: MediaStream | null = null;
            let lastError: any = null;

            // STRATEGY 1: Specific Device Request (Only if IDs are provided)
            if (targetVideoId || targetAudioId) {
                try {
                    const specificConstraints: MediaStreamConstraints = {
                        video: targetVideoId ? { deviceId: { exact: targetVideoId }, width: { ideal: 1280 }, height: { ideal: 720 } } : true,
                        audio: targetAudioId ? { deviceId: { exact: targetAudioId }, echoCancellation: false } : true
                    };
                    mediaStream = await tryGetStream(specificConstraints);
                } catch (e: any) {
                    console.warn("[Camera] Specific device request failed. CLEARING STALE IDs and falling back.", e);
                    lastError = e;
                    // SELF-HEALING: Clear stale IDs so they don't block future attempts
                    if (targetVideoId) setVideoDeviceId('');
                    if (targetAudioId) setAudioDeviceId('');
                }
            }

            // STRATEGY 2: Generic Request (If specific failed OR no IDs provided)
            if (!mediaStream) {
                try {
                    // Try standard HD first
                    mediaStream = await tryGetStream({
                        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                        audio: { echoCancellation: false, autoGainControl: false }
                    });
                } catch (e) {
                    console.warn("[Camera] Generic HD request failed. Trying basic VGA...", e);
                    lastError = e;
                }
            }

            // STRATEGY 3: Basic/Low-Res Request (Last Resort)
            if (!mediaStream) {
                try {
                    mediaStream = await tryGetStream({ video: true, audio: true });
                } catch (e) {
                    console.warn("[Camera] Basic generic request failed.", e);
                    lastError = e;
                }
            }

            // STRATEGY 4: Video Only (If Audio is the blocker)
            if (!mediaStream) {
                try {
                    mediaStream = await tryGetStream({ video: true, audio: false });
                    setError("Warning: Audio device failed. Video only.");
                } catch (e) {
                    console.error("[Camera] All strategies failed.", e);
                    throw lastError || e;
                }
            }

            if (!mediaStream) {
                throw new Error('Could not acquire media stream after all attempts.');
            }

            streamRef.current = mediaStream;
            setStream(mediaStream);
            setIsLoading(false);

            // Refresh device list now that we have permissions
            getDevices();

            return mediaStream;

        } catch (err: any) {
            console.error('[Camera] Final Error:', err);
            setIsLoading(false);

            let message = `Failed to access camera: ${err.message}`;
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') message = 'Camera permission denied. Reset permissions in address bar.';
            else if (err.name === 'NotFoundError' || err.message.includes('object can not be found')) message = 'No camera device found on this system.';
            else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') message = 'Camera is in use by another app (Zoom/Meet).';
            else if (err.name === 'OverconstrainedError') message = 'Camera does not support the requested resolution.';

            setError(message);
            return null;
        }
    }, [releaseCamera, videoDeviceId, audioDeviceId, getDevices]);

    const startMockCamera = useCallback(async () => {
        releaseCamera();
        setIsLoading(true);
        setError(null);
        console.log('[Camera] Starting Mock Stream...');

        try {
            const canvas = document.createElement('canvas');
            canvas.width = 1280;
            canvas.height = 720;
            const ctx = canvas.getContext('2d');

            if (!ctx) throw new Error("Failed to create canvas context");

            // Create a self-updating stream
            const stream = canvas.captureStream(30); // 30 FPS

            // Animation Loop
            let frame = 0;
            const draw = () => {
                frame++;
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, 1280, 720);

                // Bouncing Box
                const x = (Math.sin(frame * 0.05) + 1) * 600;
                const y = (Math.cos(frame * 0.05) + 1) * 300;

                ctx.fillStyle = `hsl(${frame % 360}, 70%, 50%)`;
                ctx.fillRect(x, y, 100, 100);

                // Text
                ctx.fillStyle = '#fff';
                ctx.font = '40px monospace';
                ctx.fillText(`MOCK CAMERA - ${new Date().toLocaleTimeString()}`, 50, 50);
                ctx.fillText(`Frame: ${frame}`, 50, 100);

                if (stream.active) requestAnimationFrame(draw);
            };
            draw();

            // Mock Audio Track (Silent)
            const audioCtx = new AudioContext();
            const osc = audioCtx.createOscillator();
            const dst = audioCtx.createMediaStreamDestination();
            osc.connect(dst);
            osc.start();
            const audioTrack = dst.stream.getAudioTracks()[0];
            stream.addTrack(audioTrack);

            streamRef.current = stream;
            setStream(stream);
            setIsLoading(false);

            // Add a "virtual" device to the list
            setDevices(prev => [
                ...prev,
                { deviceId: 'mock-video', label: 'Mock Video Device', kind: 'videoinput' },
                { deviceId: 'mock-audio', label: 'Mock Audio Device', kind: 'audioinput' }
            ]);

            return stream;

        } catch (e: any) {
            console.error("Mock Camera failed:", e);
            setError(`Mock failed: ${e.message}`);
            setIsLoading(false);
            return null;
        }
    }, [releaseCamera]);

    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    return {
        stream,
        error,
        isLoading,
        startCamera,
        startMockCamera,
        stopCamera: releaseCamera,
        isActive: !!stream,
        devices,
        getDevices,
        videoDeviceId,
        setVideoDeviceId,
        audioDeviceId,
        setAudioDeviceId
    };
}
