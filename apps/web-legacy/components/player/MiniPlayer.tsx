"use client";

import React, { useState, useRef, useEffect } from "react";
import { useStream } from "@/context/StreamContext";
import { VideoPlayer } from "./VideoPlayer";
import { X, Maximize2, Move, PictureInPicture2 } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";

export function MiniPlayer() {
    const { activeStream, stopStream, isMiniPlayerVisible } = useStream();
    const pathname = usePathname();
    const isWatchPage = pathname.startsWith("/watch/");
    const videoContainerRef = useRef<HTMLDivElement>(null);

    // Position state (starting at bottom right)
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [size, setSize] = useState({ width: 320, height: 180 });
    const [hasInitialized, setHasInitialized] = useState(false);
    const [isPiPActive, setIsPiPActive] = useState(false);

    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    // Initialize position to bottom right
    useEffect(() => {
        if (!hasInitialized && typeof window !== 'undefined') {
            setPosition({
                x: window.innerWidth - 320 - 24,
                y: window.innerHeight - 180 - 24
            });
            setHasInitialized(true);
        }
    }, [hasInitialized]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        setIsDragging(true);
        dragOffset.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
    };

    const handleResizeStart = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setIsResizing(true);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                setPosition({
                    x: Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragOffset.current.x)),
                    y: Math.max(0, Math.min(window.innerHeight - size.height, e.clientY - dragOffset.current.y))
                });
            }
            if (isResizing) {
                const newWidth = Math.max(240, Math.min(640, e.clientX - position.x));
                setSize({
                    width: newWidth,
                    height: (newWidth * 9) / 16 // Maintain 16:9
                });
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(false);
        };

        if (isDragging || isResizing) {
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
        }

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, isResizing, position, size]);

    // Picture-in-Picture toggle
    const togglePictureInPicture = async () => {
        // Find the video element inside the container
        const video = videoContainerRef.current?.querySelector('video');
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
            console.error('[MiniPlayer PiP] Failed to toggle:', err);
        }
    };

    // Don't show if on watch page (main player is there) or if not visible
    // CRITICAL: This early return must be AFTER all hooks to follow Rules of Hooks
    if (isWatchPage || !isMiniPlayerVisible || !activeStream) return null;

    return (
        <div
            style={{
                left: position.x,
                top: position.y,
                width: size.width,
                height: size.height,
                position: 'fixed'
            }}
            className="z-[9999] bg-black rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 flex flex-col group backdrop-blur-xl ring-1 ring-white/20 select-none"
        >
            {/* Overlay Controls */}
            <div
                onMouseDown={handleMouseDown}
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity z-20 flex flex-col pointer-events-none cursor-move"
            >
                {/* Header Section */}
                <div className="p-3 bg-gradient-to-b from-black/80 to-transparent flex items-center gap-3 pointer-events-auto">
                    <div className="p-1.5 bg-white/10 rounded-lg">
                        <Move className="w-3 h-3 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-white truncate leading-none mb-1">
                            NOW WATCHING
                        </p>
                        <p className="text-xs font-medium text-white/70 truncate leading-none">
                            {activeStream.metadata.title}
                        </p>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={(e) => { e.stopPropagation(); togglePictureInPicture(); }}
                            className={`p-2 hover:bg-white/10 rounded-xl transition-all active:scale-95 ${isPiPActive ? 'text-blue-400' : 'text-white/60 hover:text-white'}`}
                            title={isPiPActive ? "Exit Picture-in-Picture" : "Picture-in-Picture"}
                        >
                            <PictureInPicture2 className="w-4 h-4" />
                        </button>
                        <Link
                            href={`/watch/${activeStream.metadata.channel}`}
                            className="p-2 hover:bg-white/10 rounded-xl text-white/60 hover:text-white transition-all active:scale-95"
                        >
                            <Maximize2 className="w-4 h-4" />
                        </Link>
                        <button
                            onClick={(e) => { e.stopPropagation(); stopStream(); }}
                            className="p-2 hover:bg-red-500/20 rounded-xl text-white/60 hover:text-red-500 transition-all active:scale-95"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Resize Handle (Bottom Right) */}
                <div
                    onMouseDown={handleResizeStart}
                    className="absolute bottom-0 right-0 w-8 h-8 pointer-events-auto cursor-nwse-resize flex items-end justify-end p-1"
                >
                    <div className="w-4 h-4 rounded-tl-lg bg-white/10 border-r border-b border-white/20" />
                </div>
            </div>

            {/* Video Container */}
            <div ref={videoContainerRef} className="flex-1 pointer-events-none relative">
                <VideoPlayer src={activeStream.url} autoPlay />
                {/* Visual Glass Effect on Video */}
                <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-2xl pointer-events-none" />
            </div>
        </div>
    );
}
