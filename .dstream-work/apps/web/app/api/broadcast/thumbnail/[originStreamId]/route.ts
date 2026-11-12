import { verifyPublishCredential } from "@/lib/mediaPublish";
import { allowRateLimitedRequest, readLimitedBody, RequestLimitError } from "@/lib/server/requestLimits";
import { requestAuthorizationUrl } from "@/lib/server/requestUrl";
import { configureThumbnail, decodeThumbnail, ensureThumbnail, generateThumbnail, readThumbnail, thumbnailState,
  THUMBNAIL_UPLOAD_LIMIT, ThumbnailConflict } from "@/lib/server/streamThumbnail";
import { publicThumbnailUrl } from "@/lib/streamThumbnail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ originStreamId: string }> };
const headers = { "cache-control": "no-store" };

async function handle(request: Request, context: Context): Promise<Response> {
  const { originStreamId: id } = await context.params;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!verifyPublishCredential(token, id)) return Response.json({ error: "Publisher authorization is required." }, { status: 403, headers });
  if (request.method === "PUT" && !allowRateLimitedRequest(`thumbnail:${id.slice(0, 64)}`, 20, 60_000)) {
    return Response.json({ error: "Thumbnail update limit reached; retry in one minute." }, { status: 429, headers: { ...headers, "retry-after": "60" } });
  }
  try {
    const origin = process.env.DSTREAM_PUBLIC_ORIGIN?.trim() || new URL(requestAuthorizationUrl(request)).origin;
    publicThumbnailUrl(origin, id);
    let record = readThumbnail(id);
    if (request.method === "POST" && !record && !allowRateLimitedRequest(`thumbnail-create:${id.slice(0, 64)}`, 20, 60_000)) {
      return Response.json({ error: "Thumbnail creation limit reached; retry in one minute." }, { status: 429, headers: { ...headers, "retry-after": "60" } });
    }
    if (request.method === "POST") {
      const raw = await readLimitedBody(request, 4096);
      const input: unknown = JSON.parse(new TextDecoder().decode(raw));
      if (!input || typeof input !== "object") throw new Error("Invalid thumbnail request.");
      const body = input as Record<string, unknown>;
      record = ensureThumbnail(id, { image: typeof body.image === "string" ? body.image : undefined,
        disabled: body.disabled === true, active: typeof body.active === "boolean" ? body.active : undefined,
        privateStream: typeof body.privateStream === "boolean" ? body.privateStream : undefined });
      if (body.generate === true) record = await generateThumbnail(id);
    } else if (request.method === "PUT") {
      const revision = Number(request.headers.get("x-thumbnail-revision"));
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("A current thumbnail revision is required.");
      if (request.headers.get("content-type")?.split(";")[0] === "image/jpeg") {
        const raw = Buffer.from(await readLimitedBody(request, THUMBNAIL_UPLOAD_LIMIT));
        record = configureThumbnail(id, revision, "manual", undefined, await decodeThumbnail(raw));
      } else {
        const body: unknown = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 4096)));
        if (!body || typeof body !== "object" || !("mode" in body) || !["manual", "automatic", "off"].includes(String(body.mode))) throw new Error("Invalid thumbnail mode.");
        const image = "image" in body && typeof body.image === "string" ? body.image : undefined;
        if ("privateCaptureAllowed" in body && typeof body.privateCaptureAllowed !== "boolean") throw new Error("Private capture permission must be a boolean.");
        const privateCaptureAllowed = "privateCaptureAllowed" in body && typeof body.privateCaptureAllowed === "boolean" ? body.privateCaptureAllowed : undefined;
        record = configureThumbnail(id, revision, body.mode as "manual" | "automatic" | "off", image, undefined, privateCaptureAllowed);
      }
    }
    return Response.json(record ? thumbnailState(id, origin, record) : null, { headers });
  } catch (error) {
    const status = error instanceof RequestLimitError ? 413 : error instanceof ThumbnailConflict ? 409 : 400;
    return Response.json({ error: error instanceof RequestLimitError || error instanceof ThumbnailConflict ? error.message : "Thumbnail update failed; check the image, HTTPS origin and writable thumbnail storage, then retry." }, { status, headers });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
