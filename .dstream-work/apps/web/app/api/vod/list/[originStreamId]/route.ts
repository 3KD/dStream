import { NextResponse } from "next/server";
import { isValidOriginStreamId, listVodRecordings } from "@/lib/vod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ originStreamId: string }> }
) {
  const { originStreamId } = await ctx.params;
  const normalized = decodeURIComponent(String(originStreamId ?? "")).trim();
  if (!isValidOriginStreamId(normalized)) {
    return NextResponse.json({ ok: false, error: "Invalid origin stream id." }, { status: 400 });
  }

  const { files } = await listVodRecordings(normalized);
  return NextResponse.json({
    ok: true,
    originStreamId: normalized,
    files
  });
}
