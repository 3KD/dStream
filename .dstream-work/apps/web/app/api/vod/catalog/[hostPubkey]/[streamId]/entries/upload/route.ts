import path from "node:path";
import { access as accessFile, mkdir, writeFile } from "node:fs/promises";
import { pubkeyParamToHex } from "@/lib/nostr-ids";
import { makeOriginStreamId } from "@/lib/origin";
import { isAllowedVodRecordingExtension, resolveVodStreamDir } from "@/lib/vod";
import { upsertVodCatalogEntry, type VodCatalogVisibility, type VodProcessingState } from "@/lib/vodCatalog";
import { authorizeAccessAdmin, parseBoolean } from "../../../../../../access/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAYLIST_ID_RE = /^(?:__root__|[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})$/;

function sanitizeVisibility(input: string | null): VodCatalogVisibility {
  const value = (input ?? "").trim().toLowerCase();
  if (value === "private" || value === "unlisted" || value === "public") return value;
  return "public";
}

function sanitizeProcessingState(input: string | null): VodProcessingState {
  const value = (input ?? "").trim().toLowerCase();
  if (value === "ready" || value === "queued" || value === "processing" || value === "failed") return value;
  return "ready";
}

function sanitizePlaylistId(input: string | null): string | undefined {
  const value = (input ?? "").trim();
  if (!value) return undefined;
  if (!PLAYLIST_ID_RE.test(value)) return undefined;
  return value;
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

function parseProofEvent(input: FormDataEntryValue | null): unknown {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseTags(input: FormDataEntryValue | null): string[] {
  if (typeof input !== "string") return [];
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toLowerCase().replace(/\s+/g, "-"))
    .slice(0, 24);
}

async function pathExists(filePath: string): Promise<boolean> {
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
  while (await pathExists(path.resolve(streamDir, candidate))) {
    candidate = `${stem}-${counter}${ext}`;
    counter += 1;
    if (counter > 1000) throw new Error("Unable to allocate unique VOD filename.");
  }
  return candidate;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ hostPubkey: string; streamId: string }> }
): Promise<Response> {
  const params = await ctx.params;
  const hostRaw = decodeURIComponent(String(params.hostPubkey ?? "")).trim();
  const streamId = decodeURIComponent(String(params.streamId ?? "")).trim();
  const hostPubkey = pubkeyParamToHex(hostRaw) ?? "";
  if (!hostPubkey) {
    return Response.json({ ok: false, error: "hostPubkey must be a valid npub or 64-hex pubkey." }, { status: 400 });
  }
  const originStreamId = makeOriginStreamId(hostPubkey, streamId);
  if (!originStreamId) {
    return Response.json({ ok: false, error: "Invalid stream id for VOD upload." }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "invalid multipart form payload" }, { status: 400 });
  }

  const auth = authorizeAccessAdmin(parseProofEvent(formData.get("operatorProofEvent")), hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    return Response.json({ ok: false, error: "file is required." }, { status: 400 });
  }
  if (fileValue.size <= 0) {
    return Response.json({ ok: false, error: "file is empty." }, { status: 400 });
  }

  const streamDir = resolveVodStreamDir(originStreamId);
  if (!streamDir) {
    return Response.json({ ok: false, error: "Invalid stream directory for VOD upload." }, { status: 400 });
  }

  const safeFileName = sanitizeFileName(fileValue.name);
  const extension = path.extname(safeFileName).toLowerCase();
  if (!isAllowedVodRecordingExtension(extension)) {
    return Response.json(
      {
        ok: false,
        error: "Unsupported file extension. Allowed: .mp4, .m4s, .mkv, .ts, .webm, .mov"
      },
      { status: 400 }
    );
  }

  const playlistId = sanitizePlaylistId(typeof formData.get("playlistId") === "string" ? String(formData.get("playlistId")) : null);
  const visibility = sanitizeVisibility(typeof formData.get("visibility") === "string" ? String(formData.get("visibility")) : null);
  const processingState = sanitizeProcessingState(
    typeof formData.get("processingState") === "string" ? String(formData.get("processingState")) : null
  );
  const published = parseBoolean(formData.get("published"));
  const title = typeof formData.get("title") === "string" ? String(formData.get("title")).trim() : "";
  const description = typeof formData.get("description") === "string" ? String(formData.get("description")).trim() : "";
  const thumbnailUrl = typeof formData.get("thumbnailUrl") === "string" ? String(formData.get("thumbnailUrl")).trim() : "";
  const tags = parseTags(formData.get("tags"));

  const relativePathBase = playlistId ? `${playlistId}/${safeFileName}` : safeFileName;
  const relativePath = await findAvailableRelativePath(streamDir, relativePathBase);
  const absolutePath = path.resolve(streamDir, relativePath);

  try {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const buffer = Buffer.from(await fileValue.arrayBuffer());
    await writeFile(absolutePath, buffer);
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Failed to write uploaded VOD file." }, { status: 500 });
  }

  try {
    const entry = upsertVodCatalogEntry({
      originStreamId,
      relativePath,
      title: title || undefined,
      description: description || undefined,
      playlistId,
      visibility,
      processingState,
      processingError: undefined,
      thumbnailUrl: thumbnailUrl || undefined,
      tags,
      published
    });

    return Response.json({
      ok: true,
      hostPubkey,
      streamId,
      originStreamId,
      relativePath,
      fileName: safeFileName,
      fileSizeBytes: fileValue.size,
      actorPubkey: auth.actorPubkey,
      entry
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Failed to upsert VOD metadata." }, { status: 400 });
  }
}
