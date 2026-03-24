import { pubkeyParamToHex } from "@/lib/nostr-ids";
import { makeOriginStreamId } from "@/lib/origin";
import { upsertVodCatalogEntry } from "@/lib/vodCatalog";
import { authorizeAccessAdmin, asString } from "../../../../../../access/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return Response.json({ ok: false, error: "Invalid stream id for VOD catalog." }, { status: 400 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const auth = authorizeAccessAdmin(payload.operatorProofEvent, hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const relativePath = asString(payload.relativePath);
  if (!relativePath) {
    return Response.json({ ok: false, error: "relativePath is required." }, { status: 400 });
  }

  try {
    const entry = upsertVodCatalogEntry({
      originStreamId,
      relativePath,
      title: asString(payload.title) || undefined,
      description: asString(payload.description) || undefined,
      playlistId: asString(payload.playlistId) || undefined,
      orderIndex: typeof payload.orderIndex === "number" && Number.isFinite(payload.orderIndex) ? payload.orderIndex : undefined,
      visibility: asString(payload.visibility) as "public" | "unlisted" | "private" | undefined,
      processingState:
        asString(payload.processingState) as "ready" | "queued" | "processing" | "failed" | undefined,
      processingError: asString(payload.processingError) || undefined,
      thumbnailUrl: asString(payload.thumbnailUrl) || undefined,
      tags: Array.isArray(payload.tags) ? payload.tags.filter((value): value is string => typeof value === "string") : [],
      published: typeof payload.published === "boolean" ? payload.published : undefined,
      publishedAtSec: typeof payload.publishedAtSec === "number" ? payload.publishedAtSec : undefined
    });

    return Response.json({
      ok: true,
      hostPubkey,
      streamId,
      originStreamId,
      entry,
      actorPubkey: auth.actorPubkey
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Failed to save VOD catalog entry." }, { status: 400 });
  }
}
