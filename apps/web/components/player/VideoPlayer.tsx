"use client";

import dynamic from 'next/dynamic';
import React from 'react';

const HlsPlayer = dynamic(() => import('./HlsPlayer').then(mod => mod.VideoPlayer), {
    ssr: false,
    loading: () => <div className="w-full aspect-video bg-neutral-900 animate-pulse rounded-lg" />
});

interface VideoPlayerProps {
    src: string;
    className?: string;
    autoPlay?: boolean;
}

export function VideoPlayer(props: VideoPlayerProps) {
    return <HlsPlayer {...props} />;
}
