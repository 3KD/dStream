import { issueTurnCredentials, parseTurnCredentialTtl, parseTurnUrls } from "@/lib/webrtcServer";
import { createHash } from "node:crypto";
import { allowRateLimitedRequest } from "@/lib/server/requestLimits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache"
};

export async function GET(req: Request) {
  const peer = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  const bucket = createHash("sha256").update(peer).digest("hex");
  if (!allowRateLimitedRequest(`turn:${bucket}`, 60, 60_000) || !allowRateLimitedRequest("turn:global", 300, 60_000)) {
    return Response.json({ error: "Too many TURN credential requests." }, { status: 429, headers: { ...RESPONSE_HEADERS, "Retry-After": "60" } });
  }
  try {
    const urls = parseTurnUrls(process.env.DSTREAM_TURN_URLS);
    const sharedSecret = String(process.env.TURN_SHARED_SECRET ?? "");
    const ttlSec = parseTurnCredentialTtl(process.env.DSTREAM_TURN_CREDENTIAL_TTL_SEC);
    const issued = issueTurnCredentials({ urls, sharedSecret, ttlSec });

    return Response.json(
      { iceServers: [issued.iceServer], expiresAt: issued.expiresAt },
      { headers: RESPONSE_HEADERS }
    );
  } catch {
    return Response.json(
      { error: "TURN credentials are unavailable." },
      { status: 503, headers: RESPONSE_HEADERS }
    );
  }
}
