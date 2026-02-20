"use client";

import React, { useState } from 'react';
import { Activity, Download, Upload, Users, ChevronDown, ChevronUp } from 'lucide-react';

interface StatsProps {
    peers: number;
    downloadSpeed: number; // bytes/sec
    uploadSpeed: number; // bytes/sec
    totalP2P: number; // bytes
    totalHTTP: number; // bytes
}

function formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec: number) {
    return formatBytes(bytesPerSec) + '/s';
}

export function P2PStats({ peers, downloadSpeed, uploadSpeed, totalP2P, totalHTTP }: StatsProps) {
    const [isCollapsed, setIsCollapsed] = useState(true);
    const total = totalP2P + totalHTTP;
    const p2pPercentage = total > 0 ? ((totalP2P / total) * 100).toFixed(1) : "0.0";

    return (
        <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-md rounded-lg text-xs text-white border border-white/10 w-64 z-10 transition-all">
            {/* Header - Always visible, clickable */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors rounded-lg"
            >
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-green-400" />
                    <span className="font-bold">Swarm Stats</span>
                    <span className="text-neutral-400">({peers} peers)</span>
                </div>
                {isCollapsed ? (
                    <ChevronDown className="w-4 h-4 text-neutral-400" />
                ) : (
                    <ChevronUp className="w-4 h-4 text-neutral-400" />
                )}
            </button>

            {/* Collapsible content */}
            {!isCollapsed && (
                <div className="px-3 pb-3 space-y-2 border-t border-white/10">
                    <div className="flex justify-between items-center pt-2">
                        <div className="flex items-center gap-2 text-neutral-400">
                            <Users className="w-3 h-3" /> Peers
                        </div>
                        <span className="font-mono font-bold">{peers}</span>
                    </div>

                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 text-neutral-400">
                            <Download className="w-3 h-3" /> Down (P2P)
                        </div>
                        <div className="text-right">
                            <div className="font-mono">{formatSpeed(downloadSpeed)}</div>
                            <div className="text-[10px] text-neutral-500">{formatBytes(totalP2P)}</div>
                        </div>
                    </div>

                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 text-neutral-400">
                            <Upload className="w-3 h-3" /> Up (P2P)
                        </div>
                        <div className="text-right">
                            <div className="font-mono">{formatSpeed(uploadSpeed)}</div>
                        </div>
                    </div>

                    <div className="flex justify-between items-center pt-2 border-t border-white/10">
                        <span className="text-neutral-400">P2P Ratio</span>
                        <span className={parseFloat(p2pPercentage) > 50 ? "text-green-400 font-bold" : "text-yellow-400"}>
                            {p2pPercentage}%
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
