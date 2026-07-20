import { getPaymentRailCapabilities } from "@/lib/payments/server";
import { evaluatePaymentCapabilities, getPaymentStorageHealth } from "@/lib/payments/server/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const readiness = evaluatePaymentCapabilities(getPaymentRailCapabilities());
  const storage = getPaymentStorageHealth();
  const ready = readiness.ready && storage.every((store) => store.ok);
  return Response.json(
    {
      ok: ready,
      ready,
      required: readiness.required,
      missing: readiness.missing,
      storage
    },
    { status: ready ? 200 : 503 }
  );
}
