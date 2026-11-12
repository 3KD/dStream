import { generateThumbnail, readThumbnail, thumbnailJpeg } from "@/lib/server/streamThumbnail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ originStreamId: string }> }): Promise<Response> {
  const { originStreamId: id } = await context.params;
  if (!/^[a-f0-9]{64}--[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) return new Response(null, { status: 404 });
  const headers = { "access-control-allow-origin": "*", "x-content-type-options": "nosniff", "cache-control": "public, max-age=30, must-revalidate" };
  try {
    let record = readThumbnail(id);
    if (record?.mode === "off") return new Response(null, { status: 404, headers: { ...headers, "cache-control": "no-store" } });
    if (record?.mode === "automatic" && !record.digest && record.active) record = await generateThumbnail(id);
    if (record?.manualUrl) return new Response(null, { status: 302, headers: { ...headers, location: record.manualUrl } });
    if (record) {
      const bytes = thumbnailJpeg(id, record);
      if (bytes) {
        const etag = `"${record.digest}"`;
        if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...headers, etag } });
        return new Response(new Uint8Array(bytes), { headers: { ...headers, etag, "content-type": "image/jpeg", "content-length": String(bytes.length) } });
      }
    }
  } catch {
    // Storage/ingest failures do not turn a pending cover into a cached broken image.
  }
  return new Response(null, { status: 302, headers: { ...headers, "cache-control": "public, max-age=5, must-revalidate", location: "/logo_trimmed.png", "x-dstream-thumbnail": "pending" } });
}
