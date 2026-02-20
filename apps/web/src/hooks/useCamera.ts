"use client";
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
            if (!streamRef.current) {
                // Temporary simple request to trigger permission prompt if needed
                // We don't save this stream, just close it immediately
                const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                tempStream.getTracks().forEach(t => t.stop());
            }

            const deviceInfos = await navigator.mediaDevices.enumerateDevices();
            const formattedDevices = deviceInfos.map(d => ({
                deviceId: d.deviceId,
                label: d.label || `${d.kind} (${d.deviceId.slice(0, 5)}...)`,
                kind: d.kind
            }));

            setDevices(formattedDevices);

            // Set defaults if not set
            if (!videoDeviceId) {
                const videos = formattedDevices.filter(d => d.kind === 'videoinput');
                if (videos.length > 0) setVideoDeviceId(videos[0].deviceId);
            }
            if (!audioDeviceId) {
                const audios = formattedDevices.filter(d => d.kind === 'audioinput');
                if (audios.length > 0) setAudioDeviceId(audios[0].deviceId);
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
                console.log(`[Camera] Stopped track: ${track.kind}`);
            });
            streamRef.current = null;
        }
        setStream(null);
    }, []);

    const startCamera = useCallback(async (forcedVideoId?: string, forcedAudioId?: string) => {
        // Always release first to avoid "device in use" errors
        releaseCamera();

        setIsLoading(true);
        setError(null);

        const targetVideoId = forcedVideoId || videoDeviceId;
        const targetAudioId = forcedAudioId || audioDeviceId;

        const tryGetStream = async (constraints: MediaStreamConstraints) => {
            try {
                return await navigator.mediaDevices.getUserMedia(constraints);
            } catch (err) {
                return null;
            }
        };

        try {
            console.log('[Camera] Requesting access with devices:', { targetVideoId, targetAudioId });

            // specific constraints based on selection
            const constraints: MediaStreamConstraints = {
                video: targetVideoId ? { deviceId: { exact: targetVideoId }, width: { ideal: 1280 }, height: { ideal: 720 } } : true,
                audio: targetAudioId ? { deviceId: { exact: targetAudioId }, echoCancellation: true } : true
            };

            let mediaStream = await tryGetStream(constraints);

            // Fallback if specific device fails (try generic)
            if (!mediaStream && (targetVideoId || targetAudioId)) {
                console.warn('[Camera] Specific device failed, failing back to generic...');
                mediaStream = await tryGetStream({ video: true, audio: true });
            }

            if (!mediaStream) {
                throw new Error('Could not acquire media stream');
            }

            console.log('[Camera] Access granted:', mediaStream.getTracks().map(t => t.kind));

            streamRef.current = mediaStream;
            setStream(mediaStream);
            setIsLoading(false);

            // Refresh device list to ensure labels are correct now that we have permissions
            getDevices();

            return mediaStream;

        } catch (err: any) {
            console.error('[Camera] Error:', err);
            setIsLoading(false);

            // Provide user-friendly error messages
            let message = 'Failed to access camera';
            if (err.message === 'The object can not be found here.' || err.name === 'NotFoundError') {
                message = 'Camera not found. Please check your OS Privacy Settings/Permissions for this browser.';
            } else if (err.name === 'NotAllowedError') {
                message = 'Camera permission denied. Please allow camera access.';
            } else if (err.name === 'NotReadableError') {
                message = 'Camera is in use by another app. Close other apps and retry.';
            } else if (err.name === 'OverconstrainedError') {
                message = 'Camera does not support requested settings.';
            }

            setError(message);
            return null;
        }
    }, [releaseCamera, videoDeviceId, audioDeviceId, getDevices]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (streamRef.current) {
                console.log('[Camera] Cleanup on unmount');
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    // Also cleanup on page unload (browser close/refresh)
    useEffect(() => {
        const handleUnload = () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
        window.addEventListener('beforeunload', handleUnload);
        return () => window.removeEventListener('beforeunload', handleUnload);
    }, []);

    return {
        stream,
        error,
        isLoading,
        startCamera,
        stopCamera: releaseCamera,
        isActive: !!stream,

        // Device Management
        devices,
        getDevices,
        videoDeviceId,
        setVideoDeviceId,
        audioDeviceId,
        setAudioDeviceId
    };
}
