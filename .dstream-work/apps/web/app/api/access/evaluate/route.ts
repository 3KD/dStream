import { registerPlaybackPolicyFromAnnounceEvent } from "@/lib/playback-access";
import { evaluateAccess } from "@/lib/access/evaluator";
import { ACCESS_ACTIONS, type AccessAction } from "@/lib/access/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePubkey(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : "";
}

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
  const action = parseAction(payload.action);
  if (!action) {
    return Response.json({ ok: false, error: "action must be one of watch_live|watch_video|chat_send|p2p_assist|rebroadcast" }, { status: 400 });
  }

  const hostPubkey = normalizePubkey(payload.hostPubkey);
  const resourceId = asString(payload.resourceId);
  const subjectPubkey = normalizePubkey(payload.subjectPubkey) || undefined;
  if (!hostPubkey) return Response.json({ ok: false, error: "hostPubkey must be a 64-char hex pubkey" }, { status: 400 });
  if (!resourceId) return Response.json({ ok: false, error: "resourceId is required" }, { status: 400 });

  let announceContext:
    | {
        privateStream: boolean;
        privateVideo: boolean;
        videoArchiveEnabled: boolean;
        videoVisibility: "public" | "private";
        viewerAllowPubkeys: string[];
        feeWaiverVipPubkeys: string[];
      }
    | undefined;

  if (payload.announceEvent) {
    const registration = registerPlaybackPolicyFromAnnounceEvent(payload.announceEvent);
    if (!registration.ok) {
      return Response.json({ ok: false, error: registration.error }, { status: registration.status });
    }
    announceContext = {
      privateStream: registration.policy.privateStream,
      privateVideo: registration.policy.videoArchiveEnabled && registration.policy.videoVisibility === "private",
      videoArchiveEnabled: registration.policy.videoArchiveEnabled,
      videoVisibility: registration.policy.videoVisibility,
      viewerAllowPubkeys: registration.policy.viewerAllowPubkeys,
      feeWaiverVipPubkeys: []
    };
  }

  const decision = evaluateAccess({
    hostPubkey,
    subjectPubkey,
    resourceId,
    action,
    requestId: asString(payload.requestId) || undefined,
    announce: announceContext
  });

  return Response.json({
    ok: true,
    allowed: decision.allowed,
    reasonCode: decision.reasonCode,
    entitlementId: decision.entitlementId ?? null,
    expiresAtSec: decision.expiresAtSec ?? null
  });
}

