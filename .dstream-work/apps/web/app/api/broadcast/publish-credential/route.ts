import { validateEvent, verifyEvent } from "nostr-tools";
import { makeOriginStreamId } from "@/lib/origin";
import { issuePublishCredential } from "@/lib/mediaPublish";
import { verifyWalletRequestPayload } from "@/lib/monero/requestProof";
import { requestAuthorizationUrl } from "@/lib/server/requestUrl";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const encoded = req.headers.get("authorization")?.match(/^Nostr\s+(.+)$/i)?.[1];
    if (!encoded) return new Response("Signed publisher authorization is required.", { status: 401 });
    const event = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    const tag = (name: string) => event.tags.filter((row: string[]) => row[0] === name);
    if (!validateEvent(event) || !verifyEvent(event) || event.kind !== 27235 ||
      Math.abs(event.created_at - Math.floor(Date.now() / 1000)) > 60 ||
      tag("u").length !== 1 || tag("u")[0][1] !== requestAuthorizationUrl(req) ||
      tag("method").length !== 1 || tag("method")[0][1] !== "POST" ||
      !(await verifyWalletRequestPayload(req, event.tags))) {
      return new Response("Publisher authorization is invalid.", { status: 401 });
    }
    const body = await req.json();
    const originStreamId = makeOriginStreamId(event.pubkey, typeof body.streamId === "string" ? body.streamId : "");
    if (!originStreamId || originStreamId !== body.originStreamId) return new Response("Publisher identity mismatch.", { status: 403 });
    return Response.json(issuePublishCredential(originStreamId), { headers: { "cache-control": "no-store" } });
  } catch { return new Response("Publish credentials are unavailable.", { status: 503 }); }
}
