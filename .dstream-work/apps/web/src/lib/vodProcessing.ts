import { stat } from "node:fs/promises";
import {
  getVodCatalogEntry,
  listVodCatalogEntries,
  listVodCatalogOriginStreamIds,
  type VodCatalogVisibility,
  type VodCatalogEntry,
  type VodProcessingState,
  upsertVodCatalogEntry
} from "./vodCatalog";
import { listVodRecordings, resolveVodFile } from "./vod";

export interface VodProcessingResult {
  scanned: number;
  processed: number;
  ready: number;
  failed: number;
  skipped: number;
  errors: Array<{ relativePath: string; error: string }>;
}

export interface VodHostProcessingStreamResult extends VodProcessingResult {
  originStreamId: string;
}

export interface VodHostProcessingResult extends VodProcessingResult {
  hostPubkey: string;
  streamCount: number;
  streams: VodHostProcessingStreamResult[];
}

export interface VodCatalogSyncResult {
  totalFiles: number;
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function isProcessCandidate(entry: VodCatalogEntry): boolean {
  return entry.processingState === "queued" || entry.processingState === "processing" || entry.processingState === "failed";
}

function derivePlaylistId(relativePath: string): string | undefined {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length <= 1) return undefined;
  const value = (parts[0] ?? "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return value || undefined;
}

export async function syncVodCatalogEntriesFromFilesystem(input: {
  originStreamId: string;
  limit?: number;
  onlyMissing?: boolean;
  visibility?: VodCatalogVisibility;
  processingState?: VodProcessingState;
  published?: boolean;
}): Promise<VodCatalogSyncResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 4000, 12000));
  const onlyMissing = input.onlyMissing !== false;
  const published = input.published ?? true;
  const visibilityOverride = input.visibility;
  const processingStateOverride = input.processingState;
  const { files } = await listVodRecordings(input.originStreamId, {
    curatedOnly: false,
    includePrivate: true,
    includeUnlisted: true,
    includeUnpublished: true
  });
  const existingRows = listVodCatalogEntries({
    originStreamId: input.originStreamId,
    includePrivate: true,
    includeUnlisted: true,
    includeUnpublished: true,
    limit: Math.max(limit * 2, 600)
  });
  const existingByPath = new Map(existingRows.map((entry) => [entry.relativePath, entry] as const));

  const result: VodCatalogSyncResult = {
    totalFiles: files.length,
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0
  };

  for (const file of files) {
    if (result.scanned >= limit) break;
    result.scanned += 1;

    const existing = existingByPath.get(file.relativePath) ?? getVodCatalogEntry(input.originStreamId, file.relativePath);
    if (existing && onlyMissing) {
      result.skipped += 1;
      continue;
    }

    const visibility = visibilityOverride ?? existing?.visibility ?? "public";
    const processingState = processingStateOverride ?? existing?.processingState ?? "ready";
    upsertVodCatalogEntry({
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

async function validateVodFile(originStreamId: string, relativePath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolved = resolveVodFile(originStreamId, relativePath.split("/"));
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

export async function processVodCatalogEntries(input: {
  originStreamId: string;
  limit?: number;
}): Promise<VodProcessingResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 2000));
  const rows = listVodCatalogEntries({
    originStreamId: input.originStreamId,
    includePrivate: true,
    includeUnlisted: true,
    includeUnpublished: true,
    limit: Math.max(limit * 4, 200)
  });

  const result: VodProcessingResult = {
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

    upsertVodCatalogEntry({
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

    const checked = await validateVodFile(input.originStreamId, row.relativePath);
    if (!checked.ok) {
      upsertVodCatalogEntry({
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

    upsertVodCatalogEntry({
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

function emptyProcessingResult(): VodProcessingResult {
  return {
    scanned: 0,
    processed: 0,
    ready: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };
}

export async function processVodCatalogEntriesForHost(input: {
  hostPubkey: string;
  limit?: number;
  maxStreams?: number;
}): Promise<VodHostProcessingResult> {
  const hostPubkey = input.hostPubkey.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hostPubkey)) throw new Error("hostPubkey is invalid.");

  const totalLimit = Math.max(1, Math.min(input.limit ?? 1000, 10000));
  const maxStreams = Math.max(1, Math.min(input.maxStreams ?? 400, 2000));
  const originStreamIds = listVodCatalogOriginStreamIds(10000)
    .filter((originStreamId) => originStreamId.startsWith(`${hostPubkey}--`))
    .slice(0, maxStreams);

  const result: VodHostProcessingResult = {
    ...emptyProcessingResult(),
    hostPubkey,
    streamCount: 0,
    streams: []
  };

  let remaining = totalLimit;
  for (const originStreamId of originStreamIds) {
    if (remaining <= 0) break;
    if (parseOriginHostPubkey(originStreamId) !== hostPubkey) continue;
    const streamResult = await processVodCatalogEntries({ originStreamId, limit: remaining });
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

export function formatProcessingResultNotice(result: VodProcessingResult): string {
  return `Processed ${result.processed} entries at ${new Date(nowSec() * 1000).toLocaleTimeString()}: ${result.ready} ready, ${result.failed} failed, ${result.skipped} skipped.`;
}
