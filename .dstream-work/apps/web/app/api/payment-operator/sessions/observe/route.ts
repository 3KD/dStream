import { observePaymentOperatorSession } from "@/lib/access/paymentOperator";
import { authorizePaymentOperatorRequest } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const authError = authorizePaymentOperatorRequest(req);
  if (authError) return authError;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await observePaymentOperatorSession(body as never);
    const status = result.ok ? 200 : 400;
    return Response.json(result, { status });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: error?.message ?? "failed to observe payment operator session" },
      { status: 400 }
    );
  }
}
