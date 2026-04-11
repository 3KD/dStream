import { pubkeyParamToHex } from "@/lib/nostr-ids";
import { makeOriginStreamId } from "@/lib/origin";
import { type VideoCatalogVisibility, type VideoProcessingState } from "@/lib/videoCatalog";
import { syncVideoCatalogEntriesFromFilesystem } from "@/lib/videoProcessing";
import { authorizeAccessAdmin, asString, parseBoolean } from "../../../../../../access/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeVisibility(input: string | undefined): VideoCatalogVisibility | undefined {
  if (!input) return undefined;
  const value = input.trim().toLowerCase();
  if (value === "private" || value === "unlisted" || value === "public") return value;
  return undefined;
}

function sanitizeProcessingState(input: string | undefined): VideoProcessingState | undefined {
  if (!input) return undefined;
  const value = input.trim().toLowerCase();
  if (value === "ready" || value === "queued" || value === "processing" || value === "failed") return value;
  return undefined;
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
    return Response.json({ ok: false, error: "Invalid stream id for Video catalog ingest." }, { status: 400 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const auth = authorizeAccessAdmin(payload.operatorProofEvent, hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const visibility = sanitizeVisibility(asString(payload.visibility) || undefined);
  const processingState = sanitizeProcessingState(asString(payload.processingState) || undefined) ?? "ready";
  const onlyMissing = payload.onlyMissing === undefined ? true : parseBoolean(payload.onlyMissing);
  const published = payload.published === undefined ? true : parseBoolean(payload.published);
  const result = await syncVideoCatalogEntriesFromFilesystem({
    originStreamId,
    onlyMissing,
    visibility,
    processingState,
    published
  });

  return Response.json({
    ok: true,
    hostPubkey,
    streamId,
    originStreamId,
    actorPubkey: auth.actorPubkey,
    createdCount: result.created,
    updatedCount: result.updated,
    skippedCount: result.skipped,
    scannedCount: result.scanned,
    totalFiles: result.totalFiles
  });
}
