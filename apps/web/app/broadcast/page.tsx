"use client";
import { useState, useRef, useEffect } from 'react';
import { useBroadcast } from '@/context/BroadcastContext';
import { useIdentity } from '@/context/IdentityContext';
import { useCamera } from '@/hooks/useCamera';
import { useStreamAnnounce } from '@/hooks/useStreamAnnounce';
import { useStreamAnalytics, formatDuration } from '@/hooks/useStreamAnalytics';
import { ChatBox } from '@/components/chat';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { P2PStats } from '@/components/P2PStats';

export default function BroadcastPage() {
    const { identity } = useIdentity();
    const { session, startBroadcast, stopBroadcast, updateMetadata } = useBroadcast();
    const {
        stream: cameraStream,
        error: cameraError,
        startCamera,
        stopCamera,
        devices,
        getDevices,
        videoDeviceId,
        setVideoDeviceId,
        audioDeviceId,
        setAudioDeviceId
    } = useCamera();

    const [streamKey, setStreamKey] = useState('test-stream');
    const [title, setTitle] = useState('');

    // Tier 10 Auto-announce
    useStreamAnnounce();

    // Tier 26 Analytics
    const { analytics } = useStreamAnalytics({
        broadcasterPubkey: identity?.publicKey || 'local',
        streamId: streamKey
    });

    const isLive = session?.stream.status === 'live';

    // Load devices on mount
    useEffect(() => {
        getDevices();
    }, [getDevices]);

    const handleStart = async () => {
        if (!cameraStream) return;
        try {
            await startBroadcast(streamKey, cameraStream, { title });
        } catch (e) {
            console.error('Failed to start:', e);
        }
    };

    const videoRef = useRef<HTMLVideoElement>(null);

    // Sync video stream effectively without component re-renders causing glitches
    useEffect(() => {
        if (videoRef.current && cameraStream) {
            videoRef.current.srcObject = cameraStream;
        }
    }, [cameraStream]);

    // Restart camera when device selection changes, but only if we already have a stream (previewing)
    // or if we explicitly want to start. 
    // Actually, let's keep it manual for now or "Enable Camera" triggers it.
    // Better: If I select a device, I expect it to switch if I'm already previewing.
    useEffect(() => {
        if (cameraStream && (videoDeviceId || audioDeviceId)) {
            // We need to restart to apply changes.
            // But careful of infinite loops if devices change.
            // current implementation of startCamera handles release.
            // Let's rely on user clicking "Enable Camera" or "Switch" for now to avoid complexity,
            // or just auto-restart if stream exists.
            startCamera();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoDeviceId, audioDeviceId]);


    return (
        <DashboardLayout>
            <div className="h-full flex">
                <div className="flex-1 p-6 overflow-y-auto">
                    <div className="max-w-4xl mx-auto space-y-6">
                        {/* Error Banner */}
                        {session?.error && (
                            <div className="bg-red-500/10 border border-red-500/50 text-red-500 px-4 py-3 rounded-xl flex items-center gap-3">
                                <span className="text-xl">⚠️</span>
                                <div className="flex-1">
                                    <p className="font-bold">Broadcast Error</p>
                                    <p className="text-sm opacity-90">{session.error}</p>
                                </div>
                                {session.connectionStatus === 'error' && (
                                    <button
                                        onClick={() => location.reload()}
                                        className="text-xs bg-red-500/20 hover:bg-red-500/30 px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                        Reload
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Video Preview */}
                        <div className="relative aspect-video bg-neutral-900 rounded-2xl overflow-hidden border border-neutral-800">
                            {cameraStream ? (
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    muted
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center flex-col gap-4">
                                    <span className="text-4xl text-neutral-700">📷</span>
                                    <button
                                        onClick={() => startCamera()}
                                        className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-xl font-bold"
                                    >
                                        Enable Camera
                                    </button>
                                    {cameraError && (
                                        <p className="text-red-500 bg-red-950/50 px-3 py-1 rounded text-sm max-w-[80%] text-center border border-red-900">
                                            {cameraError}
                                        </p>
                                    )}
                                </div>
                            )}

                            {isLive && (
                                <div className="absolute top-4 left-4 flex gap-2">
                                    <div className="bg-red-600 px-3 py-1 rounded-full text-xs font-bold animate-pulse">LIVE</div>
                                    <div className="bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-xs font-mono">
                                        {formatDuration(analytics.streamDuration)}
                                    </div>
                                    <div className="bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-xs font-mono">
                                        👤 {analytics.currentViewers}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Controls */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4">
                                <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">Stream Settings</h2>

                                <div className="space-y-2">
                                    <label className="text-xs text-neutral-400">Title</label>
                                    <input
                                        type="text"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder="Awesome Stream"
                                        className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>

                                {/* Device Selectors */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <label className="text-xs text-neutral-400">Camera</label>
                                        <select
                                            value={videoDeviceId}
                                            onChange={(e) => setVideoDeviceId(e.target.value)}
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none truncate"
                                            disabled={isLive}
                                        >
                                            <option value="">Default Camera</option>
                                            {devices.filter(d => d.kind === 'videoinput').map(device => (
                                                <option key={device.deviceId} value={device.deviceId}>
                                                    {device.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs text-neutral-400">Microphone</label>
                                        <select
                                            value={audioDeviceId}
                                            onChange={(e) => setAudioDeviceId(e.target.value)}
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none truncate"
                                            disabled={isLive}
                                        >
                                            <option value="">Default Mic</option>
                                            {devices.filter(d => d.kind === 'audioinput').map(device => (
                                                <option key={device.deviceId} value={device.deviceId}>
                                                    {device.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>


                                <div className="space-y-2">
                                    <label className="text-xs text-neutral-400">Stream Key</label>
                                    <input
                                        type="text"
                                        value={streamKey}
                                        onChange={(e) => setStreamKey(e.target.value)}
                                        className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>

                                <div className="flex gap-3 pt-2">
                                    {isLive ? (
                                        <button
                                            onClick={stopBroadcast}
                                            className="flex-1 bg-red-600 hover:bg-red-500 py-3 rounded-xl font-bold transition-all"
                                        >
                                            End Stream
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleStart}
                                            disabled={!cameraStream}
                                            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-3 rounded-xl font-bold transition-all"
                                        >
                                            Go Live
                                        </button>
                                    )}
                                    <button
                                        onClick={() => cameraStream ? stopCamera() : startCamera()}
                                        className="px-4 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
                                    >
                                        {cameraStream ? '🚫' : '📷'}
                                    </button>
                                </div>
                            </div>

                            <P2PStats />
                        </div>
                    </div>
                </div>

                {/* Sidebar Chat */}
                <div className="w-80 border-l border-neutral-800 h-full">
                    <ChatBox broadcasterPubkey="local" streamId={streamKey} />
                </div>
            </div>
        </DashboardLayout>
    );
}
