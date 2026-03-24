import { listAccessDenyRules } from "@/lib/access/store";
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

  const rows = listAccessDenyRules({
    hostPubkey,
    subjectPubkey: normalizePubkey(payload.subjectPubkey) || undefined,
    resourceId: asString(payload.resourceId) || undefined,
    limit: parsePositiveInt(payload.limit) ?? 200
  });

  return Response.json({
    ok: true,
    denyRules: rows,
    count: rows.length,
    actorPubkey: auth.actorPubkey
  });
}
