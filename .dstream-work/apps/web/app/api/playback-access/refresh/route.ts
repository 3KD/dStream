import { refreshPlaybackAccessToken } from "@/lib/playback-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function playbackCookie(req: Request, originStreamId: string, token: string, expiresAtSec: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  const maxAge = Math.max(1, expiresAtSec - Math.floor(Date.now() / 1000));
  return `dstream_playback_access=${encodeURIComponent(token)}; Path=/api/video/file/${encodeURIComponent(originStreamId)}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

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
  response.headers.append("set-cookie", playbackCookie(req, result.originStreamId, result.token, result.expiresAtSec));
  return response;
}
