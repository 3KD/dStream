import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeOrigin(input: string | undefined, fallback: string): string {
  const raw = (input ?? "").trim();
  const base = raw || fallback;
  return base.replace(/\/$/, "");
}

function isDevtoolsEnabled(): boolean {
  return process.env.NODE_ENV === "development" || process.env.DSTREAM_DEVTOOLS === "1";
}

const PROXY_ORIGIN = normalizeOrigin(process.env.DSTREAM_HLS_PROXY_ORIGIN, "http://localhost:8888");

const tamperCountByStream = new Map<string, number>();
const armedAtByStream = new Map<string, number>();
const MAX_TAMPERS_PER_STREAM = 8;

function isSegmentPath(pathSegments: string[]): boolean {
  const last = (pathSegments[pathSegments.length - 1] || "").toLowerCase();
  return last.endsWith(".ts") || last.endsWith(".m4s") || last.endsWith(".mp4");
}

function isPlaylistPath(pathSegments: string[]): boolean {
  const last = (pathSegments[pathSegments.length - 1] || "").toLowerCase();
  return last.endsWith(".m3u8");
}

function tamperBytes(input: ArrayBuffer): ArrayBuffer {
  if (!input || input.byteLength === 0) return input;
  const bytes = new Uint8Array(input.slice(0));
  const idx = Math.min(16, bytes.length - 1);
  bytes[idx] ^= 0xff;
  return bytes.buffer;
}

async function proxy(req: NextRequest, pathSegments: string[]): Promise<Response> {
  if (!isDevtoolsEnabled()) return new Response("not found", { status: 404 });

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

    const streamName = pathSegments[0] || "";
    if (streamName && isPlaylistPath(pathSegments) && upstream.ok) {
      if (!armedAtByStream.has(streamName)) armedAtByStream.set(streamName, Date.now());
    }

    const armedAt = streamName ? armedAtByStream.get(streamName) ?? null : null;
    const canTamperNow = armedAt !== null && Date.now() - armedAt > 2500;
    const priorTamperCount = streamName ? (tamperCountByStream.get(streamName) ?? 0) : 0;
    const shouldTamper =
      streamName &&
      isSegmentPath(pathSegments) &&
      upstream.ok &&
      canTamperNow &&
      priorTamperCount < MAX_TAMPERS_PER_STREAM;

    if (!shouldTamper) return new Response(upstream.body, { status: upstream.status, headers: resHeaders });

    const buf = await upstream.arrayBuffer();
    tamperCountByStream.set(streamName, priorTamperCount + 1);
    resHeaders.set("x-dstream-tampered", "1");
    return new Response(tamperBytes(buf), { status: upstream.status, headers: resHeaders });
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
