import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { access as accessFile, appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { pubkeyParamToHex } from "./nostr-ids";
import { makeOriginStreamId } from "./origin";
import { isAllowedVodRecordingExtension, resolveVodStreamDir } from "./vod";
import { type VodCatalogEntry, type VodCatalogVisibility, type VodProcessingState, upsertVodCatalogEntry } from "./vodCatalog";

const PLAYLIST_ID_RE = /^(?:__root__|[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})$/;
const DEFAULT_SESSION_TTL_SEC = 60 * 60 * 2;
const MAX_UPLOAD_SIZE_BYTES = 1024 * 1024 * 1024 * 8;
const DEFAULT_CHUNK_SIZE_BYTES = 1024 * 1024 * 4;

export interface VodUploadSession {
  uploadId: string;
  uploadToken: string;
  hostPubkey: string;
  streamId: string;
  originStreamId: string;
  fileName: string;
  fileSizeBytes: number;
  receivedBytes: number;
  playlistId?: string;
  title?: string;
  description?: string;
  visibility: VodCatalogVisibility;
  processingState: VodProcessingState;
  published: boolean;
  thumbnailUrl?: string;
  tags: string[];
  createdAtSec: number;
  updatedAtSec: number;
  expiresAtSec: number;
}

export interface VodUploadSessionCleanupResult {
  scanned: number;
  removed: number;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function getUploadSessionRootDir(): string {
  const raw = (process.env.DSTREAM_VOD_UPLOAD_SESSION_DIR ?? "").trim();
  return raw || "/var/lib/dstream/vod-upload-sessions";
}

function sanitizeVisibility(input: string | null | undefined): VodCatalogVisibility {
  const value = (input ?? "").trim().toLowerCase();
  if (value === "private" || value === "unlisted" || value === "public") return value;
  return "public";
}

function sanitizeProcessingState(input: string | null | undefined): VodProcessingState {
  const value = (input ?? "").trim().toLowerCase();
  if (value === "ready" || value === "queued" || value === "processing" || value === "failed") return value;
  return "ready";
}

function sanitizePlaylistId(input: string | null | undefined): string | undefined {
  const value = (input ?? "").trim();
  if (!value) return undefined;
  return PLAYLIST_ID_RE.test(value) ? value : undefined;
}

function sanitizeShortText(input: string | null | undefined, maxLen: number): string | undefined {
  const value = (input ?? "").trim();
  if (!value) return undefined;
  return value.slice(0, maxLen);
}

function sanitizeFileName(input: string): string {
  const base = input
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.trim();
  const fallback = "recording.mp4";
  if (!base) return fallback;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+/, "");
  return cleaned || fallback;
}

function parseTags(tags: string[] | null | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return Array.from(
    new Set(
      tags
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, "-") : ""))
        .filter(Boolean)
    )
  ).slice(0, 24);
}

function sessionMetaPath(uploadId: string): string {
  return path.resolve(getUploadSessionRootDir(), `${uploadId}.json`);
}

function sessionPartPath(uploadId: string): string {
  return path.resolve(getUploadSessionRootDir(), `${uploadId}.part`);
}

async function readSession(uploadId: string): Promise<VodUploadSession> {
  const raw = await readFile(sessionMetaPath(uploadId), "utf8");
  const parsed = JSON.parse(raw) as VodUploadSession;
  if (!parsed || typeof parsed !== "object") throw new Error("Upload session is invalid.");
  if (parsed.uploadId !== uploadId) throw new Error("Upload session id mismatch.");
  if (parsed.expiresAtSec <= nowSec()) {
    await deleteSessionArtifacts(uploadId).catch(() => undefined);
    throw new Error("Upload session expired.");
  }
  return parsed;
}

async function writeSession(session: VodUploadSession): Promise<void> {
  await mkdir(getUploadSessionRootDir(), { recursive: true });
  await writeFile(sessionMetaPath(session.uploadId), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

async function ensureUploadFileDoesNotExist(filePath: string): Promise<boolean> {
  try {
    await accessFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findAvailableRelativePath(streamDir: string, desiredRelativePath: string): Promise<string> {
  const ext = path.extname(desiredRelativePath);
  const stem = ext ? desiredRelativePath.slice(0, -ext.length) : desiredRelativePath;
  let candidate = desiredRelativePath;
  let counter = 2;
  while (await ensureUploadFileDoesNotExist(path.resolve(streamDir, candidate))) {
    candidate = `${stem}-${counter}${ext}`;
    counter += 1;
    if (counter > 1000) throw new Error("Unable to allocate unique VOD filename.");
  }
  return candidate;
}

async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await rename(sourcePath, targetPath);
  } catch {
    const body = await readFile(sourcePath);
    await writeFile(targetPath, body);
    await rm(sourcePath, { force: true });
  }
}

async function deleteSessionArtifacts(uploadId: string): Promise<void> {
  await Promise.all([
    rm(sessionMetaPath(uploadId), { force: true }),
    rm(sessionPartPath(uploadId), { force: true })
  ]);
}

function parseUploadIdFromMetaFile(fileName: string): string | null {
  if (!fileName.endsWith(".json")) return null;
  const uploadId = fileName.slice(0, -5).trim();
  return uploadId ? uploadId : null;
}

export async function cleanupExpiredVodUploadSessions(limit = 200): Promise<VodUploadSessionCleanupResult> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 5000));
  const rootDir = getUploadSessionRootDir();
  let fileNames: string[] = [];
  try {
    fileNames = await readdir(rootDir);
  } catch {
    return { scanned: 0, removed: 0 };
  }

  const now = nowSec();
  let scanned = 0;
  let removed = 0;
  for (const fileName of fileNames) {
    if (scanned >= safeLimit) break;
    const uploadId = parseUploadIdFromMetaFile(fileName);
    if (!uploadId) continue;
    scanned += 1;
    try {
      const raw = await readFile(sessionMetaPath(uploadId), "utf8");
      const parsed = JSON.parse(raw) as { expiresAtSec?: unknown } | null;
      const expiresAtSec = Number(parsed?.expiresAtSec);
      if (!Number.isInteger(expiresAtSec) || expiresAtSec > now) continue;
      await deleteSessionArtifacts(uploadId);
      removed += 1;
    } catch {
      continue;
    }
  }

  return { scanned, removed };
}

export function resolveHostAndOrigin(hostRaw: string, streamIdRaw: string): {
  hostPubkey: string;
  streamId: string;
  originStreamId: string;
} {
  const hostPubkey = pubkeyParamToHex((hostRaw ?? "").trim()) ?? "";
  const streamId = decodeURIComponent(String(streamIdRaw ?? "")).trim();
  if (!hostPubkey) throw new Error("hostPubkey must be a valid npub or 64-hex pubkey.");
  const originStreamId = makeOriginStreamId(hostPubkey, streamId);
  if (!originStreamId) throw new Error("Invalid stream id for VOD upload.");
  return { hostPubkey, streamId, originStreamId };
}

export async function startVodUploadSession(input: {
  hostPubkey: string;
  streamId: string;
  originStreamId: string;
  fileName: string;
  fileSizeBytes: number;
  playlistId?: string;
  title?: string;
  description?: string;
  visibility?: string;
  processingState?: string;
  published?: boolean;
  thumbnailUrl?: string;
  tags?: string[];
}): Promise<{ session: VodUploadSession; chunkSizeBytes: number }> {
  await cleanupExpiredVodUploadSessions(300).catch(() => undefined);

  const safeFileName = sanitizeFileName(input.fileName);
  const extension = path.extname(safeFileName).toLowerCase();
  if (!isAllowedVodRecordingExtension(extension)) {
    throw new Error("Unsupported file extension. Allowed: .mp4, .m4s, .mkv, .ts, .webm, .mov");
  }
  const fileSizeBytes = Number.isFinite(input.fileSizeBytes) ? Math.floor(input.fileSizeBytes) : 0;
  if (fileSizeBytes <= 0) throw new Error("fileSizeBytes must be > 0.");
  if (fileSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error(`File exceeds max upload size (${Math.floor(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024 * 1024))}GB).`);
  }

  const createdAtSec = nowSec();
  const ttlSecRaw = Number.parseInt((process.env.DSTREAM_VOD_UPLOAD_SESSION_TTL_SEC ?? "").trim(), 10);
  const ttlSec = Number.isFinite(ttlSecRaw) && ttlSecRaw > 60 ? Math.min(ttlSecRaw, 60 * 60 * 12) : DEFAULT_SESSION_TTL_SEC;
  const session: VodUploadSession = {
    uploadId: randomUUID(),
    uploadToken: randomBytes(24).toString("hex"),
    hostPubkey: input.hostPubkey,
    streamId: input.streamId,
    originStreamId: input.originStreamId,
    fileName: safeFileName,
    fileSizeBytes,
    receivedBytes: 0,
    playlistId: sanitizePlaylistId(input.playlistId),
    title: sanitizeShortText(input.title, 180),
    description: sanitizeShortText(input.description, 1000),
    visibility: sanitizeVisibility(input.visibility),
    processingState: sanitizeProcessingState(input.processingState),
    published: input.published !== false,
    thumbnailUrl: sanitizeShortText(input.thumbnailUrl, 800),
    tags: parseTags(input.tags),
    createdAtSec,
    updatedAtSec: createdAtSec,
    expiresAtSec: createdAtSec + ttlSec
  };
  await writeSession(session);
  await writeFile(sessionPartPath(session.uploadId), new Uint8Array(0));
  return { session, chunkSizeBytes: DEFAULT_CHUNK_SIZE_BYTES };
}

export async function appendVodUploadSessionChunk(input: {
  uploadId: string;
  uploadToken: string;
  offset: number;
  bytes: Uint8Array;
}): Promise<{ receivedBytes: number; fileSizeBytes: number; completed: boolean }> {
  if (!input.bytes?.byteLength) throw new Error("Chunk body is empty.");
  // Enforce per-chunk size limit: 16MB max per individual chunk.
  const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
  if (input.bytes.byteLength > MAX_CHUNK_BYTES) {
    throw new Error(`Chunk too large (${input.bytes.byteLength} bytes). Maximum is ${MAX_CHUNK_BYTES} bytes.`);
  }
  const session = await readSession(input.uploadId);
  if (input.uploadToken !== session.uploadToken) throw new Error("Upload token mismatch.");
  if (!Number.isInteger(input.offset) || input.offset < 0) throw new Error("Chunk offset is invalid.");
  if (input.offset !== session.receivedBytes) {
    throw new Error(`Chunk offset mismatch. expected=${session.receivedBytes}`);
  }

  const nextSize = session.receivedBytes + input.bytes.byteLength;
  if (nextSize > session.fileSizeBytes) {
    throw new Error("Chunk exceeds declared file size.");
  }
  await appendFile(sessionPartPath(session.uploadId), input.bytes);
  session.receivedBytes = nextSize;
  session.updatedAtSec = nowSec();
  await writeSession(session);
  return {
    receivedBytes: session.receivedBytes,
    fileSizeBytes: session.fileSizeBytes,
    completed: session.receivedBytes >= session.fileSizeBytes
  };
}

export async function completeVodUploadSession(input: {
  uploadId: string;
  uploadToken: string;
}): Promise<{
  hostPubkey: string;
  streamId: string;
  originStreamId: string;
  relativePath: string;
  fileName: string;
  fileSizeBytes: number;
  entry: VodCatalogEntry;
}> {
  const session = await readSession(input.uploadId);
  if (input.uploadToken !== session.uploadToken) throw new Error("Upload token mismatch.");
  if (session.receivedBytes !== session.fileSizeBytes) {
    throw new Error(`Upload is incomplete (${session.receivedBytes}/${session.fileSizeBytes}).`);
  }

  const streamDir = resolveVodStreamDir(session.originStreamId);
  if (!streamDir) throw new Error("Invalid stream directory for VOD upload.");

  const relativePathBase = session.playlistId ? `${session.playlistId}/${session.fileName}` : session.fileName;
  const relativePath = await findAvailableRelativePath(streamDir, relativePathBase);
  const absolutePath = path.resolve(streamDir, relativePath);
  await moveFile(sessionPartPath(session.uploadId), absolutePath);

  const entry = upsertVodCatalogEntry({
    originStreamId: session.originStreamId,
    relativePath,
    title: session.title,
    description: session.description,
    playlistId: session.playlistId,
    visibility: session.visibility,
    processingState: session.processingState,
    processingError: undefined,
    thumbnailUrl: session.thumbnailUrl,
    tags: session.tags,
    published: session.published
  });

  await deleteSessionArtifacts(session.uploadId);
  return {
    hostPubkey: session.hostPubkey,
    streamId: session.streamId,
    originStreamId: session.originStreamId,
    relativePath,
    fileName: session.fileName,
    fileSizeBytes: session.fileSizeBytes,
    entry
  };
}

export async function abortVodUploadSession(input: { uploadId: string; uploadToken: string }): Promise<void> {
  const session = await readSession(input.uploadId);
  if (input.uploadToken !== session.uploadToken) throw new Error("Upload token mismatch.");
  await deleteSessionArtifacts(session.uploadId);
}
