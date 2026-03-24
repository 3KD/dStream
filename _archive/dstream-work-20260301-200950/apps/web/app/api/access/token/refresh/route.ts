import { verifyAccessToken, issueAccessToken } from "@/lib/access/token";
import { evaluateAccess } from "@/lib/access/evaluator";
import { parsePositiveInt } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const tokenRaw = typeof payload.token === "string" ? payload.token.trim() : "";
  const verified = verifyAccessToken(tokenRaw);
  if (!verified.ok) return Response.json({ ok: false, error: verified.error }, { status: 401 });
  const existing = verified.payload;

  for (const action of existing.act) {
    const decision = evaluateAccess({
      hostPubkey: existing.host,
      subjectPubkey: existing.sub || undefined,
      resourceId: existing.res,
      action,
      requestId: existing.jti
    });
    if (!decision.allowed) {
      return Response.json({ ok: true, allowed: false, reasonCode: decision.reasonCode, action }, { status: 403 });
    }
  }

  const decisionSource = evaluateAccess({
    hostPubkey: existing.host,
    subjectPubkey: existing.sub || undefined,
    resourceId: existing.res,
    action: existing.act[0]!
  });

  const issued = issueAccessToken({
    hostPubkey: existing.host,
    subjectPubkey: existing.sub || undefined,
    resourceId: existing.res,
    actions: existing.act,
    sourceCode: decisionSource.entitlementId ? `entitlement:${decisionSource.entitlementId}` : decisionSource.reasonCode,
    ttlSec: parsePositiveInt(payload.ttlSec)
  });

  return Response.json({
    ok: true,
    allowed: true,
    token: issued.token,
    expiresAtSec: issued.expiresAtSec,
    reasonCode: decisionSource.reasonCode,
    entitlementId: decisionSource.entitlementId ?? null
  });
}
