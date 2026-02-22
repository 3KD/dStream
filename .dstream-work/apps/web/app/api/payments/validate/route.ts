import { NextRequest, NextResponse } from "next/server";
import { createPaymentMethodDraft, normalizePaymentAsset, type PaymentMethodDraft, validatePaymentMethodDrafts } from "@/lib/payments/methods";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const methodsRaw = Array.isArray(body?.methods) ? body.methods : [];
  const drafts: PaymentMethodDraft[] = methodsRaw.map((row: any) => ({
    ...createPaymentMethodDraft(),
    asset: normalizePaymentAsset(row?.asset) ?? "eth",
    address: typeof row?.address === "string" ? row.address : "",
    network: typeof row?.network === "string" ? row.network : "",
    label: typeof row?.label === "string" ? row.label : "",
    amount: typeof row?.amount === "string" ? row.amount : ""
  }));

  const result = validatePaymentMethodDrafts(drafts);
  return NextResponse.json({
    ok: result.errors.length === 0,
    methods: result.methods,
    errors: result.errors
  });
}
