import { registerPlaybackPolicyFromAnnounceEvent } from "@/lib/playback-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const announceEvent = typeof body === "object" && body && "announceEvent" in body ? (body as any).announceEvent : null;
  const result = registerPlaybackPolicyFromAnnounceEvent(announceEvent);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: result.status });
  }

  return Response.json({
    ok: true,
    originStreamId: result.policy.originStreamId,
    privateStream: result.policy.privateStream,
    privateVideo: result.policy.videoArchiveEnabled && result.policy.videoVisibility === "private",
    videoVisibility: result.policy.videoVisibility,
    viewerAllowCount: result.policy.viewerAllowPubkeys.length,
    status: result.policy.status
  });
}
