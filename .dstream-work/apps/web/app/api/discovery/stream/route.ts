import { NextResponse, type NextRequest } from "next/server";
import { assertStreamIdentity } from "@dstream/protocol";
import { getLatestStreamAnnounce } from "@/lib/server/streamAnnounceLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const pubkey = (url.searchParams.get("pubkey") ?? "").trim().toLowerCase();
  const streamId = (url.searchParams.get("streamId") ?? "").trim();

  try {
    assertStreamIdentity(pubkey, streamId);
    if (streamId.length > 512) throw new Error("streamId too long");
  } catch {
    return NextResponse.json({ error: "Invalid stream identity." }, { status: 400 });
  }

  const announce = await getLatestStreamAnnounce(pubkey, streamId, {
    cacheTtlMs: 15_000,
    maxWaitMs: 2_500
  });
  if (!announce) {
    return NextResponse.json(
      { announce: null },
      { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  return NextResponse.json(
    { announce },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
