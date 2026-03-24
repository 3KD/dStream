import { refreshPlaybackAccessToken } from "@/lib/playback-access";

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

  return Response.json({
    ok: true,
    token: result.token,
    expiresAtSec: result.expiresAtSec,
    originStreamId: result.originStreamId,
    privateStream: result.privateStream,
    privateVod: result.privateVod,
    vodVisibility: result.vodVisibility,
    reasonCode: result.reasonCode,
    entitlementId: result.entitlementId
  });
}
