import type { NextRequest } from "next/server";
import { authorizePlaybackProxyRequest } from "@/lib/playback-access";
import { ipBandwidthCache, BANDWIDTH_LIMIT_BYTES } from "@/lib/bandwidthTracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeOrigin(input: string | undefined, fallback: string): string {
  const raw = (input ?? "").trim();
  const base = raw || fallback;
  return base.replace(/\/$/, "");
}

const PROXY_ORIGIN = normalizeOrigin(process.env.DSTREAM_HLS_PROXY_ORIGIN, "http://localhost:8888");

async function proxy(req: NextRequest, pathSegments: string[]): Promise<Response> {
  const authz = authorizePlaybackProxyRequest(pathSegments, req.nextUrl.searchParams.get("access"));
  if (!authz.ok) {
    return new Response(authz.error, { status: authz.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  // Track client IP and check against bandwidth wall
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-ip";
  const lastSegment = pathSegments[pathSegments.length - 1] || "";
  const isTsFile = lastSegment.endsWith(".ts");
  const isPlaylist = lastSegment.endsWith(".m3u8");
  
  // NOTE: External viewers downloading via pure HTTP (e.g., zap.stream) are not participating
  // in the P2P swarm. We enforce a 10MB preview limit to prevent massive leeching.
  const currentBytes = ipBandwidthCache.get(clientIp) || 0;
  const isCutoff = currentBytes >= BANDWIDTH_LIMIT_BYTES;

  if (isCutoff && isTsFile) {
    // Cut off direct chunk access cleanly with a 403 Forbidden.
    return new Response("Preview bandwidth limit reached. Head to dstream.stream to use the P2P swarm.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const base = PROXY_ORIGIN.endsWith("/") ? PROXY_ORIGIN : `${PROXY_ORIGIN}/`;
  const target = new URL(pathSegments.map((s) => encodeURIComponent(s)).join("/"), base);
  const upstreamParams = new URLSearchParams(req.nextUrl.search);
  upstreamParams.delete("access");
  target.search = upstreamParams.toString();

  const headers = new Headers(req.headers);
  headers.delete("host");

  try {
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body: req.body,
      redirect: "manual"
    });

    // Bumper Video Injection
    if (upstream.ok && isCutoff && isPlaylist) {
      const text = await upstream.text();
      // Smoothly transition the HLS video player to our pre-rendered generic bumper 
      // instead of crashing or showing a "Stream Ended" text.
      const modifiedText = text.trim() + "\n#EXT-X-DISCONTINUITY\n#EXTINF:5.000,\n/bumper.ts\n#EXT-X-ENDLIST\n";
      const resHeaders = new Headers(upstream.headers);
      resHeaders.set("cache-control", "no-store");
      resHeaders.delete("content-length"); 
      return new Response(modifiedText, { status: upstream.status, headers: resHeaders });
    }
    if (upstream.ok && isTsFile) {
      const contentLength = parseInt(upstream.headers.get("content-length") || "0");
      if (contentLength > 0) {
        ipBandwidthCache.set(clientIp, currentBytes + contentLength);
      }
    }

    const resHeaders = new Headers(upstream.headers);
    resHeaders.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
  } catch (err: any) {
    const message = `HLS proxy error: failed to reach ${PROXY_ORIGIN} (${err?.message ?? "unknown error"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function OPTIONS(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
