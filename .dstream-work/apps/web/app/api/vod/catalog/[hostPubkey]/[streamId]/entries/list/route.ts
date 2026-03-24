import { pubkeyParamToHex } from "@/lib/nostr-ids";
import { makeOriginStreamId } from "@/lib/origin";
import { listVodRecordings } from "@/lib/vod";
import { listVodCatalogEntries, type VodCatalogEntry } from "@/lib/vodCatalog";
import { authorizeAccessAdmin, asString, parseBoolean } from "../../../../../../access/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VodCatalogListRow {
  relativePath: string;
  fileName: string;
  fileSizeBytes: number;
  fileModifiedAtMs: number;
  fileUrl: string;
  metadata: VodCatalogEntry | null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ hostPubkey: string; streamId: string }> }
): Promise<Response> {
  const params = await ctx.params;
  const hostRaw = decodeURIComponent(String(params.hostPubkey ?? "")).trim();
  const streamId = decodeURIComponent(String(params.streamId ?? "")).trim();
  const hostPubkey = pubkeyParamToHex(hostRaw) ?? "";
  if (!hostPubkey) {
    return Response.json({ ok: false, error: "hostPubkey must be a valid npub or 64-hex pubkey." }, { status: 400 });
  }
  const originStreamId = makeOriginStreamId(hostPubkey, streamId);
  if (!originStreamId) {
    return Response.json({ ok: false, error: "Invalid stream id for VOD catalog." }, { status: 400 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const hasProof = !!payload.operatorProofEvent;
  const requestAdminRows = parseBoolean(payload.adminRows) || hasProof;

  let isAdmin = false;
  let actorPubkey: string | null = null;
  if (requestAdminRows) {
    const auth = authorizeAccessAdmin(payload.operatorProofEvent, hostPubkey);
    if (!auth.ok) {
      return Response.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    isAdmin = true;
    actorPubkey = auth.actorPubkey;
  }

  const includePrivate = isAdmin && parseBoolean(payload.includePrivate);
  const includeUnlisted = isAdmin && parseBoolean(payload.includeUnlisted);
  const includeUnpublished = isAdmin && parseBoolean(payload.includeUnpublished);
  const curatedOnly = parseBoolean(payload.curatedOnly) || !isAdmin;
  const playlistId = asString(payload.playlistId) || undefined;

  const { files } = await listVodRecordings(originStreamId, {
    includePrivate: isAdmin ? true : false,
    includeUnlisted: isAdmin ? true : false,
    includeUnpublished: isAdmin ? true : false,
    readyOnly: isAdmin ? false : true,
    curatedOnly,
    playlistId
  });

  const metadataByPath = new Map<string, VodCatalogEntry>();
  for (const entry of listVodCatalogEntries({
    originStreamId,
    includePrivate: isAdmin || includePrivate,
    includeUnlisted: isAdmin || includeUnlisted,
    includeUnpublished: isAdmin || includeUnpublished,
    playlistId,
    limit: 5000
  })) {
    metadataByPath.set(entry.relativePath, entry);
  }

  const rows: VodCatalogListRow[] = files.map((file) => ({
    relativePath: file.relativePath,
    fileName: file.name,
    fileSizeBytes: file.sizeBytes,
    fileModifiedAtMs: file.modifiedAtMs,
    fileUrl: file.url,
    metadata: metadataByPath.get(file.relativePath) ?? null
  }));

  rows.sort((left, right) => {
    const leftTime = left.metadata?.publishedAtSec ?? left.fileModifiedAtMs;
    const rightTime = right.metadata?.publishedAtSec ?? right.fileModifiedAtMs;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.relativePath.localeCompare(right.relativePath);
  });

  return Response.json({
    ok: true,
    hostPubkey,
    streamId,
    originStreamId,
    rows,
    count: rows.length,
    isAdmin,
    actorPubkey
  });
}
