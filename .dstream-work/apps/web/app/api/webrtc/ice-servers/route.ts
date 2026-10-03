import { issueTurnCredentials, parseTurnCredentialTtl, parseTurnUrls } from "@/lib/webrtcServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache"
};

export async function GET() {
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
