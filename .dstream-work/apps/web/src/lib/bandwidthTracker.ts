export const DEFAULT_BANDWIDTH_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB
export const DEFAULT_BANDWIDTH_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface BandwidthUsageEntry {
  bytes: number;
  resetAtMs: number;
}

interface GlobalWithTracker {
  ipBandwidthCache?: Map<string, number | BandwidthUsageEntry>;
}

export const ipBandwidthCache: Map<string, number | BandwidthUsageEntry> =
  (globalThis as GlobalWithTracker).ipBandwidthCache || new Map<string, number | BandwidthUsageEntry>();

if (process.env.NODE_ENV !== 'production') {
  (globalThis as GlobalWithTracker).ipBandwidthCache = ipBandwidthCache;
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number((raw ?? "").trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function normalizeUsageEntry(value: number | BandwidthUsageEntry | undefined, nowMs: number): BandwidthUsageEntry {
  if (typeof value === "number") {
    return { bytes: Math.max(0, value), resetAtMs: nowMs + getBandwidthWindowMs() };
  }
  if (!value || typeof value !== "object") {
    return { bytes: 0, resetAtMs: nowMs + getBandwidthWindowMs() };
  }
  if (value.resetAtMs <= nowMs) {
    return { bytes: 0, resetAtMs: nowMs + getBandwidthWindowMs() };
  }
  return {
    bytes: Math.max(0, value.bytes),
    resetAtMs: value.resetAtMs
  };
}

function originOf(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function getBandwidthLimitBytes(): number {
  return parsePositiveInteger(process.env.DSTREAM_HLS_BANDWIDTH_LIMIT_BYTES, DEFAULT_BANDWIDTH_LIMIT_BYTES);
}

export function getBandwidthWindowMs(): number {
  return parsePositiveInteger(process.env.DSTREAM_HLS_BANDWIDTH_WINDOW_MS, DEFAULT_BANDWIDTH_WINDOW_MS);
}

export function getBandwidthUsageBytes(clientKey: string, nowMs = Date.now()): number {
  const entry = normalizeUsageEntry(ipBandwidthCache.get(clientKey), nowMs);
  if (entry.bytes === 0) {
    ipBandwidthCache.delete(clientKey);
    return 0;
  }
  ipBandwidthCache.set(clientKey, entry);
  return entry.bytes;
}

export function addBandwidthUsageBytes(clientKey: string, bytes: number, nowMs = Date.now()): number {
  const entry = normalizeUsageEntry(ipBandwidthCache.get(clientKey), nowMs);
  const next: BandwidthUsageEntry = {
    bytes: entry.bytes + Math.max(0, Math.floor(bytes)),
    resetAtMs: entry.resetAtMs
  };
  ipBandwidthCache.set(clientKey, next);
  return next.bytes;
}

export function shouldApplyHlsBandwidthLimit(input: {
  requestOrigin: string;
  referer: string | null;
  origin: string | null;
  secFetchSite: string | null;
  accessToken: string | null;
}): boolean {
  if (getBandwidthLimitBytes() <= 0) return false;
  if ((input.accessToken ?? "").trim()) return false;

  const requestOrigin = originOf(input.requestOrigin);
  if (!requestOrigin) return true;

  const fetchSite = (input.secFetchSite ?? "").trim().toLowerCase();
  if (fetchSite === "same-origin") return false;

  const refererOrigin = originOf(input.referer);
  if (refererOrigin && refererOrigin === requestOrigin) return false;

  const headerOrigin = originOf(input.origin);
  if (headerOrigin && headerOrigin === requestOrigin) return false;

  return true;
}
