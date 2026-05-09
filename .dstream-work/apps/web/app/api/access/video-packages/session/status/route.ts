import { getVideoAccessPackageById } from "@/lib/access/packages";
import { getVideoPackagePaymentSession, syncVideoPackagePaymentSession } from "@/lib/access/paymentSessions";
import { asString } from "../../../_lib";

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
  const sessionId = asString(payload.sessionId);
  if (!sessionId) return Response.json({ ok: false, error: "sessionId is required" }, { status: 400 });

  try {
    const session = await syncVideoPackagePaymentSession(sessionId);
    const pkg = getVideoAccessPackageById(session.packageId);
    return Response.json({
      ok: true,
      package: pkg,
      session
    });
  } catch (error: any) {
    const found = getVideoPackagePaymentSession(sessionId);
    if (!found) {
      return Response.json({ ok: false, error: "Payment session not found." }, { status: 404 });
    }
    return Response.json(
      {
        ok: false,
        error: error?.message ?? "failed to sync payment session",
        session: found
      },
      { status: 400 }
    );
  }
}
