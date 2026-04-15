export const BANDWIDTH_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB

interface GlobalWithTracker {
  ipBandwidthCache?: Map<string, number>;
}

export const ipBandwidthCache = (globalThis as GlobalWithTracker).ipBandwidthCache || new Map<string, number>();

if (process.env.NODE_ENV !== 'production') {
  (globalThis as GlobalWithTracker).ipBandwidthCache = ipBandwidthCache;
}
