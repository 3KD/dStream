import { NextResponse } from "next/server";
import { isValidOriginStreamId, listVodRecordings } from "@/lib/vod";
import { authorizeVodProxyRequest, verifyPlaybackAccessToken } from "@/lib/playback-access";
import { evaluateAccess } from "@/lib/access/evaluator";
import { buildVodAccessResourceCandidates } from "@/lib/access/packages";
import { syncVodCatalogEntriesFromFilesystem } from "@/lib/vodProcessing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ParsedOriginStreamId {
  hostPubkey: string;
  streamId: string;
}

const HEX64_RE = /^[a-f0-9]{64}$/;
const STREAM_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const AUTO_SYNC_MIN_INTERVAL_SEC = 30;

const lastCatalogSyncAtSecByOrigin = new Map<string, number>();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parseOriginStreamIdentity(originStreamId: string): ParsedOriginStreamId | null {
  const value = (originStreamId ?? "").trim().toLowerCase();
  const separatorIndex = value.indexOf("--");
  if (separatorIndex !== 64) return null;
  const hostPubkey = value.slice(0, separatorIndex);
  const streamId = value.slice(separatorIndex + 2);
  if (!HEX64_RE.test(hostPubkey)) return null;
  if (!STREAM_ID_RE.test(streamId)) return null;
  return { hostPubkey, streamId };
}

function getAccessToken(req: Request): string | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("access");
  if (fromQuery?.trim()) return fromQuery.trim();

  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function shouldAutoSyncCatalog(req: Request): boolean {
  const value = (new URL(req.url).searchParams.get("sync") ?? "").trim().toLowerCase();
  if (!value) return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return true;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ originStreamId: string }> }
) {
  const { originStreamId } = await ctx.params;
  const normalized = decodeURIComponent(String(originStreamId ?? "")).trim();
  if (!isValidOriginStreamId(normalized)) {
    return NextResponse.json({ ok: false, error: "Invalid origin stream id." }, { status: 400 });
  }
  const accessToken = getAccessToken(req);
  const authz = authorizeVodProxyRequest(normalized, accessToken);
  if (!authz.ok) {
    return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status });
  }

  const parsedIdentity = parseOriginStreamIdentity(normalized);
  if (!parsedIdentity) {
    return NextResponse.json({ ok: false, error: "Invalid origin stream identity." }, { status: 400 });
  }

  const verifiedToken = accessToken ? verifyPlaybackAccessToken(accessToken, normalized) : null;
  const subjectPubkey =
    verifiedToken && verifiedToken.ok && verifiedToken.payload.v.trim() ? verifiedToken.payload.v.trim().toLowerCase() : undefined;

  if (shouldAutoSyncCatalog(req)) {
    const now = nowSec();
    const last = lastCatalogSyncAtSecByOrigin.get(normalized) ?? 0;
    if (now - last >= AUTO_SYNC_MIN_INTERVAL_SEC) {
      lastCatalogSyncAtSecByOrigin.set(normalized, now);
      await syncVodCatalogEntriesFromFilesystem({
        originStreamId: normalized,
        onlyMissing: true,
        processingState: "ready",
        published: true,
        limit: 1500
      }).catch(() => undefined);
    }
  }

  const { files } = await listVodRecordings(normalized, {
    curatedOnly: true,
    includePrivate: true,
    includeUnlisted: false,
    includeUnpublished: false,
    readyOnly: true
  });
  const visibleFiles = files.filter((file) => {
    if (file.visibility !== "private") return true;
    const resourceCandidates = buildVodAccessResourceCandidates({
      hostPubkey: parsedIdentity.hostPubkey,
      streamId: parsedIdentity.streamId,
      relativePath: file.relativePath,
      playlistId: file.playlistId
    });
    const decisions = resourceCandidates.map((resourceId) =>
      evaluateAccess({
        hostPubkey: parsedIdentity.hostPubkey,
        subjectPubkey,
        resourceId,
        action: "watch_vod",
        announce: {
          privateStream: false,
          privateVod: true,
          vodArchiveEnabled: true,
          vodVisibility: "private",
          viewerAllowPubkeys: [],
          feeWaiverVipPubkeys: []
        },
        skipAudit: true
      })
    );
    if (decisions.some((decision) => decision.reasonCode === "deny_explicit" || decision.reasonCode === "deny_vod_archive_disabled")) {
      return false;
    }
    return decisions.some((decision) => decision.allowed);
  });

  return NextResponse.json({
    ok: true,
    originStreamId: normalized,
    files: visibleFiles
  });
}
