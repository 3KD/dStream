"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { WHIPClient } from "@/lib/whipClient";

const STORAGE_KEY = "dstream_broadcast_session";

export interface BroadcastSession {
    isLive: boolean;
    streamId: string;        // derivedPath
    streamKey: string;       // user-friendly name
    startedAt: number;       // timestamp
    // Device settings for reconnection
    selectedCamera: string;
    selectedMic: string;
    videoEnabled: boolean;
    audioEnabled: boolean;
}

export type WhipStatus = "idle" | "connecting" | "streaming" | "error";

interface BroadcastContextType {
    session: BroadcastSession | null;
    isLive: boolean;
    stream: MediaStream | null;
    whipClient: WHIPClient | null;
    whipStatus: WhipStatus;

    startBroadcast: (session: Omit<BroadcastSession, 'isLive' | 'startedAt'>) => void;
    endBroadcast: () => void;
    updateSession: (partial: Partial<BroadcastSession>) => void;

    setStream: (stream: MediaStream | null) => void;
    setWhipClient: (client: WHIPClient | null) => void;
    setWhipStatus: (status: WhipStatus) => void;
}

const BroadcastContext = createContext<BroadcastContextType | undefined>(undefined);

export function BroadcastProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<BroadcastSession | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [whipClient, setWhipClient] = useState<WHIPClient | null>(null);
    const [whipStatus, setWhipStatus] = useState<WhipStatus>("idle");

    // Load from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as BroadcastSession;
                // Validate it's still a valid session (not stale)
                const ageMs = Date.now() - parsed.startedAt;
                const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours max

                if (parsed.isLive && ageMs < MAX_SESSION_AGE_MS) {
                    console.log("[Broadcast] Restored live session:", parsed.streamId);
                    setSession(parsed);
                } else {
                    // Clear stale session
                    localStorage.removeItem(STORAGE_KEY);
                }
            }
        } catch (e) {
            console.error("[Broadcast] Failed to load session:", e);
            localStorage.removeItem(STORAGE_KEY);
        }
    }, []);

    // Persist to localStorage on change
    useEffect(() => {
        if (session) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    }, [session]);

    const startBroadcast = useCallback((config: Omit<BroadcastSession, 'isLive' | 'startedAt'>) => {
        const newSession: BroadcastSession = {
            ...config,
            isLive: true,
            startedAt: Date.now(),
        };
        console.log("[Broadcast] Starting session:", newSession.streamId);
        setSession(newSession);
    }, []);

    const endBroadcast = useCallback(() => {
        console.log("[Broadcast] Ending session");
        setSession(null);
        // We do not automatically clear stream/whipClient here to allow UI to handle cleanup
        // or to allow preview to continue.
    }, []);

    const updateSession = useCallback((partial: Partial<BroadcastSession>) => {
        setSession(prev => prev ? { ...prev, ...partial } : null);
    }, []);

    return (
        <BroadcastContext.Provider value={{
            session,
            isLive: session?.isLive ?? false,
            stream,
            whipClient,
            whipStatus,
            startBroadcast,
            endBroadcast,
            updateSession,
            setStream,
            setWhipClient,
            setWhipStatus,
        }}>
            {children}
        </BroadcastContext.Provider>
    );
}

export function useBroadcast() {
    const context = useContext(BroadcastContext);
    if (context === undefined) {
        throw new Error("useBroadcast must be used within a BroadcastProvider");
    }
    return context;
}
