import { pubkeyParamToHex } from "@/lib/nostr-ids";
import { processVodCatalogEntriesForHost } from "@/lib/vodProcessing";
import { authorizeAccessAdmin } from "../../../../../access/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePositiveInt(input: unknown): number | undefined {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return Math.trunc(value);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ hostPubkey: string }> }
): Promise<Response> {
  const params = await ctx.params;
  const hostRaw = decodeURIComponent(String(params.hostPubkey ?? "")).trim();
  const hostPubkey = pubkeyParamToHex(hostRaw) ?? "";
  if (!hostPubkey) {
    return Response.json({ ok: false, error: "hostPubkey must be a valid npub or 64-hex pubkey." }, { status: 400 });
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

  const limit = parsePositiveInt(payload.limit);
  const maxStreams = parsePositiveInt(payload.maxStreams);

  try {
    const result = await processVodCatalogEntriesForHost({
      hostPubkey,
      limit,
      maxStreams
    });
    return Response.json({
      ok: true,
      actorPubkey: auth.actorPubkey,
      ...result
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Failed to process VOD entries for host." }, { status: 400 });
  }
}
