"use client";

import { useEffect, useState } from 'react';
import { Globe, Users, ArrowUpCircle, ArrowDownCircle, Radio } from 'lucide-react';
import { getSwarmHealth, startClusterMonitoring, ClusterInfo } from '@/lib/p2p';

interface P2PStatsProps {
    className?: string;
}

export function P2PStats({ className = '' }: P2PStatsProps) {
    const [health, setHealth] = useState(getSwarmHealth());
    const [cluster, setCluster] = useState<ClusterInfo | null>(null);

    useEffect(() => {
        // Start cluster monitoring
        const stopMonitoring = startClusterMonitoring((newCluster) => {
            setCluster(newCluster);
        });

        // Update health every 2 seconds
        const interval = setInterval(() => {
            setHealth(getSwarmHealth());
        }, 2000);

        return () => {
            stopMonitoring();
            clearInterval(interval);
        };
    }, []);

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <div className={`flex items-center gap-4 text-xs text-neutral-500 ${className}`}>
            {/* Cluster/Region */}
            {cluster && (
                <div className="flex items-center gap-1" title={`Cluster: ${cluster.clusterId}`}>
                    <Globe className="w-3 h-3" aria-hidden="true" />
                    <span>{cluster.region}</span>
                </div>
            )}

            {/* Peer Count */}
            <div className="flex items-center gap-1" title="Connected Peers">
                <Users className="w-3 h-3" aria-hidden="true" />
                <span>{health.peerCount} peers</span>
            </div>

            {/* P2P Ratio */}
            {health.p2pRatio > 0 && (
                <div className="flex items-center gap-1" title="P2P Download Ratio">
                    <Radio className="w-3 h-3" aria-hidden="true" />
                    <span>{(health.p2pRatio * 100).toFixed(0)}% P2P</span>
                </div>
            )}

            {/* Upload/Download */}
            {(health.uploadBytes > 0 || health.downloadBytes > 0) && (
                <>
                    <div className="flex items-center gap-1 text-green-500" title="Uploaded to Peers">
                        <ArrowUpCircle className="w-3 h-3" aria-hidden="true" />
                        <span>{formatBytes(health.uploadBytes)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-blue-500" title="Downloaded from Peers">
                        <ArrowDownCircle className="w-3 h-3" aria-hidden="true" />
                        <span>{formatBytes(health.downloadBytes)}</span>
                    </div>
                </>
            )}
        </div>
    );
}
