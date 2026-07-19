import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const REQUEST_TIMEOUT_MS = 6_000;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const DEFAULT_PUBLIC_ORIGIN = "https://dstream.stream";

export interface StreamHealthResult {
  ok: boolean;
  definitive: boolean;
  reason: string;
}

function getPublicOrigin(): string {
  const configured = process.env.DSTREAM_PUBLIC_ORIGIN?.trim() || process.env.NEXT_PUBLIC_HLS_ORIGIN?.trim();
  if (!configured) return DEFAULT_PUBLIC_ORIGIN;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : DEFAULT_PUBLIC_ORIGIN;
  } catch {
    return DEFAULT_PUBLIC_ORIGIN;
  }
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) throw new Error("private hostname");
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("private address");
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) throw new Error("private address");
}

async function fetchPublic(url: URL, init: RequestInit = {}): Promise<Response> {
  let current = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      ...init,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: "application/vnd.apple.mpegurl,application/x-mpegURL,video/*,audio/*,*/*",
        origin: getPublicOrigin(),
        "user-agent": "dstream-source-health/1.0",
        ...(init.headers ?? {})
      }
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || redirect === MAX_REDIRECTS) return response;
    current = new URL(location, current);
  }
  throw new Error("redirect limit exceeded");
}

function hasUsableCors(response: Response, sourceUrl: URL): boolean {
  const publicOrigin = getPublicOrigin();
  if (sourceUrl.origin === publicOrigin) return true;
  const allowOrigin = response.headers.get("access-control-allow-origin")?.trim();
  return allowOrigin === "*" || allowOrigin === publicOrigin;
}

export function inspectHlsManifest(text: string): { variant: string | null; segment: string | null } | null {
  if (!text.trimStart().startsWith("#EXTM3U")) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  let variant: string | null = null;
  let segment: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      const next = lines.slice(index + 1).find((candidate) => candidate && !candidate.startsWith("#"));
      if (next && !variant) variant = next;
    }
    if (line.startsWith("#EXTINF")) {
      const next = lines.slice(index + 1).find((candidate) => candidate && !candidate.startsWith("#"));
      if (next) segment = next;
    }
  }
  return { variant, segment };
}

async function readManifest(response: Response): Promise<string | null> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_MANIFEST_BYTES) return null;
  const text = await response.text();
  return text.length <= MAX_MANIFEST_BYTES ? text : null;
}

async function probeSegment(segmentUrl: URL): Promise<StreamHealthResult> {
  const response = await fetchPublic(segmentUrl, { headers: { range: "bytes=0-65535" } });
  if (!response.ok) {
    return { ok: false, definitive: response.status >= 400 && response.status < 500, reason: `segment_http_${response.status}` };
  }
  if (!hasUsableCors(response, segmentUrl)) return { ok: false, definitive: true, reason: "segment_cors" };
  const reader = response.body?.getReader();
  if (!reader) return { ok: false, definitive: false, reason: "empty_segment" };
  try {
    const chunk = await reader.read();
    return chunk.value && chunk.value.byteLength > 0
      ? { ok: true, definitive: true, reason: "ok" }
      : { ok: false, definitive: false, reason: "empty_segment" };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function resolveSourceUrl(input: string): URL | null {
  try {
    if (/^https?:\/\//i.test(input)) return new URL(input);
    if (!input.startsWith("/")) return null;
    return new URL(input, getPublicOrigin());
  } catch {
    return null;
  }
}

export async function probeStreamSource(input: string): Promise<StreamHealthResult> {
  const sourceUrl = resolveSourceUrl(input.trim());
  if (!sourceUrl) return { ok: false, definitive: true, reason: "invalid_url" };
  try {
    let response = await fetchPublic(sourceUrl);
    if (!response.ok) {
      return { ok: false, definitive: response.status < 500, reason: `manifest_http_${response.status}` };
    }
    if (!hasUsableCors(response, sourceUrl)) return { ok: false, definitive: true, reason: "manifest_cors" };

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
      return probeSegment(sourceUrl);
    }

    let manifestUrl = new URL(response.url || sourceUrl.href);
    let manifestText = await readManifest(response);
    let inspected = manifestText ? inspectHlsManifest(manifestText) : null;
    if (!inspected) return { ok: false, definitive: true, reason: "not_hls" };

    if (inspected.variant) {
      manifestUrl = new URL(inspected.variant, manifestUrl);
      response = await fetchPublic(manifestUrl);
      if (!response.ok) {
        return { ok: false, definitive: response.status < 500, reason: `variant_http_${response.status}` };
      }
      if (!hasUsableCors(response, manifestUrl)) return { ok: false, definitive: true, reason: "variant_cors" };
      manifestText = await readManifest(response);
      inspected = manifestText ? inspectHlsManifest(manifestText) : null;
    }

    if (!inspected?.segment) return { ok: false, definitive: true, reason: "no_media_segments" };
    return probeSegment(new URL(inspected.segment, manifestUrl));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const definitive = /private|unsupported protocol|invalid_url/i.test(reason);
    return { ok: false, definitive, reason };
  }
}
