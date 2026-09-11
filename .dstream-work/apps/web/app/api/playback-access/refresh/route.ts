import { refreshPlaybackAccessToken } from "@/lib/playback-access";
import { buildPlaybackAccessCookies } from "@/lib/playback-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  if (parsed <= 0) return undefined;
  return parsed;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const result = refreshPlaybackAccessToken({
    token: typeof payload.token === "string" ? payload.token.trim() : "",
    announceEvent: payload.announceEvent,
    ttlSec: parsePositiveInt(payload.ttlSec)
  });

  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: result.status });
  }

  const response = Response.json({
    ok: true,
    token: result.token,
    expiresAtSec: result.expiresAtSec,
    originStreamId: result.originStreamId,
    privateStream: result.privateStream,
    privateVideo: result.privateVideo,
    videoVisibility: result.videoVisibility,
    reasonCode: result.reasonCode,
    entitlementId: result.entitlementId
  });
  for (const cookie of buildPlaybackAccessCookies(req, result.originStreamId, result.token, result.expiresAtSec)) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
