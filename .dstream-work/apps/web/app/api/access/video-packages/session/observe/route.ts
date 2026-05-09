import { getVideoAccessPackageById } from "@/lib/access/packages";
import { getVideoPackagePaymentSession, observeVideoPackagePaymentSession } from "@/lib/access/paymentSessions";
import { verifyAccessProof } from "@/lib/access/proof";
import { asString } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getFirstTagValue(tags: unknown, name: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const rawTag of tags) {
    if (!Array.isArray(rawTag)) continue;
    if (rawTag[0] !== name) continue;
    if (typeof rawTag[1] !== "string") continue;
    const value = rawTag[1].trim();
    if (!value) continue;
    return value;
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const sessionId = asString(payload.sessionId);
  if (!sessionId) return Response.json({ ok: false, error: "sessionId is required" }, { status: 400 });

  const current = getVideoPackagePaymentSession(sessionId);
  if (!current) return Response.json({ ok: false, error: "Payment session not found." }, { status: 404 });
  const pkg = getVideoAccessPackageById(current.packageId);
  if (!pkg) return Response.json({ ok: false, error: "Video package not found." }, { status: 404 });

  const buyerProof = verifyAccessProof(payload.buyerProofEvent, "access_purchase");
  if (!buyerProof.ok) return Response.json({ ok: false, error: buyerProof.error }, { status: buyerProof.status });
  if (buyerProof.pubkey !== current.viewerPubkey) {
    return Response.json({ ok: false, error: "Signed purchase proof viewer does not match session viewer." }, { status: 403 });
  }

  const proofHostTag = getFirstTagValue((payload.buyerProofEvent as { tags?: unknown } | undefined)?.tags, "host");
  if (proofHostTag && proofHostTag !== pkg.hostPubkey) {
    return Response.json({ ok: false, error: "Signed purchase proof host does not match package host." }, { status: 403 });
  }
  const proofPackageTag = getFirstTagValue((payload.buyerProofEvent as { tags?: unknown } | undefined)?.tags, "pkg");
  if (proofPackageTag && proofPackageTag !== pkg.id) {
    return Response.json({ ok: false, error: "Signed purchase proof package id does not match package." }, { status: 403 });
  }

  try {
    const session = await observeVideoPackagePaymentSession({
      sessionId,
      txRef: asString(payload.txRef) || undefined,
      settlementProof:
        payload.settlementProof && typeof payload.settlementProof === "object" && !Array.isArray(payload.settlementProof)
          ? (payload.settlementProof as Record<string, unknown>)
          : undefined,
      paymentProof:
        payload.paymentProof && typeof payload.paymentProof === "object" && !Array.isArray(payload.paymentProof)
          ? (payload.paymentProof as Record<string, unknown>)
          : undefined,
      metadata:
        payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
          ? (payload.metadata as Record<string, unknown>)
          : {}
    });
    return Response.json({
      ok: true,
      package: pkg,
      session
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: error?.message ?? "failed to observe payment session" },
      { status: 400 }
    );
  }
}
