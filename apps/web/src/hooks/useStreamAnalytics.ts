"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useChat } from '@/hooks/useChat';
import { usePresence } from '@/hooks/usePresence';

interface UseStreamAnalyticsOptions {
    broadcasterPubkey: string;
    streamId: string;
}

export interface StreamAnalytics {
    currentViewers: number;
    peakViewers: number;
    totalMessages: number;
    messagesPerMinute: number;
    streamDuration: number; // seconds
    startTime: number | null;
}

export function useStreamAnalytics({ broadcasterPubkey, streamId }: UseStreamAnalyticsOptions) {
    const { messages } = useChat({ broadcasterPubkey, streamId });
    const { viewerCount } = usePresence({ broadcasterPubkey, streamId });

    const [analytics, setAnalytics] = useState<StreamAnalytics>({
        currentViewers: 0,
        peakViewers: 0,
        totalMessages: 0,
        messagesPerMinute: 0,
        streamDuration: 0,
        startTime: null,
    });

    const peakRef = useRef(0);
    const messageCountRef = useRef(0);
    const startTimeRef = useRef<number | null>(null);

    // Track viewer count and peak
    useEffect(() => {
        if (viewerCount > peakRef.current) {
            peakRef.current = viewerCount;
        }

        setAnalytics(prev => ({
            ...prev,
            currentViewers: viewerCount,
            peakViewers: peakRef.current,
        }));
    }, [viewerCount]);

    // Track messages
    useEffect(() => {
        messageCountRef.current = messages.length;

        setAnalytics(prev => ({
            ...prev,
            totalMessages: messages.length,
        }));
    }, [messages]);

    // Track duration
    useEffect(() => {
        if (!startTimeRef.current) {
            startTimeRef.current = Date.now();
        }

        const interval = setInterval(() => {
            const now = Date.now();
            const duration = Math.floor((now - (startTimeRef.current || now)) / 1000);
            const mpm = duration > 60
                ? (messageCountRef.current / (duration / 60))
                : messageCountRef.current;

            setAnalytics(prev => ({
                ...prev,
                streamDuration: duration,
                messagesPerMinute: Math.round(mpm * 10) / 10,
                startTime: startTimeRef.current,
            }));
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const reset = useCallback(() => {
        peakRef.current = 0;
        messageCountRef.current = 0;
        startTimeRef.current = Date.now();
        setAnalytics({
            currentViewers: 0,
            peakViewers: 0,
            totalMessages: 0,
            messagesPerMinute: 0,
            streamDuration: 0,
            startTime: Date.now(),
        });
    }, []);

    return { analytics, reset };
}

/**
 * Format seconds to HH:MM:SS
 */
export function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}
