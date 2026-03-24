import path from "node:path";
import { promises as fs } from "node:fs";
import { listVodCatalogEntries, type VodCatalogVisibility, type VodProcessingState } from "./vodCatalog";

const ALLOWED_RECORDING_EXTENSIONS = new Set([".mp4", ".m4s", ".mkv", ".ts", ".webm", ".mov"]);
const MAX_LIST_FILES = 256;

function normalizeVodRoot(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  return trimmed || "/recordings";
}

export function getVodRootDir(): string {
  return normalizeVodRoot(process.env.DSTREAM_VOD_DIR);
}

export function isAllowedVodRecordingExtension(extension: string | null | undefined): boolean {
  const value = (extension ?? "").trim().toLowerCase();
  return ALLOWED_RECORDING_EXTENSIONS.has(value);
}

export function isValidOriginStreamId(input: string | null | undefined): input is string {
  const value = (input ?? "").trim();
  if (!value) return false;
  return /^[a-z0-9._:-]{3,220}$/i.test(value) && !value.includes("..") && !value.includes("/") && !value.includes("\\");
}

export function resolveVodStreamDir(originStreamId: string): string | null {
  if (!isValidOriginStreamId(originStreamId)) return null;
  const root = getVodRootDir();
  return path.resolve(root, originStreamId);
}

function isUnder(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveVodFile(originStreamId: string, filePathSegments: string[]): string | null {
  const streamDir = resolveVodStreamDir(originStreamId);
  if (!streamDir) return null;
  if (!Array.isArray(filePathSegments) || filePathSegments.length === 0) return null;

  const safeSegments: string[] = [];
  for (const segmentRaw of filePathSegments) {
    const segment = decodeURIComponent(String(segmentRaw ?? "")).trim();
    if (!segment || segment === "." || segment === "..") return null;
    if (segment.includes("/") || segment.includes("\\") || segment.includes("\u0000")) return null;
    safeSegments.push(segment);
  }

  const resolved = path.resolve(streamDir, ...safeSegments);
  if (!isUnder(streamDir, resolved)) return null;
  return resolved;
}

function contentTypeByExt(ext: string): string {
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".m4s":
      return "video/iso.segment";
    case ".mkv":
      return "video/x-matroska";
    case ".ts":
      return "video/mp2t";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

export function getVodFileContentType(filePath: string): string {
  return contentTypeByExt(path.extname(filePath).toLowerCase());
}

export interface VodRecordingFile {
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  url: string;
  catalogEntryId?: string;
  displayTitle?: string;
  description?: string;
  playlistId?: string;
  orderIndex?: number;
  visibility?: VodCatalogVisibility;
  processingState?: VodProcessingState;
  processingError?: string;
  processingUpdatedAtSec?: number;
  publishedAtSec?: number;
  thumbnailUrl?: string;
  tags?: string[];
}

export interface VodListOptions {
  curatedOnly?: boolean;
  includePrivate?: boolean;
  includeUnlisted?: boolean;
  includeUnpublished?: boolean;
  readyOnly?: boolean;
  playlistId?: string;
}

async function walkRecordingFiles(
  dir: string,
  streamDir: string,
  output: VodRecordingFile[],
  depth: number
): Promise<void> {
  if (output.length >= MAX_LIST_FILES) return;
  if (depth > 6) return;

  let entries: Array<import("node:fs").Dirent<string>>;
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" })) as Array<import("node:fs").Dirent<string>>;
  } catch {
    return;
  }

  for (const entry of entries) {
    if (output.length >= MAX_LIST_FILES) break;
    const absolute = path.resolve(dir, entry.name);
    if (!isUnder(streamDir, absolute)) continue;

    if (entry.isDirectory()) {
      await walkRecordingFiles(absolute, streamDir, output, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!isAllowedVodRecordingExtension(ext)) continue;

    try {
      const stat = await fs.stat(absolute);
      const relativePath = path.relative(streamDir, absolute).split(path.sep).join("/");
      if (!relativePath || relativePath.startsWith("../")) continue;
      output.push({
        name: entry.name,
        relativePath,
        sizeBytes: stat.size,
        modifiedAtMs: stat.mtimeMs,
        url: ""
      });
    } catch {
      // ignore missing/inaccessible files
    }
  }
}

export async function listVodRecordings(
  originStreamId: string,
  options?: VodListOptions
): Promise<{ files: VodRecordingFile[]; streamDir: string | null }> {
  const streamDir = resolveVodStreamDir(originStreamId);
  if (!streamDir) return { files: [], streamDir: null };

  try {
    const stat = await fs.stat(streamDir);
    if (!stat.isDirectory()) return { files: [], streamDir };
  } catch {
    return { files: [], streamDir };
  }

  const files: VodRecordingFile[] = [];
  await walkRecordingFiles(streamDir, streamDir, files, 0);
  files.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);

  const includePrivate = options?.includePrivate ?? true;
  const includeUnlisted = options?.includeUnlisted ?? true;
  const includeUnpublished = options?.includeUnpublished ?? true;
  const readyOnly = options?.readyOnly === true;
  const curatedOnly = options?.curatedOnly === true;
  const playlistId = options?.playlistId;

  const catalogEntries = listVodCatalogEntries({
    originStreamId,
    includePrivate: true,
    includeUnlisted: true,
    includeUnpublished: true,
    limit: MAX_LIST_FILES * 8
  });
  const catalogByPath = new Map(catalogEntries.map((entry) => [entry.relativePath, entry] as const));

  const filtered: VodRecordingFile[] = [];
  for (const file of files) {
    const catalog = catalogByPath.get(file.relativePath);
    if (curatedOnly && !catalog) continue;

    if (playlistId) {
      if (!catalog || catalog.playlistId !== playlistId) continue;
    }

    if (catalog) {
      if (!includePrivate && catalog.visibility === "private") continue;
      if (!includeUnlisted && catalog.visibility === "unlisted") continue;
      if (!includeUnpublished && !catalog.publishedAtSec) continue;
      if (readyOnly && catalog.processingState !== "ready") continue;
      file.catalogEntryId = catalog.id;
      file.displayTitle = catalog.title;
      file.description = catalog.description;
      file.playlistId = catalog.playlistId;
      file.orderIndex = catalog.orderIndex;
      file.visibility = catalog.visibility;
      file.processingState = catalog.processingState;
      file.processingError = catalog.processingError;
      file.processingUpdatedAtSec = catalog.processingUpdatedAtSec;
      file.publishedAtSec = catalog.publishedAtSec;
      file.thumbnailUrl = catalog.thumbnailUrl;
      file.tags = catalog.tags;
    } else if (!includeUnpublished) {
      continue;
    } else if (readyOnly) {
      continue;
    }

    filtered.push(file);
  }

  filtered.sort((left, right) => {
    const leftPlaylist = left.playlistId ?? "__root__";
    const rightPlaylist = right.playlistId ?? "__root__";
    if (leftPlaylist === rightPlaylist) {
      const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const leftTime = left.publishedAtSec ?? Math.floor(left.modifiedAtMs / 1000);
      const rightTime = right.publishedAtSec ?? Math.floor(right.modifiedAtMs / 1000);
      if (rightTime !== leftTime) return rightTime - leftTime;
      return left.relativePath.localeCompare(right.relativePath);
    }
    return leftPlaylist.localeCompare(rightPlaylist);
  });

  for (const file of filtered) {
    const parts = file.relativePath.split("/").map((segment) => encodeURIComponent(segment));
    file.url = `/api/vod/file/${encodeURIComponent(originStreamId)}/${parts.join("/")}`;
  }

  return { files: filtered, streamDir };
}
