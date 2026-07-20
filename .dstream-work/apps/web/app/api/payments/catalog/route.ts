import { NextResponse } from "next/server";
import { PAYMENT_ASSET_META, PUBLIC_PAYMENT_ASSET_ORDER, WALLET_INTEGRATIONS } from "@/lib/payments/catalog";
import { PAYMENT_RAILS } from "@/lib/payments/rails";
import { getPaymentRailCapabilities } from "@/lib/payments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const publicAssets = new Set(PUBLIC_PAYMENT_ASSET_ORDER);
  const settlement = getPaymentRailCapabilities().filter((row) => publicAssets.has(row.asset));
  const wallets = WALLET_INTEGRATIONS.map((wallet) => ({
    ...wallet,
    assets: wallet.assets.filter((asset) => publicAssets.has(asset))
  })).filter((wallet) => wallet.assets.length > 0);
  const rails = PAYMENT_RAILS.map((rail) => ({
    ...rail,
    assets: rail.assets.filter((asset) => publicAssets.has(asset)),
    ...(rail.id === "utxo" && publicAssets.has("btc") ? { description: "Verified Bitcoin on-chain settlement." } : {}),
    ...(rail.verifiedAssets ? { verifiedAssets: rail.verifiedAssets.filter((asset) => publicAssets.has(asset)) } : {})
  })).filter((rail) => rail.assets.length > 0);
  return NextResponse.json({
    ok: true,
    assets: PUBLIC_PAYMENT_ASSET_ORDER.map((asset) => PAYMENT_ASSET_META[asset]),
    wallets,
    rails,
    settlement,
    nativeSettlement: settlement
  });
}
