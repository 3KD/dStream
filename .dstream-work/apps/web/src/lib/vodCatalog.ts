import { createHash } from "node:crypto";
import { readTextFileWithBackup, writeJsonFileAtomic } from "./storage/jsonFileStore";

export type VodCatalogVisibility = "public" | "unlisted" | "private";
export type VodProcessingState = "ready" | "queued" | "processing" | "failed";

export interface VodCatalogEntry {
  id: string;
  originStreamId: string;
  hostPubkey: string;
  streamId: string;
  relativePath: string;
  title: string;
  description?: string;
  playlistId?: string;
  orderIndex?: number;
  visibility: VodCatalogVisibility;
  processingState: VodProcessingState;
  processingError?: string;
  processingUpdatedAtSec?: number;
  thumbnailUrl?: string;
  tags: string[];
  publishedAtSec?: number;
  createdAtSec: number;
  updatedAtSec: number;
}

interface VodCatalogStoreShape {
  version: number;
  updatedAtSec: number;
  entries: VodCatalogEntry[];
}

const DEFAULT_CATALOG_STORE_PATH = "/var/lib/dstream/vod-catalog.json";
const MAX_ENTRIES = 50000;
const STREAM_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const PLAYLIST_ID_RE = /^(?:__root__|[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})$/;

let loadedPath: string | null = null;
let loaded = false;
let entriesCache: VodCatalogEntry[] = [];

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function getStorePath(): string {
  const raw = (process.env.DSTREAM_VOD_CATALOG_STORE_PATH ?? "").trim();
  return raw || DEFAULT_CATALOG_STORE_PATH;
}

function normalizePubkeyHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function normalizeStreamId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return STREAM_ID_RE.test(value) ? value : null;
}

function normalizeRelativePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().replace(/\\/g, "/");
  if (!value) return null;
  const segments = value.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const safeSegments: string[] = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed === "." || trimmed === "..") return null;
    if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\u0000")) return null;
    safeSegments.push(trimmed);
  }
  return safeSegments.join("/");
}

function sanitizeShortText(input: unknown, maxLen = 500): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value) return undefined;
  return value.slice(0, maxLen);
}

function sanitizeUrl(input: unknown): string | undefined {
  const value = sanitizeShortText(input, 800);
  if (!value) return undefined;
  if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) return undefined;
  return value;
}

function sanitizePlaylistId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value) return undefined;
  return PLAYLIST_ID_RE.test(value) ? value : undefined;
}

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const values = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const normalized = raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 48);
    if (!normalized) continue;
    values.add(normalized);
  }
  return Array.from(values).slice(0, 24);
}

function parsePositiveInt(input: unknown): number | undefined {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return Math.trunc(value);
}

function parseOrderIndex(input: unknown): number | undefined {
  const value = Number(input);
  if (!Number.isInteger(value)) return undefined;
  if (value < 0 || value > 1_000_000_000) return undefined;
  return Math.trunc(value);
}

function parseVisibility(input: unknown): VodCatalogVisibility {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value === "private") return "private";
  if (value === "unlisted") return "unlisted";
  return "public";
}

function parseProcessingState(input: unknown): VodProcessingState {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value === "queued" || value === "processing" || value === "failed" || value === "ready") return value;
  return "ready";
}

function parseOriginStreamId(input: unknown): { originStreamId: string; hostPubkey: string; streamId: string } | null {
  if (typeof input !== "string") return null;
  const originStreamId = input.trim().toLowerCase();
  if (!originStreamId) return null;
  if (!/^[a-z0-9._:-]{3,220}$/i.test(originStreamId)) return null;
  if (originStreamId.includes("..") || originStreamId.includes("/") || originStreamId.includes("\\")) return null;
  const separatorIndex = originStreamId.indexOf("--");
  if (separatorIndex !== 64) return null;
  const hostPubkey = normalizePubkeyHex(originStreamId.slice(0, separatorIndex));
  const streamId = normalizeStreamId(originStreamId.slice(separatorIndex + 2));
  if (!hostPubkey || !streamId) return null;
  return { originStreamId, hostPubkey, streamId };
}

function entryKey(originStreamId: string, relativePath: string): string {
  return `${originStreamId}::${relativePath}`;
}

function entryId(originStreamId: string, relativePath: string): string {
  return createHash("sha256").update(entryKey(originStreamId, relativePath)).digest("hex").slice(0, 32);
}

function defaultTitleFromPath(relativePath: string): string {
  const last = relativePath.split("/").pop() ?? relativePath;
  const withoutExt = last.replace(/\.[a-z0-9]+$/i, "");
  const cleaned = withoutExt.replace(/[_-]+/g, " ").trim();
  return cleaned || last;
}

function parseStoredEntry(input: unknown): VodCatalogEntry | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<VodCatalogEntry>;
  const parsedOrigin = parseOriginStreamId(row.originStreamId);
  const relativePath = normalizeRelativePath(row.relativePath);
  if (!parsedOrigin || !relativePath) return null;
  const title = sanitizeShortText(row.title, 180) ?? defaultTitleFromPath(relativePath);
  const createdAtSec = parsePositiveInt(row.createdAtSec);
  const updatedAtSec = parsePositiveInt(row.updatedAtSec);
  if (!createdAtSec || !updatedAtSec) return null;
  return {
    id: sanitizeShortText(row.id, 120) ?? entryId(parsedOrigin.originStreamId, relativePath),
    originStreamId: parsedOrigin.originStreamId,
    hostPubkey: parsedOrigin.hostPubkey,
    streamId: parsedOrigin.streamId,
    relativePath,
    title,
    description: sanitizeShortText(row.description, 1000),
    playlistId: sanitizePlaylistId(row.playlistId),
    orderIndex: parseOrderIndex((row as { orderIndex?: unknown }).orderIndex),
    visibility: parseVisibility(row.visibility),
    processingState: parseProcessingState((row as { processingState?: unknown }).processingState),
    processingError: sanitizeShortText((row as { processingError?: unknown }).processingError, 1000),
    processingUpdatedAtSec: parsePositiveInt((row as { processingUpdatedAtSec?: unknown }).processingUpdatedAtSec),
    thumbnailUrl: sanitizeUrl(row.thumbnailUrl),
    tags: sanitizeTags(row.tags),
    publishedAtSec: parsePositiveInt(row.publishedAtSec),
    createdAtSec,
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
    if (!raw) throw new Error("no store");
    const parsed = JSON.parse(raw) as Partial<VodCatalogStoreShape> | null;
    const rows = Array.isArray(parsed?.entries) ? parsed?.entries ?? [] : [];
    entriesCache = rows.map(parseStoredEntry).filter((row): row is VodCatalogEntry => !!row);
  } catch {
    entriesCache = [];
  }
}

function persist(): void {
  const storePath = getStorePath();
  try {
    const payload: VodCatalogStoreShape = {
      version: 1,
      updatedAtSec: nowSec(),
      entries: entriesCache
    };
    writeJsonFileAtomic(storePath, payload);
  } catch {
    // ignore persistence errors
  }
}

export function listVodCatalogEntries(input: {
  originStreamId: string;
  includePrivate?: boolean;
  includeUnlisted?: boolean;
  includeUnpublished?: boolean;
  playlistId?: string;
  limit?: number;
}): VodCatalogEntry[] {
  ensureLoaded();
  const parsedOrigin = parseOriginStreamId(input.originStreamId);
  if (!parsedOrigin) return [];
  const includePrivate = !!input.includePrivate;
  const includeUnlisted = !!input.includeUnlisted;
  const includeUnpublished = !!input.includeUnpublished;
  const playlistId = sanitizePlaylistId(input.playlistId);
  const limit = Math.max(1, Math.min(input.limit ?? 500, 5000));
  return entriesCache
    .filter((row) => {
      if (row.originStreamId !== parsedOrigin.originStreamId) return false;
      if (playlistId && row.playlistId !== playlistId) return false;
      if (!includePrivate && row.visibility === "private") return false;
      if (!includeUnlisted && row.visibility === "unlisted") return false;
      if (!includeUnpublished && !row.publishedAtSec) return false;
      return true;
    })
    .sort((left, right) => {
      if (left.playlistId === right.playlistId) {
        const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      }
      const leftTime = left.publishedAtSec ?? left.updatedAtSec;
      const rightTime = right.publishedAtSec ?? right.updatedAtSec;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return left.relativePath.localeCompare(right.relativePath);
    })
    .slice(0, limit)
    .map((row) => ({ ...row, tags: [...row.tags] }));
}

export function listVodCatalogOriginStreamIds(limit = 1000): string[] {
  ensureLoaded();
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 10000));
  return Array.from(new Set(entriesCache.map((row) => row.originStreamId)))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, safeLimit);
}

export function getVodCatalogEntry(originStreamId: string, relativePath: string): VodCatalogEntry | null {
  ensureLoaded();
  const parsedOrigin = parseOriginStreamId(originStreamId);
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!parsedOrigin || !normalizedPath) return null;
  const row = entriesCache.find(
    (entry) => entry.originStreamId === parsedOrigin.originStreamId && entry.relativePath === normalizedPath
  );
  return row ? { ...row, tags: [...row.tags] } : null;
}

export function upsertVodCatalogEntry(input: {
  originStreamId: string;
  relativePath: string;
  title?: string;
  description?: string;
  playlistId?: string;
  orderIndex?: number;
  visibility?: VodCatalogVisibility;
  processingState?: VodProcessingState;
  processingError?: string;
  thumbnailUrl?: string;
  tags?: string[];
  published?: boolean;
  publishedAtSec?: number;
}): VodCatalogEntry {
  ensureLoaded();
  const parsedOrigin = parseOriginStreamId(input.originStreamId);
  const relativePath = normalizeRelativePath(input.relativePath);
  if (!parsedOrigin) throw new Error("originStreamId is invalid.");
  if (!relativePath) throw new Error("relativePath is invalid.");
  const title = sanitizeShortText(input.title, 180) ?? defaultTitleFromPath(relativePath);
  const timestamp = nowSec();

  const existing = entriesCache.find(
    (entry) => entry.originStreamId === parsedOrigin.originStreamId && entry.relativePath === relativePath
  );

  const normalizedVisibility = parseVisibility(input.visibility);
  const normalizedProcessingState =
    input.processingState === undefined ? undefined : parseProcessingState(input.processingState);
  const normalizedProcessingError = sanitizeShortText(input.processingError, 1000);
  const normalizedPublishedAt =
    parsePositiveInt(input.publishedAtSec) ??
    (input.published === false ? undefined : input.published === true ? timestamp : undefined);

  if (existing) {
    existing.title = title;
    existing.description = sanitizeShortText(input.description, 1000);
    existing.playlistId = sanitizePlaylistId(input.playlistId);
    existing.orderIndex = parseOrderIndex(input.orderIndex);
    existing.visibility = normalizedVisibility;
    if (normalizedProcessingState !== undefined) {
      existing.processingState = normalizedProcessingState;
      existing.processingUpdatedAtSec = timestamp;
      existing.processingError = normalizedProcessingError;
    }
    existing.thumbnailUrl = sanitizeUrl(input.thumbnailUrl);
    existing.tags = sanitizeTags(input.tags);
    if (input.published === false) {
      existing.publishedAtSec = undefined;
    } else if (normalizedPublishedAt) {
      existing.publishedAtSec = normalizedPublishedAt;
    } else if (input.published === true && !existing.publishedAtSec) {
      existing.publishedAtSec = timestamp;
    }
    existing.updatedAtSec = timestamp;
    persist();
    return { ...existing, tags: [...existing.tags] };
  }

  const created: VodCatalogEntry = {
    id: entryId(parsedOrigin.originStreamId, relativePath),
    originStreamId: parsedOrigin.originStreamId,
    hostPubkey: parsedOrigin.hostPubkey,
    streamId: parsedOrigin.streamId,
    relativePath,
    title,
    description: sanitizeShortText(input.description, 1000),
    playlistId: sanitizePlaylistId(input.playlistId),
    orderIndex: parseOrderIndex(input.orderIndex),
    visibility: normalizedVisibility,
    processingState: normalizedProcessingState ?? "ready",
    processingError: normalizedProcessingError,
    processingUpdatedAtSec: normalizedProcessingState ? timestamp : undefined,
    thumbnailUrl: sanitizeUrl(input.thumbnailUrl),
    tags: sanitizeTags(input.tags),
    publishedAtSec: input.published === false ? undefined : normalizedPublishedAt,
    createdAtSec: timestamp,
    updatedAtSec: timestamp
  };

  entriesCache.push(created);
  entriesCache = entriesCache
    .sort((left, right) => right.updatedAtSec - left.updatedAtSec)
    .slice(0, MAX_ENTRIES);
  persist();
  return { ...created, tags: [...created.tags] };
}

export function deleteVodCatalogEntry(input: { originStreamId: string; relativePath: string }): boolean {
  ensureLoaded();
  const parsedOrigin = parseOriginStreamId(input.originStreamId);
  const relativePath = normalizeRelativePath(input.relativePath);
  if (!parsedOrigin || !relativePath) return false;
  const before = entriesCache.length;
  entriesCache = entriesCache.filter(
    (entry) => !(entry.originStreamId === parsedOrigin.originStreamId && entry.relativePath === relativePath)
  );
  if (entriesCache.length === before) return false;
  persist();
  return true;
}
