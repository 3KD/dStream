/**
 * P2P Swarm Optimization Utilities
 * 
 * Implements:
 * - Dynamic latency measurement to anchor nodes
 * - Cluster-based peer assignment
 * - Graceful degradation (missing segments = minor artifact, not stall)
 */

// Anchor nodes for latency measurement (WebSocket trackers double as anchors)
const ANCHOR_NODES = [
    { id: 'us-east', url: 'wss://tracker.openwebtorrent.com', region: 'Americas' },
    { id: 'eu-west', url: 'wss://tracker.webtorrent.dev', region: 'Europe' },
    { id: 'global-1', url: 'wss://tracker.btorrent.xyz', region: 'Global' },
    { id: 'global-2', url: 'wss://tracker.files.fm:7073/announce', region: 'Global' },
    { id: 'global-3', url: 'wss://open.tube/tracker/socket', region: 'Global' },
    { id: 'global-4', url: 'wss://peertube.cpy.re/tracker/socket', region: 'Europe' }
];

export interface ClusterInfo {
    clusterId: string;
    region: string;
    latencies: Map<string, number>;
    lastMeasured: number;
}

// Store current cluster info
let currentCluster: ClusterInfo | null = null;
const REMEASURE_INTERVAL_MS = 60_000; // Re-measure every 60 seconds

/**
 * Measure latency to a WebSocket endpoint
 * Uses connection time as proxy for RTT
 */
async function measureLatency(url: string, timeoutMs = 5000): Promise<number> {
    return new Promise((resolve) => {
        const start = performance.now();
        const ws = new WebSocket(url);

        const timeout = setTimeout(() => {
            ws.close();
            resolve(Infinity); // Timeout = unreachable
        }, timeoutMs);

        ws.onopen = () => {
            const latency = performance.now() - start;
            clearTimeout(timeout);
            ws.close();
            resolve(latency);
        };

        ws.onerror = () => {
            clearTimeout(timeout);
            resolve(Infinity);
        };
    });
}

/**
 * Measure latency to all anchor nodes and determine cluster
 */
export async function measureCluster(): Promise<ClusterInfo> {
    const latencies = new Map<string, number>();

    // Measure all anchors in parallel
    const results = await Promise.all(
        ANCHOR_NODES.map(async (anchor) => {
            const latency = await measureLatency(anchor.url);
            return { anchor, latency };
        })
    );

    // Store results
    results.forEach(({ anchor, latency }) => {
        latencies.set(anchor.id, latency);
    });

    // Find closest anchor
    let closestAnchor = ANCHOR_NODES[0];
    let minLatency = Infinity;

    results.forEach(({ anchor, latency }) => {
        if (latency < minLatency) {
            minLatency = latency;
            closestAnchor = anchor;
        }
    });

    currentCluster = {
        clusterId: closestAnchor.id,
        region: closestAnchor.region,
        latencies,
        lastMeasured: Date.now(),
    };

    console.log(`[P2P] Cluster assigned: ${closestAnchor.id} (${closestAnchor.region}), latency: ${minLatency.toFixed(0)}ms`);

    return currentCluster;
}

/**
 * Get current cluster, measuring if stale or not yet measured
 */
export async function getCluster(): Promise<ClusterInfo> {
    if (!currentCluster || Date.now() - currentCluster.lastMeasured > REMEASURE_INTERVAL_MS) {
        return measureCluster();
    }
    return currentCluster;
}

/**
 * Score a peer based on cluster affinity and latency
 * Lower score = better peer
 */
export function scorePeer(peerClusterId: string | undefined, peerLatency: number): number {
    if (!currentCluster) return peerLatency;

    // Same cluster = bonus (subtract 50ms equivalent)
    const clusterBonus = peerClusterId === currentCluster.clusterId ? -50 : 0;

    return peerLatency + clusterBonus;
}

/**
 * Get optimized tracker list ordered by latency
 */
export async function getOptimizedTrackers(): Promise<string[]> {
    const cluster = await getCluster();

    // Sort anchors by measured latency
    const sorted = [...ANCHOR_NODES].sort((a, b) => {
        const latA = cluster.latencies.get(a.id) ?? Infinity;
        const latB = cluster.latencies.get(b.id) ?? Infinity;
        return latA - latB;
    });

    return sorted.map(a => a.url);
}

/**
 * Start periodic cluster re-measurement
 */
export function startClusterMonitoring(onUpdate?: (cluster: ClusterInfo) => void): () => void {
    // Initial measurement
    measureCluster().then(cluster => onUpdate?.(cluster));

    // Periodic re-measurement
    const interval = setInterval(async () => {
        const cluster = await measureCluster();
        onUpdate?.(cluster);
    }, REMEASURE_INTERVAL_MS);

    // Return cleanup function
    return () => clearInterval(interval);
}

/**
 * Swarm health metrics
 */
export interface SwarmHealth {
    peerCount: number;
    uploadBytes: number;
    downloadBytes: number;
    p2pRatio: number; // Download from P2P vs HTTP
    clusterPeerCount: number; // Peers in same cluster
}

let swarmHealth: SwarmHealth = {
    peerCount: 0,
    uploadBytes: 0,
    downloadBytes: 0,
    p2pRatio: 0,
    clusterPeerCount: 0,
};

export function updateSwarmHealth(update: Partial<SwarmHealth>): void {
    swarmHealth = { ...swarmHealth, ...update };
}

export function getSwarmHealth(): SwarmHealth {
    return { ...swarmHealth };
}
