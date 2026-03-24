import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RenditionEntry {
  id: string;
  url: string;
  bandwidth?: number;
  width?: number;
  height?: number;
  codecs?: string;
}

function sanitizeLine(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, "")
    .trim();
}

function parsePositiveInt(value: string | null | undefined): number | undefined {
  const raw = sanitizeLine(value);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parsePlaybackUrl(value: string | null | undefined): string | null {
  const raw = sanitizeLine(value);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  return null;
}

function parseRenditions(req: NextRequest): RenditionEntry[] {
  const list: RenditionEntry[] = [];
  const seen = new Set<string>();
  const params = req.nextUrl.searchParams;

  for (let index = 0; index < 8; index++) {
    const id = sanitizeLine(params.get(`id${index}`));
    const url = parsePlaybackUrl(params.get(`u${index}`));
    if (!id || !url) continue;

    const key = `${id}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);

    list.push({
      id,
      url,
      bandwidth: parsePositiveInt(params.get(`bw${index}`)),
      width: parsePositiveInt(params.get(`w${index}`)),
      height: parsePositiveInt(params.get(`h${index}`)),
      codecs: sanitizeLine(params.get(`c${index}`)) || undefined
    });
  }

  return list;
}

function quoteAttribute(value: string): string {
  return value.replace(/"/g, '\\"');
}

function buildMasterPlaylist(renditions: RenditionEntry[]): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];

  for (const rendition of renditions) {
    const attrs = [`BANDWIDTH=${rendition.bandwidth ?? 1_500_000}`, `NAME="${quoteAttribute(rendition.id)}"`];
    if (rendition.width && rendition.height) attrs.push(`RESOLUTION=${rendition.width}x${rendition.height}`);
    if (rendition.codecs) attrs.push(`CODECS="${quoteAttribute(rendition.codecs)}"`);
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(",")}`);
    lines.push(rendition.url);
  }

  return `${lines.join("\n")}\n`;
}

export async function GET(req: NextRequest): Promise<Response> {
  const renditions = parseRenditions(req);
  if (renditions.length < 2) {
    return new Response("at least 2 rendition entries are required", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }

  const body = buildMasterPlaylist(renditions);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
