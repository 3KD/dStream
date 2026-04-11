import { disableVideoAccessPackage } from "@/lib/access/packages";
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
  const packageId = asString(payload.packageId);
  const hostPubkey = normalizePubkey(payload.hostPubkey);
  if (!packageId) return Response.json({ ok: false, error: "packageId is required" }, { status: 400 });
  if (!hostPubkey) return Response.json({ ok: false, error: "hostPubkey must be a valid 64-char hex pubkey" }, { status: 400 });

  const auth = authorizeAccessAdmin(payload.operatorProofEvent, hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  try {
    const pkg = disableVideoAccessPackage({ packageId, hostPubkey });
    return Response.json({ ok: true, package: pkg, actorPubkey: auth.actorPubkey });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "failed to disable Video package" }, { status: 400 });
  }
}
