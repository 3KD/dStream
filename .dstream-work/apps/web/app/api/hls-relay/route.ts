import type { NextRequest } from "next/server";
import { parseRelayedProviderUrl, rewriteProviderHlsPlaylist } from "@/lib/hls/providerRelay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;

function errorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

function upstreamRequestHeaders(req: NextRequest): Headers {
  const headers = new Headers({ accept: "application/vnd.apple.mpegurl, application/x-mpegURL, video/*, audio/*, */*" });
  for (const name of ["range", "if-none-match", "if-modified-since"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function fetchTrustedSource(req: NextRequest, initialUrl: URL): Promise<{ response: Response; url: URL }> {
  let url = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(url, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: upstreamRequestHeaders(req),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    if (!REDIRECT_STATUSES.has(response.status)) return { response, url };
    const location = response.headers.get("location");
    const nextUrl = location ? parseRelayedProviderUrl(location, url.href) : null;
    await response.body?.cancel().catch(() => undefined);
    if (!nextUrl) throw new Error("Provider redirected outside the trusted relay boundary.");
    url = nextUrl;
  }
  throw new Error("Provider exceeded the redirect limit.");
}

function copyMediaHeaders(upstream: Response, playlist: boolean): Headers {
  const headers = new Headers();
  for (const name of ["accept-ranges", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("content-type", upstream.headers.get("content-type") || (playlist ? "application/vnd.apple.mpegurl" : "application/octet-stream"));
  headers.set(
    "cache-control",
    playlist || !upstream.ok || upstream.status === 206 ? "no-store" : "public, max-age=120, immutable"
  );
  headers.set("x-dstream-hls-relay", "streamroad");
  return headers;
}

async function proxy(req: NextRequest): Promise<Response> {
  const source = parseRelayedProviderUrl(req.nextUrl.searchParams.get("url") ?? "");
  if (!source) return errorResponse("Unsupported HLS relay source.", 400);

  try {
    const { response: upstream, url } = await fetchTrustedSource(req, source);
    const contentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
    const playlist = url.pathname.toLowerCase().endsWith(".m3u8") || contentType.includes("mpegurl");
    const headers = copyMediaHeaders(upstream, playlist);
    if (req.method === "HEAD" || [204, 205, 304].includes(upstream.status)) {
      return new Response(null, { status: upstream.status, headers });
    }
    if (!playlist || !upstream.ok) return new Response(upstream.body, { status: upstream.status, headers });

    const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PLAYLIST_BYTES) {
      return errorResponse("Provider playlist is too large.", 502);
    }
    const body = await upstream.text();
    if (Buffer.byteLength(body, "utf8") > MAX_PLAYLIST_BYTES) {
      return errorResponse("Provider playlist is too large.", 502);
    }
    return new Response(rewriteProviderHlsPlaylist(body, url.href), { status: upstream.status, headers });
  } catch {
    return errorResponse("HLS relay could not reach the provider.", 502);
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return proxy(req);
}

export async function HEAD(req: NextRequest): Promise<Response> {
  return proxy(req);
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, HEAD, OPTIONS",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "cache-control": "no-store"
    }
  });
}
