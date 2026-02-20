"use client";
import { useP2P } from '@/hooks/useP2P';

export function P2PStats() {
    const { health } = useP2P();

    // Format speed (bps -> Mbps)
    const formatSpeed = (bps: number) => {
        const mbps = (bps * 8) / (1024 * 1024);
        return mbps.toFixed(2);
    };

    // Format bytes
    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 text-xs font-mono">
            <h4 className="text-neutral-500 mb-3 uppercase tracking-wider text-[10px] font-bold">P2P Swarm Health</h4>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <div className="text-neutral-500 mb-1">Peers</div>
                    <div className="text-lg text-white font-sans">{health.peerCount}</div>
                </div>
                <div>
                    <div className="text-neutral-500 mb-1">P2P Ratio</div>
                    <div className="text-lg text-blue-400 font-sans">{(health.p2pRatio * 100).toFixed(0)}%</div>
                </div>
            </div>

            <div className="mt-4 space-y-2 border-t border-neutral-800 pt-3">
                <div className="flex justify-between">
                    <span className="text-neutral-500">Download</span>
                    <span className="text-green-400">{formatSpeed(health.downloadSpeed)} Mbps</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-neutral-500">Upload</span>
                    <span className="text-blue-400">{formatSpeed(health.uploadSpeed)} Mbps</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-neutral-500">Saved</span>
                    <span className="text-neutral-300">{formatBytes(health.bandwidthSaved)}</span>
                </div>
            </div>

            <div className="mt-4 bg-neutral-800 h-1 rounded-full overflow-hidden">
                <div
                    className="bg-blue-500 h-full transition-all duration-1000"
                    style={{ width: `${health.p2pRatio * 100}%` }}
                />
            </div>
        </div>
    );
}
