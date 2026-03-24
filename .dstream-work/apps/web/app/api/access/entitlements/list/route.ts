import { listAccessEntitlements } from "@/lib/access/store";
import { asString, authorizeAccessAdmin, normalizePubkey, parsePositiveInt } from "../../_lib";

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
  const hostPubkey = normalizePubkey(payload.hostPubkey);
  if (!hostPubkey) return Response.json({ ok: false, error: "hostPubkey must be a 64-char hex pubkey" }, { status: 400 });

  const auth = authorizeAccessAdmin(payload.operatorProofEvent, hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const statusRaw = asString(payload.status).toLowerCase();
  const status =
    statusRaw === "active" || statusRaw === "revoked" || statusRaw === "expired" || statusRaw === "all" ? statusRaw : "active";

  const rows = listAccessEntitlements({
    hostPubkey,
    subjectPubkey: normalizePubkey(payload.subjectPubkey) || undefined,
    resourceId: asString(payload.resourceId) || undefined,
    status: status as any,
    limit: parsePositiveInt(payload.limit) ?? 200
  });

  return Response.json({
    ok: true,
    entitlements: rows,
    count: rows.length,
    actorPubkey: auth.actorPubkey
  });
}
