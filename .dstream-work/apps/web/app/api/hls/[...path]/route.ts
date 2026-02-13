import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeOrigin(input: string | undefined, fallback: string): string {
  const raw = (input ?? "").trim();
  const base = raw || fallback;
  return base.replace(/\/$/, "");
}

const PROXY_ORIGIN = normalizeOrigin(process.env.DSTREAM_HLS_PROXY_ORIGIN, "http://localhost:8888");

async function proxy(req: NextRequest, pathSegments: string[]): Promise<Response> {
  const base = PROXY_ORIGIN.endsWith("/") ? PROXY_ORIGIN : `${PROXY_ORIGIN}/`;
  const target = new URL(pathSegments.map((s) => encodeURIComponent(s)).join("/"), base);
  target.search = req.nextUrl.search;

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
