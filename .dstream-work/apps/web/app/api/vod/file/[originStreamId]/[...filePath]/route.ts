import { createReadStream } from "node:fs";
import { stat as statFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getVodFileContentType, isValidOriginStreamId, resolveVodFile } from "@/lib/vod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRangeHeader(rangeHeader: string, totalSize: number): { start: number; end: number } | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;
  const startRaw = (match[1] ?? "").trim();
  const endRaw = (match[2] ?? "").trim();

  let start = startRaw ? Number(startRaw) : NaN;
  let end = endRaw ? Number(endRaw) : NaN;

  if (!Number.isFinite(start) && !Number.isFinite(end)) return null;

  if (!Number.isFinite(start)) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    if (start < 0 || start >= totalSize) return null;
    if (!Number.isFinite(end)) end = totalSize - 1;
    if (end < start) return null;
    if (end >= totalSize) end = totalSize - 1;
  }

  return { start, end };
}

async function streamFile(req: Request, originStreamId: string, filePath: string[]): Promise<Response> {
  const targetFile = resolveVodFile(originStreamId, filePath);
  if (!targetFile) return new NextResponse("Not found", { status: 404 });

  let stat;
  try {
    stat = await statFile(targetFile);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new NextResponse("Not found", { status: 404 });

  const totalSize = stat.size;
  const mimeType = getVodFileContentType(targetFile);
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, totalSize);
    if (!range) {
      return new NextResponse("Requested range not satisfiable", {
        status: 416,
        headers: { "content-range": `bytes */${totalSize}` }
      });
    }
    const { start, end } = range;
    const nodeStream = createReadStream(targetFile, { start, end });
    const webStream = Readable.toWeb(nodeStream as any) as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      status: 206,
      headers: {
        "content-type": mimeType,
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${totalSize}`,
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=60"
      }
    });
  }

  const nodeStream = createReadStream(targetFile);
  const webStream = Readable.toWeb(nodeStream as any) as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      "content-type": mimeType,
      "content-length": String(totalSize),
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=60"
    }
  });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ originStreamId: string; filePath: string[] }> }
) {
  const { originStreamId, filePath } = await ctx.params;
  const normalized = decodeURIComponent(String(originStreamId ?? "")).trim();
  if (!isValidOriginStreamId(normalized)) return new NextResponse("Invalid stream id", { status: 400 });
  return streamFile(req, normalized, filePath ?? []);
}

export async function HEAD(
  req: Request,
  ctx: { params: Promise<{ originStreamId: string; filePath: string[] }> }
) {
  const response = await GET(req, ctx);
  return new Response(null, { status: response.status, headers: response.headers });
}
