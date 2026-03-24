import { pubkeyParamToHex } from "@/lib/nostr-ids";
import { makeOriginStreamId } from "@/lib/origin";
import { listVodRecordings } from "@/lib/vod";
import { authorizeAccessAdmin } from "../../../../access/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VodPlaylistCatalogRow {
  id: string;
  fileCount: number;
  latestModifiedAtMs: number;
}

function normalizePlaylistId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return normalized || "__root__";
}

function buildPlaylistCatalog(
  files: Array<{ relativePath: string; modifiedAtMs: number }>
): VodPlaylistCatalogRow[] {
  const playlistMap = new Map<string, VodPlaylistCatalogRow>();
  for (const file of files) {
    const segments = file.relativePath.split("/").filter(Boolean);
    const playlistIdRaw = segments.length > 1 ? segments[0] ?? "__root__" : "__root__";
    const playlistId = normalizePlaylistId(playlistIdRaw);
    const existing = playlistMap.get(playlistId);
    if (!existing) {
      playlistMap.set(playlistId, {
        id: playlistId,
        fileCount: 1,
        latestModifiedAtMs: Number.isFinite(file.modifiedAtMs) ? file.modifiedAtMs : 0
      });
      continue;
    }
    existing.fileCount += 1;
    if (Number.isFinite(file.modifiedAtMs) && file.modifiedAtMs > existing.latestModifiedAtMs) {
      existing.latestModifiedAtMs = file.modifiedAtMs;
    }
  }
  return Array.from(playlistMap.values()).sort((left, right) => {
    if (right.latestModifiedAtMs !== left.latestModifiedAtMs) {
      return right.latestModifiedAtMs - left.latestModifiedAtMs;
    }
    return left.id.localeCompare(right.id);
  });
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
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const auth = authorizeAccessAdmin(payload.operatorProofEvent, hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const listResult = await listVodRecordings(originStreamId);
  const files = listResult.files;
  const playlists = buildPlaylistCatalog(files);

  return Response.json({
    ok: true,
    hostPubkey,
    streamId,
    originStreamId,
    fileCount: files.length,
    playlists,
    actorPubkey: auth.actorPubkey
  });
}
