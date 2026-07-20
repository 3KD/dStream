import { getPaymentRailCapabilities } from "@/lib/payments/server";
import { evaluatePaymentCapabilities, getPaymentStorageHealth } from "@/lib/payments/server/readiness";
import { getPublicPaymentAssets } from "@/lib/payments/publicAssets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const readiness = evaluatePaymentCapabilities(getPaymentRailCapabilities());
  const storage = getPaymentStorageHealth();
  const publicAssets = new Set(getPublicPaymentAssets());
  const capabilities = readiness.capabilities.filter((row) => publicAssets.has(row.asset));
  return Response.json({
    ok: true,
    ready: readiness.ready && storage.every((store) => store.ok),
    required: readiness.required,
    missing: readiness.missing,
    settlement: capabilities,
    nativeSettlement: capabilities,
    storage
  });
}
