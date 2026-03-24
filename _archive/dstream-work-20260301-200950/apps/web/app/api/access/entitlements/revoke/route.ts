import { listAccessEntitlements, revokeAccessEntitlement } from "@/lib/access/store";
import { asString, authorizeAccessAdmin, normalizePubkey } from "../../_lib";

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
  const entitlementId = asString(payload.entitlementId);
  if (!entitlementId) return Response.json({ ok: false, error: "entitlementId is required" }, { status: 400 });

  const rows = listAccessEntitlements({ status: "all", limit: 5000 });
  const row = rows.find((entry) => entry.id === entitlementId);
  if (!row) return Response.json({ ok: false, error: "Entitlement not found." }, { status: 404 });

  const hostPubkey = normalizePubkey(payload.hostPubkey) || row.hostPubkey;
  if (!hostPubkey) return Response.json({ ok: false, error: "hostPubkey must be a 64-char hex pubkey" }, { status: 400 });

  const auth = authorizeAccessAdmin(payload.operatorProofEvent, hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  try {
    const revoked = revokeAccessEntitlement({
      entitlementId,
      revokeReason: asString(payload.revokeReason) || undefined
    });
    return Response.json({ ok: true, entitlement: revoked, actorPubkey: auth.actorPubkey });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "failed to revoke entitlement" }, { status: 400 });
  }
}
