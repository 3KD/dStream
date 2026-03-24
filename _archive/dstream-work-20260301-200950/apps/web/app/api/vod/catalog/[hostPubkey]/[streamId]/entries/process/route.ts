import { pubkeyParamToHex } from "@/lib/nostr-ids";
import { makeOriginStreamId } from "@/lib/origin";
import { processVodCatalogEntries } from "@/lib/vodProcessing";
import { authorizeAccessAdmin } from "../../../../../../access/_lib";

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
    return Response.json({ ok: false, error: "Invalid stream id for VOD processing." }, { status: 400 });
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

  const limitRaw = Number(payload.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : undefined;

  try {
    const result = await processVodCatalogEntries({ originStreamId, limit });
    return Response.json({
      ok: true,
      hostPubkey,
      streamId,
      originStreamId,
      actorPubkey: auth.actorPubkey,
      ...result
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Failed to process VOD entries." }, { status: 400 });
  }
}
