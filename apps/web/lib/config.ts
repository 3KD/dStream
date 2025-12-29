/**
 * P2P and Streaming Configuration
 * 
 * Tiered tracker list with fallback strategy.
 * P2P engine tuning for low-latency live streaming.
 */

// Primary trackers (measured for latency)
export const TRACKER_ANNOUNCE_URLS = [
    "wss://tracker.openwebtorrent.com",   // Primary - US
    "wss://tracker.webtorrent.dev",       // Fallback - EU
    "wss://tracker.btorrent.xyz",         // Fallback - Global
    "wss://tracker.files.fm:7073/announce" // Additional
];

// P2P Engine Configuration
export const P2P_CONFIG = {
    core: {
        // Swarm ID derived from stream - enables per-stream swarms
        // In production, this is set dynamically per stream
        swarmId: undefined as string | undefined,

        // Announce to all trackers for redundancy
        simultaneousHttpDownloads: 2,
        simultaneousP2PDownloads: 3,

        // Prefer P2P over HTTP when available
        httpDownloadProbability: 0.1, // 10% chance to use HTTP even when P2P available
    },

    segments: {
        // How many segments ahead to request
        forwardSegmentCount: 20,

        // How many segments to keep cached
        cachedSegmentsCount: 30,

        // Request timeout before falling back
        httpDownloadTimeoutMs: 5000,
        p2pDownloadTimeoutMs: 3000,
    },

    // Graceful degradation settings
    degradation: {
        // If segment missing, continue playback (don't stall)
        skipMissingSegments: true,

        // Max consecutive skips before error
        maxConsecutiveSkips: 3,

        // Log skipped segments for diagnostics
        logSkippedSegments: true,
    },
};

// Stream key generation from identity
export function generateStreamKey(publicKey: string): string {
    // Use first 12 chars of pubkey for readable stream key
    return `dstream-${publicKey.substring(0, 12)}`;
}

// Verify stream key matches pubkey (for 3rd party interop)
export function verifyStreamKeyOwnership(streamKey: string, publicKey: string): boolean {
    const expected = generateStreamKey(publicKey);
    return streamKey === expected;
}
