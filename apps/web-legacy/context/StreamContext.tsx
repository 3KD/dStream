"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";

export interface StreamMetadata {
    title: string;
    pubkey: string;
    channel: string;
    summary?: string;
}

interface StreamContextType {
    activeStream: { url: string; metadata: StreamMetadata } | null;
    playStream: (url: string, metadata: StreamMetadata) => void;
    stopStream: () => void;
    isMiniPlayerVisible: boolean;
    setMiniPlayerVisible: (visible: boolean) => void;
}

const StreamContext = createContext<StreamContextType | undefined>(undefined);

export function StreamProvider({ children }: { children: ReactNode }) {
    const [activeStream, setActiveStream] = useState<{ url: string; metadata: StreamMetadata } | null>(null);
    const [isMiniPlayerVisible, setIsMiniPlayerVisible] = useState(false);

    const playStream = (url: string, metadata: StreamMetadata) => {
        setActiveStream({ url, metadata });
        setIsMiniPlayerVisible(true);
    };

    const stopStream = () => {
        setActiveStream(null);
        setIsMiniPlayerVisible(false);
    };

    return (
        <StreamContext.Provider value={{
            activeStream,
            playStream,
            stopStream,
            isMiniPlayerVisible,
            setMiniPlayerVisible: setIsMiniPlayerVisible
        }}>
            {children}
        </StreamContext.Provider>
    );
}

export function useStream() {
    const context = useContext(StreamContext);
    if (context === undefined) {
        throw new Error("useStream must be used within a StreamProvider");
    }
    return context;
}
