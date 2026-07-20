import { NextRequest, NextResponse } from "next/server";
import { createPaymentMethodDraft, normalizePaymentAsset, type PaymentMethodDraft, validatePaymentMethodDrafts } from "@/lib/payments/methods";
import { isPublicPaymentAsset } from "@/lib/payments/publicAssets";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const methodsRaw = Array.isArray(body?.methods) ? body.methods : [];
  const publicErrors: string[] = [];
  const drafts: PaymentMethodDraft[] = methodsRaw.map((row: any) => ({
    ...createPaymentMethodDraft(),
    asset: normalizePaymentAsset(row?.asset) ?? "xmr",
    address: typeof row?.address === "string" ? row.address : "",
    network: typeof row?.network === "string" ? row.network : "",
    label: typeof row?.label === "string" ? row.label : "",
    amount: typeof row?.amount === "string" ? row.amount : ""
  }));

  for (let index = 0; index < drafts.length; index++) {
    const normalizedAsset = normalizePaymentAsset(methodsRaw[index]?.asset);
    if (!normalizedAsset) {
      publicErrors.push(`Payment row ${index + 1}: asset is unsupported.`);
    } else if (!isPublicPaymentAsset(normalizedAsset)) {
      publicErrors.push(`Payment row ${index + 1}: ${drafts[index]!.asset.toUpperCase()} is not enabled on this deployment.`);
    }
  }

  const result = validatePaymentMethodDrafts(drafts);
  const errors = [...publicErrors, ...result.errors];
  return NextResponse.json({
    ok: errors.length === 0,
    methods: result.methods.filter((method) => isPublicPaymentAsset(method.asset)),
    errors
  });
}
