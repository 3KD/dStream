import {
  resolveHostAndOrigin,
  startVodUploadSession
} from "@/lib/vodUploadSession";
import { authorizeAccessAdmin, asString, parseBoolean } from "../../../../../../../access/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ hostPubkey: string; streamId: string }> }
): Promise<Response> {
  const params = await ctx.params;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  let resolved;
  try {
    resolved = resolveHostAndOrigin(decodeURIComponent(String(params.hostPubkey ?? "")), decodeURIComponent(String(params.streamId ?? "")));
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Invalid upload target." }, { status: 400 });
  }

  const auth = authorizeAccessAdmin(payload.operatorProofEvent, resolved.hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const fileName = asString(payload.fileName);
  const fileSizeBytes = Number(payload.fileSizeBytes);
  if (!fileName) return Response.json({ ok: false, error: "fileName is required." }, { status: 400 });
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return Response.json({ ok: false, error: "fileSizeBytes must be > 0." }, { status: 400 });
  }

  try {
    const { session, chunkSizeBytes } = await startVodUploadSession({
      hostPubkey: resolved.hostPubkey,
      streamId: resolved.streamId,
      originStreamId: resolved.originStreamId,
      fileName,
      fileSizeBytes: Math.floor(fileSizeBytes),
      playlistId: asString(payload.playlistId) || undefined,
      title: asString(payload.title) || undefined,
      description: asString(payload.description) || undefined,
      visibility: asString(payload.visibility) || undefined,
      processingState: asString(payload.processingState) || undefined,
      published: payload.published === undefined ? undefined : parseBoolean(payload.published),
      thumbnailUrl: asString(payload.thumbnailUrl) || undefined,
      tags: Array.isArray(payload.tags) ? payload.tags.filter((value): value is string => typeof value === "string") : []
    });
    return Response.json({
      ok: true,
      hostPubkey: resolved.hostPubkey,
      streamId: resolved.streamId,
      originStreamId: resolved.originStreamId,
      uploadId: session.uploadId,
      uploadToken: session.uploadToken,
      chunkSizeBytes,
      expiresAtSec: session.expiresAtSec,
      actorPubkey: auth.actorPubkey
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Failed to start upload session." }, { status: 400 });
  }
}
