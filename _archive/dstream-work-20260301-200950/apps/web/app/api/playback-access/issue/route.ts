import {
  issuePlaybackAccessToken,
  registerPlaybackPolicyFromAnnounceEvent,
  verifyViewerProofEvent
} from "@/lib/playback-access";
import { makeOriginStreamId } from "@/lib/origin";
import { evaluateAccess } from "@/lib/access/evaluator";
import type { AccessDecision } from "@/lib/access/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePubkey(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : "";
}

function decisionErrorMessage(decision: AccessDecision, opts: { privateStream: boolean; privateVod: boolean }): string {
  switch (decision.reasonCode) {
    case "deny_identity_required":
      if (opts.privateStream || opts.privateVod) return "identity proof is required for private access";
      return "identity is required";
    case "deny_private_allowlist":
      return opts.privateVod ? "viewer is not allowlisted for this private archive" : "viewer is not allowlisted for this private stream";
    case "deny_explicit":
      return "viewer is blocked by stream access policy";
    case "deny_vod_archive_disabled":
      return "archive is disabled for this stream";
    case "deny_no_matching_entitlement":
      return "viewer does not have entitlement for this access tier";
    default:
      return "access denied";
  }
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
  if (policy.privateStream || privateVod || viewerProofEvent) {
    const proof = verifyViewerProofEvent(viewerProofEvent, { originStreamId: expectedOriginStreamId });
    if (!proof.ok) {
      if (policy.privateStream || privateVod) {
        return Response.json(
          { ok: false, error: policy.privateStream ? proof.error : `Private archive access requires identity proof: ${proof.error}` },
          { status: proof.status }
        );
      }
    } else {
      viewerPubkey = proof.viewerPubkey;
    }
  }

  const baseResource = `stream:${policy.streamPubkey}:${policy.streamId}`;
  const announceContext = {
    privateStream: policy.privateStream,
    privateVod,
    vodArchiveEnabled: policy.vodArchiveEnabled,
    vodVisibility: policy.vodVisibility,
    viewerAllowPubkeys: policy.viewerAllowPubkeys,
    feeWaiverVipPubkeys: []
  };

  let liveDecision: AccessDecision | null = null;
  if (policy.status === "live") {
    liveDecision = evaluateAccess({
      hostPubkey: policy.streamPubkey,
      subjectPubkey: viewerPubkey ?? undefined,
      resourceId: `${baseResource}:live`,
      action: "watch_live",
      requestId: providedOriginStreamId || expectedOriginStreamId,
      announce: announceContext
    });
    if (!liveDecision.allowed) {
      return Response.json(
        { ok: false, error: decisionErrorMessage(liveDecision, { privateStream: policy.privateStream, privateVod }) },
        { status: 403 }
      );
    }
  }

  if (privateVod && !viewerPubkey) {
    const vodDecision = evaluateAccess({
      hostPubkey: policy.streamPubkey,
      resourceId: `${baseResource}:vod:*`,
      action: "watch_vod",
      requestId: providedOriginStreamId || expectedOriginStreamId,
      announce: announceContext
    });
    return Response.json(
      { ok: false, error: decisionErrorMessage(vodDecision, { privateStream: policy.privateStream, privateVod }) },
      { status: 403 }
    );
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
    vodVisibility: policy.vodVisibility,
    reasonCode: liveDecision?.reasonCode ?? "allow_public",
    entitlementId: liveDecision?.entitlementId ?? null
  });
}
