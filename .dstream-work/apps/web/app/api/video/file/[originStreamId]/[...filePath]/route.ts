import { createReadStream } from "node:fs";
import { stat as statFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getVideoFileContentType, isValidOriginStreamId, resolveVideoFile } from "@/lib/video";
import { getVideoCatalogEntry } from "@/lib/videoCatalog";
import { evaluateAccess } from "@/lib/access/evaluator";
import { buildVideoAccessResourceCandidates } from "@/lib/access/packages";
import { authorizeVideoProxyRequest, verifyPlaybackAccessToken } from "@/lib/playback-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX64_RE = /^[a-f0-9]{64}$/;
const STREAM_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function getAccessToken(req: Request): string | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("access");
  if (fromQuery?.trim()) return fromQuery.trim();

  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function parseOriginStreamIdentity(originStreamId: string): { hostPubkey: string; streamId: string } | null {
  const value = (originStreamId ?? "").trim().toLowerCase();
  const separatorIndex = value.indexOf("--");
  if (separatorIndex !== 64) return null;
  const hostPubkey = value.slice(0, separatorIndex);
  const streamId = value.slice(separatorIndex + 2);
  if (!HEX64_RE.test(hostPubkey)) return null;
  if (!STREAM_ID_RE.test(streamId)) return null;
  return { hostPubkey, streamId };
}

function normalizeRelativeVideoPath(filePathSegments: string[]): string | null {
  if (!Array.isArray(filePathSegments) || filePathSegments.length === 0) return null;
  const safeSegments: string[] = [];
  for (const segmentRaw of filePathSegments) {
    const segment = decodeURIComponent(String(segmentRaw ?? "")).trim();
    if (!segment || segment === "." || segment === "..") return null;
    if (segment.includes("/") || segment.includes("\\") || segment.includes("\u0000")) return null;
    safeSegments.push(segment);
  }
  return safeSegments.join("/");
}

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

async function streamFile(req: Request, targetFile: string): Promise<Response> {
  let stat;
  try {
    stat = await statFile(targetFile);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new NextResponse("Not found", { status: 404 });

  const totalSize = stat.size;
  const mimeType = getVideoFileContentType(targetFile);
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
  const accessToken = getAccessToken(req);
  const authz = authorizeVideoProxyRequest(normalized, accessToken, filePath ?? []);
  if (!authz.ok) {
    return new NextResponse(authz.error, { status: authz.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const targetFile = resolveVideoFile(normalized, filePath ?? []);
  if (!targetFile) return new NextResponse("Not found", { status: 404 });
  const relativePath = normalizeRelativeVideoPath(filePath ?? []);
  if (!relativePath) return new NextResponse("Invalid file path", { status: 400 });

  const catalogEntry = getVideoCatalogEntry(normalized, relativePath);
  if (!catalogEntry || !catalogEntry.publishedAtSec) {
    return new NextResponse("Video is not available.", { status: 404 });
  }
  if (catalogEntry.processingState !== "ready") {
    return new NextResponse("Video is still processing.", { status: 409 });
  }

  if (catalogEntry.visibility === "private") {
    if (!accessToken) return new NextResponse("Video access denied.", { status: 403 });
    const parsedOrigin = parseOriginStreamIdentity(normalized);
    if (!parsedOrigin) return new NextResponse("Invalid stream identity.", { status: 400 });
    const verified = verifyPlaybackAccessToken(accessToken, normalized);
    if (!verified.ok) return new NextResponse(`Video access denied: ${verified.error}.`, { status: 403 });
    const subjectPubkey = verified.payload.v.trim() ? verified.payload.v.trim().toLowerCase() : undefined;
    const resourceCandidates = buildVideoAccessResourceCandidates({
      hostPubkey: parsedOrigin.hostPubkey,
      streamId: parsedOrigin.streamId,
      relativePath: relativePath,
      playlistId: catalogEntry.playlistId
    });
    const decisions = resourceCandidates.map((resourceId) =>
      evaluateAccess({
        hostPubkey: parsedOrigin.hostPubkey,
        subjectPubkey,
        resourceId,
        action: "watch_video",
        announce: {
          privateStream: false,
          privateVideo: true,
          videoArchiveEnabled: true,
          videoVisibility: "private",
          viewerAllowPubkeys: [],
          feeWaiverVipPubkeys: []
        },
        skipAudit: true
      })
    );
    const hardDeny = decisions.some((decision) => decision.reasonCode === "deny_explicit" || decision.reasonCode === "deny_video_archive_disabled");
    const allowed = !hardDeny && decisions.some((decision) => decision.allowed);
    if (!allowed) {
      return new NextResponse("Video access denied.", { status: 403 });
    }
  }

  return streamFile(req, targetFile);
}

export async function HEAD(
  req: Request,
  ctx: { params: Promise<{ originStreamId: string; filePath: string[] }> }
) {
  const response = await GET(req, ctx);
  return new Response(null, { status: response.status, headers: response.headers });
}
