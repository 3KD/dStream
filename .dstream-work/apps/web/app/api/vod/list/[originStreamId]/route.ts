import { NextResponse } from "next/server";
import { isValidOriginStreamId, listVodRecordings } from "@/lib/vod";
import { authorizeVodProxyRequest } from "@/lib/playback-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAccessToken(req: Request): string | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("access");
  if (fromQuery?.trim()) return fromQuery.trim();

  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ originStreamId: string }> }
) {
  const { originStreamId } = await ctx.params;
  const normalized = decodeURIComponent(String(originStreamId ?? "")).trim();
  if (!isValidOriginStreamId(normalized)) {
    return NextResponse.json({ ok: false, error: "Invalid origin stream id." }, { status: 400 });
  }
  const authz = authorizeVodProxyRequest(normalized, getAccessToken(req));
  if (!authz.ok) {
    return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status });
  }

  const { files } = await listVodRecordings(normalized);
  return NextResponse.json({
    ok: true,
    originStreamId: normalized,
    files
  });
}
