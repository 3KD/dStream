import { getVideoAccessPackageById } from "@/lib/access/packages";
import { createVideoPackagePaymentSession } from "@/lib/access/paymentSessions";
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
  const packageId = asString(payload.packageId);
  const sessionId = asString(payload.sessionId);
  if (!packageId) return Response.json({ ok: false, error: "packageId is required" }, { status: 400 });

  const buyerProof = verifyAccessProof(payload.buyerProofEvent, "access_purchase");
  if (!buyerProof.ok) return Response.json({ ok: false, error: buyerProof.error }, { status: buyerProof.status });

  const pkg = getVideoAccessPackageById(packageId);
  if (!pkg) return Response.json({ ok: false, error: "Video package not found." }, { status: 404 });
  if (pkg.status !== "active") return Response.json({ ok: false, error: "Video package is disabled." }, { status: 403 });

  const proofHostTag = getFirstTagValue((payload.buyerProofEvent as { tags?: unknown } | undefined)?.tags, "host");
  if (proofHostTag && proofHostTag !== pkg.hostPubkey) {
    return Response.json({ ok: false, error: "Signed purchase proof host does not match package host." }, { status: 403 });
  }
  const proofPackageTag = getFirstTagValue((payload.buyerProofEvent as { tags?: unknown } | undefined)?.tags, "pkg");
  if (proofPackageTag && proofPackageTag !== pkg.id) {
    return Response.json({ ok: false, error: "Signed purchase proof package id does not match package." }, { status: 403 });
  }

  try {
    const session = await createVideoPackagePaymentSession({
      packageId: pkg.id,
      sessionId: sessionId || undefined,
      viewerPubkey: buyerProof.pubkey,
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
      { ok: false, error: error?.message ?? "failed to create payment session" },
      { status: 400 }
    );
  }
}
