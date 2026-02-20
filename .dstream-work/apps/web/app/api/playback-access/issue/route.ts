import {
  issuePlaybackAccessToken,
  registerPlaybackPolicyFromAnnounceEvent,
  verifyViewerProofEvent
} from "@/lib/playback-access";
import { makeOriginStreamId } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePubkey(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : "";
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const announceEvent = payload.announceEvent;
  const viewerProofEvent = payload.viewerProofEvent;
  const streamPubkey = normalizePubkey(asString(payload.streamPubkey));
  const streamId = asString(payload.streamId);
  const providedOriginStreamId = asString(payload.originStreamId);

  const registration = registerPlaybackPolicyFromAnnounceEvent(announceEvent);
  if (!registration.ok) {
    return Response.json({ ok: false, error: registration.error }, { status: registration.status });
  }

  const policy = registration.policy;
  const expectedOriginStreamId = makeOriginStreamId(policy.streamPubkey, policy.streamId);
  if (!expectedOriginStreamId) {
    return Response.json({ ok: false, error: "invalid stream identity in announceEvent" }, { status: 400 });
  }

  if (streamPubkey && streamPubkey !== policy.streamPubkey) {
    return Response.json({ ok: false, error: "streamPubkey does not match announceEvent" }, { status: 400 });
  }
  if (streamId && streamId !== policy.streamId) {
    return Response.json({ ok: false, error: "streamId does not match announceEvent" }, { status: 400 });
  }
  if (providedOriginStreamId && providedOriginStreamId !== expectedOriginStreamId) {
    return Response.json({ ok: false, error: "originStreamId does not match announceEvent" }, { status: 400 });
  }

  let viewerPubkey: string | null = null;
  const privateVod = policy.vodArchiveEnabled && policy.vodVisibility === "private";
  if (policy.privateStream || privateVod) {
    const proof = verifyViewerProofEvent(viewerProofEvent, { originStreamId: expectedOriginStreamId });
    if (!proof.ok) {
      return Response.json(
        { ok: false, error: policy.privateStream ? proof.error : `Private archive access requires identity proof: ${proof.error}` },
        { status: proof.status }
      );
    }

    viewerPubkey = proof.viewerPubkey;
    const allowlisted = viewerPubkey === policy.streamPubkey || policy.viewerAllowPubkeys.includes(viewerPubkey);
    if (!allowlisted) {
      return Response.json(
        {
          ok: false,
          error: policy.privateStream
            ? "viewer is not allowlisted for this private stream"
            : "viewer is not allowlisted for this private archive"
        },
        { status: 403 }
      );
    }
  } else if (viewerProofEvent) {
    const proof = verifyViewerProofEvent(viewerProofEvent, { originStreamId: expectedOriginStreamId });
    if (proof.ok) viewerPubkey = proof.viewerPubkey;
  }

  const issued = issuePlaybackAccessToken({
    originStreamId: expectedOriginStreamId,
    viewerPubkey,
    privateStream: policy.privateStream
  });

  return Response.json({
    ok: true,
    token: issued.token,
    expiresAtSec: issued.expiresAtSec,
    originStreamId: expectedOriginStreamId,
    privateStream: policy.privateStream,
    privateVod,
    vodVisibility: policy.vodVisibility
  });
}
