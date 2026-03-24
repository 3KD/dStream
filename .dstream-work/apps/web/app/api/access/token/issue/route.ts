import { registerPlaybackPolicyFromAnnounceEvent } from "@/lib/playback-access";
import { evaluateAccess } from "@/lib/access/evaluator";
import { issueAccessToken } from "@/lib/access/token";
import { ACCESS_ACTIONS, type AccessAction } from "@/lib/access/types";
import { asString, normalizePubkey, parseActionList, parsePositiveInt } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseAction(value: unknown): AccessAction | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ACCESS_ACTIONS.includes(normalized as AccessAction) ? (normalized as AccessAction) : null;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const hostPubkey = normalizePubkey(payload.hostPubkey);
  const subjectPubkey = normalizePubkey(payload.subjectPubkey) || undefined;
  const resourceId = asString(payload.resourceId);

  if (!hostPubkey) return Response.json({ ok: false, error: "hostPubkey must be a 64-char hex pubkey" }, { status: 400 });
  if (!resourceId) return Response.json({ ok: false, error: "resourceId is required" }, { status: 400 });

  let actions = parseActionList(payload.actions);
  if (actions.length === 0) {
    const actionSingle = parseAction(payload.action);
    if (actionSingle) actions = [actionSingle];
  }
  if (actions.length === 0) {
    return Response.json({ ok: false, error: "actions must include at least one valid action" }, { status: 400 });
  }

  let announceContext:
    | {
        privateStream: boolean;
        privateVod: boolean;
        vodArchiveEnabled: boolean;
        vodVisibility: "public" | "private";
        viewerAllowPubkeys: string[];
        feeWaiverVipPubkeys: string[];
      }
    | undefined;

  if (payload.announceEvent) {
    const registration = registerPlaybackPolicyFromAnnounceEvent(payload.announceEvent);
    if (!registration.ok) return Response.json({ ok: false, error: registration.error }, { status: registration.status });
    announceContext = {
      privateStream: registration.policy.privateStream,
      privateVod: registration.policy.vodArchiveEnabled && registration.policy.vodVisibility === "private",
      vodArchiveEnabled: registration.policy.vodArchiveEnabled,
      vodVisibility: registration.policy.vodVisibility,
      viewerAllowPubkeys: registration.policy.viewerAllowPubkeys,
      feeWaiverVipPubkeys: []
    };
  }

  for (const action of actions) {
    const decision = evaluateAccess({
      hostPubkey,
      subjectPubkey,
      resourceId,
      action,
      requestId: asString(payload.requestId) || undefined,
      announce: announceContext
    });
    if (!decision.allowed) {
      return Response.json(
        {
          ok: true,
          allowed: false,
          reasonCode: decision.reasonCode,
          action
        },
        { status: 403 }
      );
    }
  }

  const decisionForSource = evaluateAccess({
    hostPubkey,
    subjectPubkey,
    resourceId,
    action: actions[0]!,
    requestId: asString(payload.requestId) || undefined,
    announce: announceContext
  });

  const issued = issueAccessToken({
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions,
    sourceCode: decisionForSource.entitlementId ? `entitlement:${decisionForSource.entitlementId}` : decisionForSource.reasonCode,
    ttlSec: parsePositiveInt(payload.ttlSec)
  });

  return Response.json({
    ok: true,
    allowed: true,
    token: issued.token,
    expiresAtSec: issued.expiresAtSec,
    reasonCode: decisionForSource.reasonCode,
    entitlementId: decisionForSource.entitlementId ?? null
  });
}
