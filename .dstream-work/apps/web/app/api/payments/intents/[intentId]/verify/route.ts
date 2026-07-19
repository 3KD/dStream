import { authorizePaymentIntent, settlePaymentIntent } from "@/lib/payments/server/intentStore";
import { recordPaymentSettlement } from "@/lib/payments/server/settlementStore";
import { PaymentVerificationError, verifyPayment, type PaymentProof } from "@/lib/payments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ intentId: string }> }): Promise<Response> {
  try {
    const { intentId } = await context.params;
    const payload = (await req.json()) as Record<string, unknown>;
    const secret = typeof payload.secret === "string" ? payload.secret.trim() : "";
    const authorized = authorizePaymentIntent(intentId, secret);
    if (authorized.intent.status === "settled") {
      return Response.json({ ok: true, intent: authorized.intent, existing: true });
    }
    const suppliedProof =
      payload.proof && typeof payload.proof === "object" && !Array.isArray(payload.proof)
        ? (payload.proof as PaymentProof)
        : {};
    const proof = { ...suppliedProof, ...authorized.verificationContext };
    const payment = await verifyPayment({
      asset: authorized.intent.asset,
      paymentRailId: authorized.intent.railId,
      network: authorized.intent.network,
      address: authorized.intent.address,
      amount: authorized.intent.amount,
      intentId: authorized.intent.id,
      recipientPubkey: authorized.intent.recipientPubkey,
      txId:
        typeof proof.txId === "string"
          ? proof.txId
          : typeof proof.transactionHash === "string"
            ? proof.transactionHash
            : undefined,
      proof
    });
    const settlement = recordPaymentSettlement({
      payment,
      scopeType: authorized.intent.scope.type,
      scopeId: authorized.intent.scope.id,
      buyerPubkey: authorized.intent.buyerPubkey
    });
    const intent = settlePaymentIntent(intentId, secret, payment);
    return Response.json({
      ok: true,
      intent,
      settlement: { id: settlement.record.id, existing: settlement.existing }
    });
  } catch (error) {
    const status = error instanceof PaymentVerificationError ? error.status : 502;
    const message = error instanceof Error ? error.message : "Payment verification failed.";
    return Response.json({ ok: false, error: message }, { status });
  }
}
