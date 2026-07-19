import { getNativePaymentRailCapabilities } from "@/lib/payments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    nativeSettlement: getNativePaymentRailCapabilities()
  });
}
