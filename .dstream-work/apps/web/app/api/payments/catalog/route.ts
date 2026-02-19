import { NextResponse } from "next/server";
import { PAYMENT_ASSET_META, PAYMENT_ASSET_ORDER, WALLET_INTEGRATIONS } from "@/lib/payments/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    assets: PAYMENT_ASSET_ORDER.map((asset) => PAYMENT_ASSET_META[asset]),
    wallets: WALLET_INTEGRATIONS
  });
}
