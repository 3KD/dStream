import { equalMediaSecret, verifyPublishCredential } from "@/lib/mediaPublish";
import { authorizePlaybackProxyRequest } from "@/lib/playback-access";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const encoded = req.headers.get("authorization")?.match(/^Basic\s+(.+)$/i)?.[1];
    const auth = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
    if (!auth.startsWith("media:") || !equalMediaSecret(auth.slice(6))) return new Response(null, { status: 401 });
    const body = await req.json();
    if (["api", "metrics", "pprof"].includes(body.action)) {
      return new Response(null, { status: body.ip === "127.0.0.1" || body.ip === "::1" ? 204 : 403 });
    }
    if (typeof body.path !== "string" || body.path.includes("/") || typeof body.query !== "string") return new Response(null, { status: 403 });
    const query = new URLSearchParams(body.query);
    if (body.action === "publish") {
      const token = query.get("publish") || body.token || body.password || "";
      return new Response(null, { status: typeof token === "string" && verifyPublishCredential(token, body.path) ? 204 : 403 });
    }
    if (body.action === "read" || body.action === "playback") {
      // A publisher must be able to check its own ingest before announcing live.
      const publisherToken = query.get("publish");
      if (publisherToken && verifyPublishCredential(publisherToken, body.path)) return new Response(null, { status: 204 });
      const result = authorizePlaybackProxyRequest([body.path], query.get("access") || body.token || null);
      return new Response(null, { status: result.ok ? 204 : 403 });
    }
    return new Response(null, { status: 403 });
  } catch { return new Response(null, { status: 403 }); }
}
