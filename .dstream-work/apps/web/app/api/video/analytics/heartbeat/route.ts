import { verifyAccessProof } from "@/lib/access/proof";
import { recordVideoAnalyticsHeartbeat } from "@/lib/videoAnalytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return Math.trunc(parsed);
}

function parsePlaybackMode(value: unknown): "live" | "video" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "live" || normalized === "video") return normalized;
  return undefined;
}

function parseOriginHost(originStreamId: string): string | null {
  const value = originStreamId.trim().toLowerCase();
  const separatorIndex = value.indexOf("--");
  if (separatorIndex !== 64) return null;
  const hostPubkey = value.slice(0, separatorIndex);
  return /^[a-f0-9]{64}$/.test(hostPubkey) ? hostPubkey : null;
}

function getFirstTagValue(tags: unknown, name: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (!Array.isArray(tag)) continue;
    if (tag[0] !== name) continue;
    if (typeof tag[1] !== "string") continue;
    const value = tag[1].trim().toLowerCase();
    if (!value) continue;
    return value;
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const originStreamId = asString(payload.originStreamId).toLowerCase();
  const relativePath = asString(payload.relativePath);
  if (!originStreamId) {
    return Response.json({ ok: false, error: "originStreamId is required." }, { status: 400 });
  }
  if (!relativePath) {
    return Response.json({ ok: false, error: "relativePath is required." }, { status: 400 });
  }

  let viewerId = asString(payload.viewerId) || undefined;
  const viewerProof = payload.viewerProofEvent;
  if (viewerProof) {
    const verified = verifyAccessProof(viewerProof, "access_viewer");
    if (verified.ok) {
      const hostTag = getFirstTagValue((viewerProof as { tags?: unknown }).tags, "host");
      const expectedHost = parseOriginHost(originStreamId);
      if (hostTag && expectedHost && hostTag !== expectedHost) {
        return Response.json(
          { ok: false, error: "viewer proof host tag does not match requested stream host." },
          { status: 403 }
        );
      }
      viewerId = verified.pubkey;
    }
  }

  try {
    const row = recordVideoAnalyticsHeartbeat({
      originStreamId,
      relativePath,
      viewerId,
      elapsedSec: asPositiveInt(payload.elapsedSec),
      currentTimeSec: asPositiveInt(payload.currentTimeSec),
      playbackMode: parsePlaybackMode(payload.playbackMode)
    });
    return Response.json({
      ok: true,
      row
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "Failed to record Video analytics heartbeat." }, { status: 400 });
  }
}

