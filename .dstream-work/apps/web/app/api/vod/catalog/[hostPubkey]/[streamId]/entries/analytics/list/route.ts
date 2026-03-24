import { listVodAnalyticsSummary } from "@/lib/vodAnalytics";
import { resolveHostAndOrigin } from "@/lib/vodUploadSession";
import { asString, authorizeAccessAdmin } from "../../../../../../../access/_lib";

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
    resolved = resolveHostAndOrigin(
      decodeURIComponent(String(params.hostPubkey ?? "")),
      decodeURIComponent(String(params.streamId ?? ""))
    );
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Invalid analytics target." }, { status: 400 });
  }

  const auth = authorizeAccessAdmin(payload.operatorProofEvent, resolved.hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const limitRaw = Number(payload.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 300;
  const playlistId = asString(payload.playlistId) || undefined;
  const relativePath = asString(payload.relativePath) || undefined;

  try {
    const rows = listVodAnalyticsSummary({
      originStreamId: resolved.originStreamId,
      playlistId,
      relativePath,
      limit
    });
    return Response.json({
      ok: true,
      hostPubkey: resolved.hostPubkey,
      streamId: resolved.streamId,
      originStreamId: resolved.originStreamId,
      actorPubkey: auth.actorPubkey,
      rows,
      count: rows.length
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Failed to load VOD analytics summary." }, { status: 400 });
  }
}
