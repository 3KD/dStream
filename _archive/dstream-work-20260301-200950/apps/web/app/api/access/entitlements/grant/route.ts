import { grantAccessEntitlement } from "@/lib/access/store";
import type { AccessEntitlementSource } from "@/lib/access/types";
import { asString, authorizeAccessAdmin, normalizePubkey, parseActionList, parsePositiveInt } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SOURCES = new Set<AccessEntitlementSource>([
  "owner_grant",
  "vip_waiver",
  "guild_waiver",
  "purchase_verified",
  "purchase_unverified",
  "manual_grant",
  "migration"
]);

function parseSource(input: unknown): AccessEntitlementSource {
  const value = asString(input).toLowerCase() as AccessEntitlementSource;
  return ALLOWED_SOURCES.has(value) ? value : "manual_grant";
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
  const subjectPubkey = normalizePubkey(payload.subjectPubkey);
  const resourceId = asString(payload.resourceId);
  const actions = parseActionList(payload.actions);

  if (!hostPubkey) return Response.json({ ok: false, error: "hostPubkey must be a 64-char hex pubkey" }, { status: 400 });
  if (!subjectPubkey) return Response.json({ ok: false, error: "subjectPubkey must be a 64-char hex pubkey" }, { status: 400 });
  if (!resourceId) return Response.json({ ok: false, error: "resourceId is required" }, { status: 400 });
  if (actions.length === 0) return Response.json({ ok: false, error: "actions must include at least one valid action" }, { status: 400 });

  const auth = authorizeAccessAdmin(payload.operatorProofEvent, hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  try {
    const created = grantAccessEntitlement({
      hostPubkey,
      subjectPubkey,
      resourceId,
      actions,
      source: parseSource(payload.source),
      sourceRef: asString(payload.sourceRef) || undefined,
      startsAtSec: parsePositiveInt(payload.startsAtSec),
      expiresAtSec: parsePositiveInt(payload.expiresAtSec),
      metadata: payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? (payload.metadata as Record<string, unknown>) : {}
    });
    return Response.json({ ok: true, entitlement: created, actorPubkey: auth.actorPubkey });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "failed to grant entitlement" }, { status: 400 });
  }
}
