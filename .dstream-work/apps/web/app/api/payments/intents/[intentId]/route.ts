import { authorizePaymentIntent } from "@/lib/payments/server/intentStore";
import { PaymentVerificationError } from "@/lib/payments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ intentId: string }> }): Promise<Response> {
  try {
    const { intentId } = await context.params;
    const authorization = req.headers.get("authorization") ?? "";
    const secret = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? req.headers.get("x-payment-intent-secret")?.trim() ?? "";
    const result = authorizePaymentIntent(intentId, secret);
    return Response.json({ ok: true, intent: result.intent });
  } catch (error) {
    const status = error instanceof PaymentVerificationError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to read payment intent.";
    return Response.json({ ok: false, error: message }, { status });
  }
}
