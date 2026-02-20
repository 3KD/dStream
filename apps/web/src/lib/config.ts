// Single Source of Truth for Configuration

export const APP_CONFIG = {
    // Domain for stream keys (dStream standard)
    domain: "dstream.stream",
    name: "dStream",
};

// Infrastructure Ports (Direct)
export const PORTS = {
    APP: 4747,      // Non-standard to avoid conflicts
    WHIP: 8889,     // MediaMTX Direct
    HLS: 8888,      // MediaMTX Direct (Mapped in Docker)
};

// Relay Configuration - CLEAN LIST ONLY
export const RELAYS = [
    'ws://localhost:8081',   // Local Relay (Docker)
    'wss://relay.damus.io',  // Reliable Public Relay
    'wss://relay.snort.social',
    'wss://nos.lol',
];

// Media Configuration
export const MEDIA_CONFIG = {
    whipUrl: `/api/whip`,           // Proxied via Next.js
    hlsUrl: `/api/hls`,             // Proxied via Next.js
};

export const P2P_TRACKERS = [
    "wss://tracker.openwebtorrent.com",
    "wss://tracker.btorrent.xyz",
    "wss://tracker.webtorrent.io"
];
