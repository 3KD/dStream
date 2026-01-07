"use client";

import { useState, useEffect, useRef } from "react";
import { Users, RefreshCw, AlertTriangle, Eye } from "lucide-react";

interface AnalyticsViewProps {
    streamId: string | null;
}

export function AnalyticsView({ streamId }: AnalyticsViewProps) {
    const [viewerCount, setViewerCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [demoMode, setDemoMode] = useState(false);
    const failCountRef = useRef(0);

    const fetchViewers = async () => {
        if (!streamId) return;
        setLoading(true);
        try {
            // Fetch from Registry Service
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

            const response = await fetch(`http://localhost:3002/viewers/${streamId}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error("Failed to fetch data");
            const data = await response.json();
            setViewerCount(data.count || 0);
            setLastUpdated(new Date());
            setError(null);

            // Log reconnection if we were in demo mode
            if (demoMode) {
                console.log("[Analytics] ✅ Registry reconnected - switching to live data");
            }
            setDemoMode(false);
            failCountRef.current = 0;
        } catch (err: any) {
            failCountRef.current++;

            // Log first failure for debugging
            if (failCountRef.current === 1) {
                console.warn(`[Analytics] ⚠️  Registry connection failed:`, err.message);
                console.warn(`[Analytics] Will retry, then switch to demo mode if unavailable`);
            }

            // After 2 failures, switch to demo mode
            if (failCountRef.current >= 2) {
                if (!demoMode) {
                    console.log(`[Analytics] 🎭 Switching to demo mode (Registry at localhost:3002 unavailable)`);
                }
                setDemoMode(true);
                setError(null);
                // Simulate a random viewer count for demo purposes
                setViewerCount(prev => {
                    const base = prev ?? Math.floor(Math.random() * 5) + 1;
                    const delta = Math.random() > 0.5 ? 1 : (base > 1 ? -1 : 0);
                    return base + delta;
                });
                setLastUpdated(new Date());
            } else {
                setError("Connecting to Registry...");
            }
        } finally {
            setLoading(false);
        }
    };

    // Poll every 10 seconds if valid streamId
    useEffect(() => {
        if (!streamId) return;
        failCountRef.current = 0;
        setDemoMode(false);
        fetchViewers();
        const interval = setInterval(fetchViewers, 10000);
        return () => clearInterval(interval);
    }, [streamId]);

    if (!streamId) {
        return (
            <div className="p-8 text-center bg-neutral-900 rounded-xl border border-neutral-800 text-neutral-500">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Start streaming to see analytics.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Real-time Viewers Card */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 relative overflow-hidden group">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <p className="text-neutral-400 text-sm font-medium uppercase tracking-wider">Current Viewers</p>
                        <h3 className="text-4xl font-black text-white mt-1 relative z-10">
                            {viewerCount !== null ? viewerCount : "--"}
                        </h3>
                    </div>
                    <div className="p-3 bg-blue-900/20 rounded-lg text-blue-500">
                        <Users className="w-6 h-6" />
                    </div>
                </div>

                <div className="flex items-center justify-between text-xs text-neutral-500 border-t border-neutral-800 pt-4 mt-2">
                    <span className="flex items-center gap-1">
                        {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <div className={`w-2 h-2 ${demoMode ? 'bg-yellow-500' : 'bg-green-500'} rounded-full`} />}
                        {loading ? "Updating..." : demoMode ? "Demo" : "Live"}
                    </span>
                    <span>
                        Updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : "Never"}
                    </span>
                </div>

                {demoMode && (
                    <div className="absolute inset-x-0 bottom-0 bg-yellow-900/90 text-yellow-200 text-xs py-1 px-4 flex items-center gap-2">
                        <Eye className="w-3 h-3" />
                        Simulated data (Registry offline)
                    </div>
                )}

                {error && (
                    <div className="absolute inset-x-0 bottom-0 bg-red-900/90 text-red-200 text-xs py-1 px-4 flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3" />
                        {error}
                    </div>
                )}
            </div>

            {/* Placeholder for future specific metrics */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 opacity-50">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <p className="text-neutral-400 text-sm font-medium uppercase tracking-wider">Bandwidth (Est)</p>
                        <h3 className="text-4xl font-black text-neutral-600 mt-1">--</h3>
                    </div>
                </div>
                <p className="text-xs text-neutral-500 mt-4">Coming soon</p>
            </div>
        </div>
    );
}
