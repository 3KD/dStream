import type { NextRequest } from "next/server";
import { verifyPublishCredential } from "@/lib/mediaPublish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeOrigin(input: string | undefined, fallback: string): string {
  const raw = (input ?? "").trim();
  const base = raw || fallback;
  return base.replace(/\/$/, "");
}

const PROXY_ORIGIN = normalizeOrigin(process.env.DSTREAM_WHIP_PROXY_ORIGIN, "http://localhost:8889");

async function proxy(req: NextRequest, pathSegments: string[]): Promise<Response> {
  if (pathSegments[1] !== "whip" || pathSegments.some((part) => !part || part === "." || part === ".." || /[\\/\u0000]/.test(part))) {
    return new Response("Invalid WHIP path.", { status: 400 });
  }
  if (req.method !== "OPTIONS" && !verifyPublishCredential(req.nextUrl.searchParams.get("publish") ?? "", pathSegments[0] ?? "")) {
    return new Response("Publisher authorization is required.", { status: 403 });
  }
  const base = PROXY_ORIGIN.endsWith("/") ? PROXY_ORIGIN : `${PROXY_ORIGIN}/`;
  const target = new URL(pathSegments.map((s) => encodeURIComponent(s)).join("/"), base);
  target.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.delete("host");

  try {
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await req.arrayBuffer().catch(() => undefined);

    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body,
      redirect: "manual"
    });
    const responseHeaders = new Headers(upstream.headers);
    const location = responseHeaders.get("location");
    if (location) {
      const resource = new URL(location, target);
      const next = new URL(`/api/whip${resource.pathname}`, req.nextUrl.origin);
      next.searchParams.set("publish", req.nextUrl.searchParams.get("publish") ?? "");
      responseHeaders.set("location", `${next.pathname}${next.search}`);
    }
    responseHeaders.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (err: any) {
    const message = `WHIP proxy error: failed to reach ${PROXY_ORIGIN} (${err?.message ?? "unknown error"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function OPTIONS(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
