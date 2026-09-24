import type { NextRequest } from "next/server";
import { authorizePlaybackProxyRequest } from "@/lib/playback-access";
import { readPlaybackAccessToken } from "@/lib/playback-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeOrigin(input: string | undefined, fallback: string): string {
  const raw = (input ?? "").trim();
  const base = raw || fallback;
  return base.replace(/\/$/, "");
}

const PROXY_ORIGIN = normalizeOrigin(process.env.DSTREAM_HLS_PROXY_ORIGIN, "http://localhost:8888");
const HLS_MEDIA_FILE_RE = /\.(?:aac|m4s|mp4|ts)$/i;

function shouldBufferMediaResponse(req: NextRequest, pathSegments: string[], upstream: Response): boolean {
  if (req.method !== "GET" || !upstream.body) return false;
  const fileName = pathSegments[pathSegments.length - 1] ?? "";
  if (!HLS_MEDIA_FILE_RE.test(fileName)) return false;
  const declaredLength = Number(upstream.headers.get("content-length") ?? "0");
  return !Number.isFinite(declaredLength) || declaredLength <= 0;
}

async function proxy(req: NextRequest, pathSegments: string[]): Promise<Response> {
  const authz = authorizePlaybackProxyRequest(pathSegments, readPlaybackAccessToken(req));
  if (!authz.ok) {
    return new Response(authz.error, { status: authz.status, headers: { "content-type": "text/plain; charset=utf-8" } });
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

    const resHeaders = new Headers(upstream.headers);
    resHeaders.set("cache-control", "no-store");
    if (shouldBufferMediaResponse(req, pathSegments, upstream)) {
      const body = await upstream.arrayBuffer();
      resHeaders.delete("transfer-encoding");
      resHeaders.set("content-length", String(body.byteLength));
      return new Response(body, { status: upstream.status, headers: resHeaders });
    }
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
