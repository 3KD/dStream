import { completeVodUploadSession } from "@/lib/vodUploadSession";
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
    const result = await completeVodUploadSession({ uploadId, uploadToken });
    return Response.json({
      ok: true,
      hostPubkey: result.hostPubkey,
      streamId: result.streamId,
      originStreamId: result.originStreamId,
      relativePath: result.relativePath,
      fileName: result.fileName,
      fileSizeBytes: result.fileSizeBytes,
      entry: result.entry
    });
  } catch (error: any) {
    const message = error?.message ?? "Failed to complete upload session.";
    if (message.includes("mismatch") || message.includes("expired")) {
      return Response.json({ ok: false, error: message }, { status: 403 });
    }
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
