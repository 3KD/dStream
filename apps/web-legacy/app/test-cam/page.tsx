"use client";
import { useState, useRef } from "react";

export default function TestCam() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [log, setLog] = useState<string[]>([]);

    const addLog = (msg: string) => setLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);

    const startCam = async () => {
        addLog("Requesting camera...");
        try {
            // The most basic request possible
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            addLog("Success! Got stream.");
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (e: any) {
            addLog(`ERROR: ${e.name} - ${e.message}`);
            console.error(e);
        }
    };

    return (
        <div className="p-10 bg-white text-black min-h-screen">
            <h1 className="text-2xl font-bold mb-4">Hardware Isolation Test</h1>
            <button
                onClick={startCam}
                className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold mb-4"
            >
                Start Basic Camera
            </button>

            <div className="grid grid-cols-2 gap-4">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full bg-black aspect-video border-4 border-gray-300"
                />
                <div className="bg-gray-100 p-4 border border-gray-300 h-64 overflow-auto font-mono text-sm">
                    {log.map((l, i) => <div key={i}>{l}</div>)}
                </div>
            </div>

            <p className="mt-8 max-w-xl text-gray-600">
                This page bypasses all dStream logic. If this fails, your browser/OS is blocking the camera.
                If this works, dStream has a bug.
            </p>
        </div>
    );
}
