import { abortVodUploadSession } from "@/lib/vodUploadSession";
import { asString } from "../../../../../../../../access/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ uploadId: string }> }
): Promise<Response> {
  const params = await ctx.params;
  const uploadId = decodeURIComponent(String(params.uploadId ?? "")).trim();
  if (!uploadId) return Response.json({ ok: false, error: "uploadId is required." }, { status: 400 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const uploadToken = asString(payload.uploadToken);
  if (!uploadToken) return Response.json({ ok: false, error: "uploadToken is required." }, { status: 400 });

  try {
    await abortVodUploadSession({ uploadId, uploadToken });
    return Response.json({ ok: true, uploadId });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Failed to abort upload session." }, { status: 400 });
  }
}
