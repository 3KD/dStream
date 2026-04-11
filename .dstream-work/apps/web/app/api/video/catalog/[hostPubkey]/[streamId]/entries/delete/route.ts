import { pubkeyParamToHex } from "@/lib/nostr-ids";
import { makeOriginStreamId } from "@/lib/origin";
import { deleteVideoCatalogEntry } from "@/lib/videoCatalog";
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
    return Response.json({ ok: false, error: "Invalid stream id for Video catalog." }, { status: 400 });
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

  const deleted = deleteVideoCatalogEntry({ originStreamId, relativePath });
  if (!deleted) {
    return Response.json({ ok: false, error: "Catalog entry not found." }, { status: 404 });
  }

  return Response.json({
    ok: true,
    hostPubkey,
    streamId,
    originStreamId,
    relativePath,
    actorPubkey: auth.actorPubkey
  });
}
