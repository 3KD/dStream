import { createHash } from "node:crypto";
import { readTextFileWithBackup, writeJsonFileAtomic } from "./storage/jsonFileStore";
import { getVodCatalogEntry } from "./vodCatalog";

const DEFAULT_STORE_PATH = "/var/lib/dstream/vod-analytics.json";
const MAX_ENTRIES = 100_000;
const MAX_UNIQUE_VIEWERS_PER_ENTRY = 12_000;
const STREAM_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

interface VodAnalyticsStoreShape {
  version: number;
  updatedAtSec: number;
  entries: VodAnalyticsEntry[];
}

interface VodAnalyticsEntry {
  id: string;
  originStreamId: string;
  hostPubkey: string;
  streamId: string;
  relativePath: string;
  title?: string;
  playlistId?: string;
  firstSeenAtSec: number;
  lastSeenAtSec: number;
  heartbeatCount: number;
  totalWatchSec: number;
  uniqueViewerHashes: string[];
  lastCurrentTimeSec?: number;
  lastPlaybackMode?: "live" | "vod";
  updatedAtSec: number;
}

export interface VodAnalyticsSummaryRow {
  originStreamId: string;
  hostPubkey: string;
  streamId: string;
  relativePath: string;
  title?: string;
  playlistId?: string;
  firstSeenAtSec: number;
  lastSeenAtSec: number;
  heartbeatCount: number;
  totalWatchSec: number;
  uniqueViewerCount: number;
  lastCurrentTimeSec?: number;
  lastPlaybackMode?: "live" | "vod";
  updatedAtSec: number;
}

let loaded = false;
let loadedPath: string | null = null;
let entriesCache: VodAnalyticsEntry[] = [];

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function getStorePath(): string {
  const raw = (process.env.DSTREAM_VOD_ANALYTICS_STORE_PATH ?? "").trim();
  return raw || DEFAULT_STORE_PATH;
}

function parseOriginStreamIdentity(originStreamId: string): { originStreamId: string; hostPubkey: string; streamId: string } | null {
  const value = (originStreamId ?? "").trim().toLowerCase();
  const separatorIndex = value.indexOf("--");
  if (separatorIndex !== 64) return null;
  const hostPubkey = value.slice(0, separatorIndex);
  const streamId = value.slice(separatorIndex + 2);
  if (!/^[a-f0-9]{64}$/.test(hostPubkey)) return null;
  if (!STREAM_ID_RE.test(streamId)) return null;
  return { originStreamId: value, hostPubkey, streamId };
}

function normalizeRelativePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().replace(/\\/g, "/");
  if (!value || value.includes("..")) return null;
  const segments = value.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return null;
    if (segment.includes("/") || segment.includes("\\") || segment.includes("\u0000")) return null;
  }
  return segments.join("/");
}

function parsePositiveInt(input: unknown): number | undefined {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return Math.trunc(value);
}

function normalizePlaybackMode(input: unknown): "live" | "vod" | undefined {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value === "live" || value === "vod") return value;
  return undefined;
}

function hashViewerId(viewerId: string): string {
  return createHash("sha256").update(viewerId).digest("hex").slice(0, 24);
}

function sanitizeViewerId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim().toLowerCase();
  if (!value) return undefined;
  if (value.length < 3) return undefined;
  return value.slice(0, 200);
}

function toSummaryRow(entry: VodAnalyticsEntry): VodAnalyticsSummaryRow {
  return {
    originStreamId: entry.originStreamId,
    hostPubkey: entry.hostPubkey,
    streamId: entry.streamId,
    relativePath: entry.relativePath,
    title: entry.title,
    playlistId: entry.playlistId,
    firstSeenAtSec: entry.firstSeenAtSec,
    lastSeenAtSec: entry.lastSeenAtSec,
    heartbeatCount: entry.heartbeatCount,
    totalWatchSec: entry.totalWatchSec,
    uniqueViewerCount: entry.uniqueViewerHashes.length,
    lastCurrentTimeSec: entry.lastCurrentTimeSec,
    lastPlaybackMode: entry.lastPlaybackMode,
    updatedAtSec: entry.updatedAtSec
  };
}

function sanitizeStoredEntry(input: unknown): VodAnalyticsEntry | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<VodAnalyticsEntry>;
  const parsed = parseOriginStreamIdentity(String(row.originStreamId ?? ""));
  const relativePath = normalizeRelativePath(row.relativePath);
  if (!parsed || !relativePath) return null;
  const firstSeenAtSec = parsePositiveInt(row.firstSeenAtSec);
  const lastSeenAtSec = parsePositiveInt(row.lastSeenAtSec);
  const heartbeatCount = parsePositiveInt(row.heartbeatCount);
  const totalWatchSec = parsePositiveInt(row.totalWatchSec);
  const updatedAtSec = parsePositiveInt(row.updatedAtSec);
  if (!firstSeenAtSec || !lastSeenAtSec || !heartbeatCount || !totalWatchSec || !updatedAtSec) return null;
  const uniqueViewerHashes = Array.isArray(row.uniqueViewerHashes)
    ? row.uniqueViewerHashes.filter((value): value is string => typeof value === "string" && /^[a-f0-9]{24}$/.test(value))
    : [];
  return {
    id:
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim()
        : createHash("sha256").update(`${parsed.originStreamId}::${relativePath}`).digest("hex").slice(0, 32),
    originStreamId: parsed.originStreamId,
    hostPubkey: parsed.hostPubkey,
    streamId: parsed.streamId,
    relativePath,
    title: typeof row.title === "string" ? row.title.trim().slice(0, 180) : undefined,
    playlistId: typeof row.playlistId === "string" ? row.playlistId.trim().slice(0, 80) : undefined,
    firstSeenAtSec,
    lastSeenAtSec,
    heartbeatCount,
    totalWatchSec,
    uniqueViewerHashes: uniqueViewerHashes.slice(0, MAX_UNIQUE_VIEWERS_PER_ENTRY),
    lastCurrentTimeSec: parsePositiveInt(row.lastCurrentTimeSec),
    lastPlaybackMode: normalizePlaybackMode(row.lastPlaybackMode),
    updatedAtSec
  };
}

function ensureLoaded(): void {
  const storePath = getStorePath();
  if (loaded && loadedPath === storePath) return;
  loaded = true;
  loadedPath = storePath;
  try {
    const raw = readTextFileWithBackup(storePath);
    if (!raw) throw new Error("missing store");
    const parsed = JSON.parse(raw) as Partial<VodAnalyticsStoreShape> | null;
    const rows = Array.isArray(parsed?.entries) ? parsed.entries : [];
    entriesCache = rows.map(sanitizeStoredEntry).filter((row): row is VodAnalyticsEntry => !!row);
  } catch {
    entriesCache = [];
  }
}

function persist(): void {
  try {
    writeJsonFileAtomic(getStorePath(), {
      version: 1,
      updatedAtSec: nowSec(),
      entries: entriesCache
    } satisfies VodAnalyticsStoreShape);
  } catch {
    // ignore persistence errors
  }
}

export function recordVodAnalyticsHeartbeat(input: {
  originStreamId: string;
  relativePath: string;
  viewerId?: string;
  elapsedSec?: number;
  currentTimeSec?: number;
  playbackMode?: "live" | "vod";
}): VodAnalyticsSummaryRow {
  ensureLoaded();
  const parsed = parseOriginStreamIdentity(input.originStreamId);
  const relativePath = normalizeRelativePath(input.relativePath);
  if (!parsed) throw new Error("originStreamId is invalid.");
  if (!relativePath) throw new Error("relativePath is invalid.");

  const key = `${parsed.originStreamId}::${relativePath}`;
  const id = createHash("sha256").update(key).digest("hex").slice(0, 32);
  const timestamp = nowSec();
  const elapsedSec = Math.max(0, Math.min(Math.trunc(Number(input.elapsedSec) || 0), 120));
  const viewerId = sanitizeViewerId(input.viewerId);
  const viewerHash = viewerId ? hashViewerId(viewerId) : null;
  const currentTimeSec = parsePositiveInt(input.currentTimeSec);
  const playbackMode = normalizePlaybackMode(input.playbackMode);
  const catalogEntry = getVodCatalogEntry(parsed.originStreamId, relativePath);

  let row = entriesCache.find((entry) => entry.id === id);
  if (!row) {
    row = {
      id,
      originStreamId: parsed.originStreamId,
      hostPubkey: parsed.hostPubkey,
      streamId: parsed.streamId,
      relativePath,
      title: catalogEntry?.title,
      playlistId: catalogEntry?.playlistId,
      firstSeenAtSec: timestamp,
      lastSeenAtSec: timestamp,
      heartbeatCount: 0,
      totalWatchSec: 0,
      uniqueViewerHashes: [],
      updatedAtSec: timestamp
    };
    entriesCache.push(row);
    if (entriesCache.length > MAX_ENTRIES) {
      entriesCache = entriesCache
        .sort((left, right) => right.lastSeenAtSec - left.lastSeenAtSec)
        .slice(0, MAX_ENTRIES);
    }
  }

  row.lastSeenAtSec = timestamp;
  row.heartbeatCount += 1;
  row.totalWatchSec += elapsedSec;
  if (viewerHash && !row.uniqueViewerHashes.includes(viewerHash)) {
    row.uniqueViewerHashes.push(viewerHash);
    if (row.uniqueViewerHashes.length > MAX_UNIQUE_VIEWERS_PER_ENTRY) {
      row.uniqueViewerHashes = row.uniqueViewerHashes.slice(-MAX_UNIQUE_VIEWERS_PER_ENTRY);
    }
  }
  if (currentTimeSec) row.lastCurrentTimeSec = currentTimeSec;
  if (playbackMode) row.lastPlaybackMode = playbackMode;
  if (catalogEntry?.title) row.title = catalogEntry.title;
  if (catalogEntry?.playlistId) row.playlistId = catalogEntry.playlistId;
  row.updatedAtSec = timestamp;

  persist();
  return toSummaryRow(row);
}

export function listVodAnalyticsSummary(input: {
  originStreamId: string;
  playlistId?: string;
  relativePath?: string;
  limit?: number;
}): VodAnalyticsSummaryRow[] {
  ensureLoaded();
  const parsed = parseOriginStreamIdentity(input.originStreamId);
  if (!parsed) return [];
  const relativePath = normalizeRelativePath(input.relativePath);
  const playlistId = typeof input.playlistId === "string" ? input.playlistId.trim() || undefined : undefined;
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 200), 2000));

  return entriesCache
    .filter((row) => {
      if (row.originStreamId !== parsed.originStreamId) return false;
      if (relativePath && row.relativePath !== relativePath) return false;
      if (playlistId && (row.playlistId ?? "__root__") !== playlistId) return false;
      return true;
    })
    .sort((left, right) => {
      if (right.lastSeenAtSec !== left.lastSeenAtSec) return right.lastSeenAtSec - left.lastSeenAtSec;
      if (right.totalWatchSec !== left.totalWatchSec) return right.totalWatchSec - left.totalWatchSec;
      return left.relativePath.localeCompare(right.relativePath);
    })
    .slice(0, limit)
    .map(toSummaryRow);
}

