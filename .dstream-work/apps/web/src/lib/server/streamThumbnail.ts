import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { issueMediaServiceCredential } from "../../../../../services/media-auth.mjs";
import { manualThumbnailUrl, publicThumbnailUrl, type StreamThumbnail, type ThumbnailMode } from "../streamThumbnail";

const ID = /^[a-f0-9]{64}--[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export const THUMBNAIL_UPLOAD_LIMIT = 2 * 1024 * 1024;
const RETRY_MS = 30_000;
const pending = new Map<string, Promise<ThumbnailRecord>>();
let activeDecoders = 0;

export interface ThumbnailRecord {
  mode: ThumbnailMode;
  revision: number;
  digest?: string;
  manualUrl?: string;
  active: boolean;
  retryAt: number;
  needsManualImage?: boolean;
  privateStream?: boolean;
  privateCaptureAllowed?: boolean;
}

export class ThumbnailConflict extends Error {}

function directory(id: string): string {
  if (!ID.test(id)) throw new Error("Invalid stream identity.");
  return path.join(process.env.DSTREAM_THUMBNAIL_DIR?.trim() || "/var/lib/dstream/thumbnails", id);
}

export function readThumbnail(id: string): ThumbnailRecord | null {
  try {
    return JSON.parse(readFileSync(path.join(directory(id), "current.json"), "utf8")) as ThumbnailRecord;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function update(id: string, change: (record: ThumbnailRecord | null) => ThumbnailRecord): ThumbnailRecord {
  const dir = directory(id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, "write.lock");
  let handle: number;
  try { handle = openSync(lock, "wx", 0o600); }
  catch { throw new ThumbnailConflict("Thumbnail is being updated; retry shortly."); }
  const temporary = path.join(dir, `${randomUUID()}.json.tmp`);
  try {
    const next = change(readThumbnail(id));
    const serialized = JSON.stringify(next);
    writeFileSync(temporary, serialized, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path.join(dir, "current.json"));
    return JSON.parse(serialized) as ThumbnailRecord;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    closeSync(handle);
    unlinkSync(lock);
  }
}

export function thumbnailState(id: string, origin: string, record: ThumbnailRecord): StreamThumbnail {
  return {
    mode: record.mode, revision: record.revision,
    source: record.mode === "off" ? "off" : record.needsManualImage ? "pending" : record.mode === "manual" ? "manual" : record.digest ? "generated" : "pending",
    imageUrl: record.mode === "off" ? undefined : record.manualUrl || `${publicThumbnailUrl(origin, id)}${record.digest ? `?v=${record.digest}` : ""}`,
    retryAt: record.retryAt,
    privateStream: record.privateStream === true,
    privateCaptureAllowed: record.privateCaptureAllowed === true,
    warning: record.needsManualImage ? "The previous cover is not a public HTTPS image URL. Upload a cover, enter a valid URL or explicitly choose automatic capture." : undefined
  };
}

export function ensureThumbnail(id: string, input: { image?: string; disabled?: boolean; active?: boolean; privateStream?: boolean }): ThumbnailRecord {
  const current = readThumbnail(id);
  if (current && (input.active === undefined || input.active === current.active) &&
    (input.privateStream === undefined || input.privateStream === !!current.privateStream)) return current;
  return update(id, (previous) => {
    if (previous) {
      const privateStream = input.privateStream ?? previous.privateStream ?? false;
      const changed = privateStream !== !!previous.privateStream;
      return { ...previous, active: input.active ?? previous.active, privateStream,
        revision: previous.revision + (changed ? 1 : 0),
        digest: privateStream && !previous.privateCaptureAllowed && previous.mode === "automatic" ? undefined : previous.digest };
    }
    const image = input.image?.trim();
    let manualUrl: string | undefined;
    if (image && !input.disabled) {
      try { manualUrl = manualThumbnailUrl(image); } catch { /* Keep manual ownership without publishing an unsafe legacy URL. */ }
    }
    return { mode: input.disabled ? "off" : image ? "manual" : "automatic", revision: 1,
      manualUrl, needsManualImage: !!image && !input.disabled && !manualUrl,
      active: input.active ?? false, retryAt: 0, privateStream: input.privateStream ?? false, privateCaptureAllowed: false };
  });
}

export function configureThumbnail(id: string, expected: number, mode: ThumbnailMode, image?: string, jpeg?: Buffer, privateCaptureAllowed?: boolean): ThumbnailRecord {
  return update(id, (previous) => {
    if (!previous || previous.revision !== expected) throw new ThumbnailConflict("Thumbnail changed. Reload its current settings before replacing it.");
    const digest = jpeg ? storeJpeg(id, jpeg) : undefined;
    const allowPrivate = privateCaptureAllowed ?? previous.privateCaptureAllowed ?? false;
    if (mode === "manual" && !image && !digest) throw new Error("Choose an image first.");
    return { mode, revision: previous.revision + 1, active: previous.active, retryAt: 0,
      privateStream: previous.privateStream ?? false, privateCaptureAllowed: allowPrivate,
      manualUrl: mode === "manual" && image ? manualThumbnailUrl(image) : undefined,
      digest: mode === "manual" ? digest : mode === "automatic" && previous.mode === "automatic" && (!previous.privateStream || allowPrivate) ? previous.digest : undefined };
  });
}

export function thumbnailJpeg(id: string, record: ThumbnailRecord): Buffer | null {
  return record.digest ? readFileSync(path.join(directory(id), `${record.digest}.jpg`)) : null;
}

function storeJpeg(id: string, jpeg: Buffer): string {
  if (jpeg.length < 4 || jpeg.length > THUMBNAIL_UPLOAD_LIMIT || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("Invalid thumbnail JPEG.");
  const digest = createHash("sha256").update(jpeg).digest("hex");
  const dir = directory(id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(path.join(dir, `${digest}.jpg`)) && readdirSync(dir).filter((name) => name.endsWith(".jpg")).length >= 32) {
    throw new Error("Thumbnail version limit reached. Ask the node operator to archive old thumbnail derivatives.");
  }
  try { writeFileSync(path.join(dir, `${digest}.jpg`), jpeg, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
  return digest;
}

// Only operator-configured ingest URLs reach the decoder. Request URLs are never decoder inputs.
export async function decodeThumbnail(input: string | Buffer, readAuthorization?: string): Promise<Buffer> {
  if (activeDecoders >= 2) throw new Error("Thumbnail decoding is busy; retry shortly.");
  if (Buffer.isBuffer(input) && input.length > THUMBNAIL_UPLOAD_LIMIT) throw new Error("Thumbnail input is too large.");
  if (Buffer.isBuffer(input) && (input[0] !== 0xff || input[1] !== 0xd8)) throw new Error("Upload a normalized JPEG image.");
  activeDecoders += 1;
  try { return await new Promise<Buffer>((resolve, reject) => {
    const child = execFile(process.env.DSTREAM_FFMPEG_PATH?.trim() || "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1", "-filter_threads", "1", "-max_alloc", "33554432",
      ...(typeof input === "string" ? ["-rw_timeout", "5000000", "-protocol_whitelist", "http,https,tcp,tls,crypto"] : ["-protocol_whitelist", "pipe", "-f", "image2pipe", "-c:v", "mjpeg"]),
      ...(readAuthorization ? ["-headers", `Authorization: Bearer ${readAuthorization}\r\n`] : []),
      "-probesize", "2097152", "-analyzeduration", "3000000", "-i", typeof input === "string" ? input : "pipe:0", "-an", "-sn", "-dn",
      "-vf", `${typeof input === "string" ? "blackframe=amount=0:threshold=32,metadata=mode=select:key=lavfi.blackframe.pblack:value=98:function=less," : ""}thumbnail=12,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      "-frames:v", "1", "-threads", "1", "-map_metadata", "-1", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3", "pipe:1"
    ], { encoding: "buffer", timeout: 12_000, maxBuffer: THUMBNAIL_UPLOAD_LIMIT }, (error, stdout) => {
      if (error || stdout.length < 4) reject(new Error("A video frame is not available yet; thumbnail generation will retry."));
      else resolve(stdout);
    });
    if (Buffer.isBuffer(input)) {
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(input);
    }
  }); } finally { activeDecoders -= 1; }
}

export function generateThumbnail(id: string): Promise<ThumbnailRecord> {
  const existing = pending.get(id);
  if (existing) return existing;
  const work = (async () => {
    const before = readThumbnail(id);
    if (!before) throw new Error("Thumbnail is not configured.");
    if (before.mode !== "automatic" || before.digest || !before.active || (before.privateStream && !before.privateCaptureAllowed) || before.retryAt > Date.now() || pending.size >= 2) return before;
    try {
      const origin = (process.env.DSTREAM_HLS_PROXY_ORIGIN?.trim() || "http://localhost:8888").replace(/\/$/, "");
      const source = new URL(`${origin}/${encodeURIComponent(id)}/index.m3u8`);
      const readToken = issueMediaServiceCredential(process.env.DSTREAM_MEDIA_MANIFEST_SECRET || "", "manifest", id, "read");
      const jpeg = await decodeThumbnail(source.href, readToken);
      return update(id, (current) => current && current.revision === before.revision && current.active && current.mode === "automatic" && (!current.privateStream || current.privateCaptureAllowed)
        ? { ...current, digest: storeJpeg(id, jpeg), retryAt: 0, revision: current.revision + 1 } : current || before);
    } catch {
      return update(id, (current) => current && current.revision === before.revision && current.mode === "automatic"
        ? { ...current, retryAt: Date.now() + RETRY_MS } : current || before);
    }
  })();
  pending.set(id, work);
  void work.finally(() => pending.delete(id)).catch(() => undefined);
  return work;
}
