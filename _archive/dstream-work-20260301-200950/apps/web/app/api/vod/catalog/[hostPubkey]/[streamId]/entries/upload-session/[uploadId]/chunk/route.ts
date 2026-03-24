import { appendVodUploadSessionChunk } from "@/lib/vodUploadSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getUploadToken(req: Request): string {
  const fromHeader = (req.headers.get("x-dstream-upload-token") ?? "").trim();
  if (fromHeader) return fromHeader;
  const url = new URL(req.url);
  return (url.searchParams.get("token") ?? "").trim();
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ uploadId: string }> }
): Promise<Response> {
  const params = await ctx.params;
  const uploadId = decodeURIComponent(String(params.uploadId ?? "")).trim();
  if (!uploadId) return Response.json({ ok: false, error: "uploadId is required." }, { status: 400 });

  const uploadToken = getUploadToken(req);
  if (!uploadToken) return Response.json({ ok: false, error: "upload token is required." }, { status: 400 });

  const url = new URL(req.url);
  const offsetRaw = Number(url.searchParams.get("offset"));
  if (!Number.isInteger(offsetRaw) || offsetRaw < 0) {
    return Response.json({ ok: false, error: "offset must be a non-negative integer." }, { status: 400 });
  }

  let bytes: Uint8Array;
  try {
    const arrayBuffer = await req.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
  } catch {
    return Response.json({ ok: false, error: "Invalid chunk body." }, { status: 400 });
  }

  try {
    const result = await appendVodUploadSessionChunk({
      uploadId,
      uploadToken,
      offset: offsetRaw,
      bytes
    });
    return Response.json({
      ok: true,
      uploadId,
      receivedBytes: result.receivedBytes,
      fileSizeBytes: result.fileSizeBytes,
      completed: result.completed
    });
  } catch (error: any) {
    const message = error?.message ?? "Failed to append upload chunk.";
    const mismatch = message.match(/expected=(\d+)/);
    if (mismatch) {
      return Response.json(
        {
          ok: false,
          error: message,
          expectedOffset: Number(mismatch[1])
        },
        { status: 409 }
      );
    }
    if (message.includes("expired") || message.includes("mismatch")) {
      return Response.json({ ok: false, error: message }, { status: 403 });
    }
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
