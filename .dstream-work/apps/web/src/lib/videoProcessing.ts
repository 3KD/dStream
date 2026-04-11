import { stat } from "node:fs/promises";
import {
  getVideoCatalogEntry,
  listVideoCatalogEntries,
  listVideoCatalogOriginStreamIds,
  type VideoCatalogVisibility,
  type VideoCatalogEntry,
  type VideoProcessingState,
  upsertVideoCatalogEntry
} from "./videoCatalog";
import { listVideoRecordings, resolveVideoFile } from "./video";

export interface VideoProcessingResult {
  scanned: number;
  processed: number;
  ready: number;
  failed: number;
  skipped: number;
  errors: Array<{ relativePath: string; error: string }>;
}

export interface VideoHostProcessingStreamResult extends VideoProcessingResult {
  originStreamId: string;
}

export interface VideoHostProcessingResult extends VideoProcessingResult {
  hostPubkey: string;
  streamCount: number;
  streams: VideoHostProcessingStreamResult[];
}

export interface VideoCatalogSyncResult {
  totalFiles: number;
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function isProcessCandidate(entry: VideoCatalogEntry): boolean {
  return entry.processingState === "queued" || entry.processingState === "processing" || entry.processingState === "failed";
}

function derivePlaylistId(relativePath: string): string | undefined {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length <= 1) return undefined;
  const value = (parts[0] ?? "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return value || undefined;
}

export async function syncVideoCatalogEntriesFromFilesystem(input: {
  originStreamId: string;
  limit?: number;
  onlyMissing?: boolean;
  visibility?: VideoCatalogVisibility;
  processingState?: VideoProcessingState;
  published?: boolean;
}): Promise<VideoCatalogSyncResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 4000, 12000));
  const onlyMissing = input.onlyMissing !== false;
  const published = input.published ?? true;
  const visibilityOverride = input.visibility;
  const processingStateOverride = input.processingState;
  const { files } = await listVideoRecordings(input.originStreamId, {
    curatedOnly: false,
    includePrivate: true,
    includeUnlisted: true,
    includeUnpublished: true
  });
  const existingRows = listVideoCatalogEntries({
    originStreamId: input.originStreamId,
    includePrivate: true,
    includeUnlisted: true,
    includeUnpublished: true,
    limit: Math.max(limit * 2, 600)
  });
  const existingByPath = new Map(existingRows.map((entry) => [entry.relativePath, entry] as const));

  const result: VideoCatalogSyncResult = {
    totalFiles: files.length,
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0
  };

  for (const file of files) {
    if (result.scanned >= limit) break;
    result.scanned += 1;

    const existing = existingByPath.get(file.relativePath) ?? getVideoCatalogEntry(input.originStreamId, file.relativePath);
    if (existing && onlyMissing) {
      result.skipped += 1;
      continue;
    }

    const visibility = visibilityOverride ?? existing?.visibility ?? "public";
    const processingState = processingStateOverride ?? existing?.processingState ?? "ready";
    upsertVideoCatalogEntry({
      originStreamId: input.originStreamId,
      relativePath: file.relativePath,
      title: existing?.title ?? file.displayTitle,
      description: existing?.description ?? file.description,
      playlistId: existing?.playlistId ?? file.playlistId ?? derivePlaylistId(file.relativePath),
      orderIndex: existing?.orderIndex ?? file.orderIndex,
      visibility,
      processingState,
      processingError: undefined,
      thumbnailUrl: existing?.thumbnailUrl ?? file.thumbnailUrl,
      tags: existing?.tags ?? file.tags,
      published,
      publishedAtSec: existing?.publishedAtSec
    });
    if (existing) result.updated += 1;
    else result.created += 1;
  }

  return result;
}

async function validateVideoFile(originStreamId: string, relativePath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolved = resolveVideoFile(originStreamId, relativePath.split("/"));
  if (!resolved) return { ok: false, error: "invalid file path" };
  try {
    const file = await stat(resolved);
    if (!file.isFile()) return { ok: false, error: "file not found" };
    if (file.size <= 0) return { ok: false, error: "file is empty" };
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? "file stat failed" };
  }
}

export async function processVideoCatalogEntries(input: {
  originStreamId: string;
  limit?: number;
}): Promise<VideoProcessingResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 2000));
  const rows = listVideoCatalogEntries({
    originStreamId: input.originStreamId,
    includePrivate: true,
    includeUnlisted: true,
    includeUnpublished: true,
    limit: Math.max(limit * 4, 200)
  });

  const result: VideoProcessingResult = {
    scanned: rows.length,
    processed: 0,
    ready: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  for (const row of rows) {
    if (result.processed >= limit) break;
    if (!isProcessCandidate(row)) {
      result.skipped += 1;
      continue;
    }

    upsertVideoCatalogEntry({
      originStreamId: row.originStreamId,
      relativePath: row.relativePath,
      title: row.title,
      description: row.description,
      playlistId: row.playlistId,
      orderIndex: row.orderIndex,
      visibility: row.visibility,
      processingState: "processing",
      processingError: undefined,
      thumbnailUrl: row.thumbnailUrl,
      tags: row.tags,
      publishedAtSec: row.publishedAtSec
    });

    const checked = await validateVideoFile(input.originStreamId, row.relativePath);
    if (!checked.ok) {
      upsertVideoCatalogEntry({
        originStreamId: row.originStreamId,
        relativePath: row.relativePath,
        title: row.title,
        description: row.description,
        playlistId: row.playlistId,
        orderIndex: row.orderIndex,
        visibility: row.visibility,
        processingState: "failed",
        processingError: checked.error,
        thumbnailUrl: row.thumbnailUrl,
        tags: row.tags,
        publishedAtSec: row.publishedAtSec
      });
      result.failed += 1;
      result.processed += 1;
      result.errors.push({ relativePath: row.relativePath, error: checked.error });
      continue;
    }

    upsertVideoCatalogEntry({
      originStreamId: row.originStreamId,
      relativePath: row.relativePath,
      title: row.title,
      description: row.description,
      playlistId: row.playlistId,
      orderIndex: row.orderIndex,
      visibility: row.visibility,
      processingState: "ready",
      processingError: undefined,
      thumbnailUrl: row.thumbnailUrl,
      tags: row.tags,
      publishedAtSec: row.publishedAtSec
    });
    result.ready += 1;
    result.processed += 1;
  }

  return result;
}

function parseOriginHostPubkey(originStreamId: string): string | null {
  const value = originStreamId.trim().toLowerCase();
  const separatorIndex = value.indexOf("--");
  if (separatorIndex !== 64) return null;
  const hostPubkey = value.slice(0, separatorIndex);
  return /^[a-f0-9]{64}$/.test(hostPubkey) ? hostPubkey : null;
}

function emptyProcessingResult(): VideoProcessingResult {
  return {
    scanned: 0,
    processed: 0,
    ready: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };
}

export async function processVideoCatalogEntriesForHost(input: {
  hostPubkey: string;
  limit?: number;
  maxStreams?: number;
}): Promise<VideoHostProcessingResult> {
  const hostPubkey = input.hostPubkey.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hostPubkey)) throw new Error("hostPubkey is invalid.");

  const totalLimit = Math.max(1, Math.min(input.limit ?? 1000, 10000));
  const maxStreams = Math.max(1, Math.min(input.maxStreams ?? 400, 2000));
  const originStreamIds = listVideoCatalogOriginStreamIds(10000)
    .filter((originStreamId) => originStreamId.startsWith(`${hostPubkey}--`))
    .slice(0, maxStreams);

  const result: VideoHostProcessingResult = {
    ...emptyProcessingResult(),
    hostPubkey,
    streamCount: 0,
    streams: []
  };

  let remaining = totalLimit;
  for (const originStreamId of originStreamIds) {
    if (remaining <= 0) break;
    if (parseOriginHostPubkey(originStreamId) !== hostPubkey) continue;
    const streamResult = await processVideoCatalogEntries({ originStreamId, limit: remaining });
    result.streams.push({ originStreamId, ...streamResult });
    result.streamCount += 1;
    result.scanned += streamResult.scanned;
    result.processed += streamResult.processed;
    result.ready += streamResult.ready;
    result.failed += streamResult.failed;
    result.skipped += streamResult.skipped;
    result.errors.push(...streamResult.errors.map((row) => ({ relativePath: `${originStreamId}/${row.relativePath}`, error: row.error })));
    remaining = Math.max(0, totalLimit - result.processed);
  }

  return result;
}

export function formatProcessingResultNotice(result: VideoProcessingResult): string {
  return `Processed ${result.processed} entries at ${new Date(nowSec() * 1000).toLocaleTimeString()}: ${result.ready} ready, ${result.failed} failed, ${result.skipped} skipped.`;
}
