import { STREAM_PAYMENT_ASSETS, type StreamPaymentAsset } from "@dstream/protocol";

const CLIENT_PUBLIC_PAYMENT_ASSETS = process.env.NEXT_PUBLIC_DSTREAM_PAYMENT_ASSETS ?? "";
const PAYMENT_ASSET_SET = new Set<StreamPaymentAsset>(STREAM_PAYMENT_ASSETS);

function configuredAssetsRaw(): string {
  if (typeof window === "undefined") {
    return process.env.DSTREAM_PUBLIC_PAYMENT_ASSETS?.trim() || CLIENT_PUBLIC_PAYMENT_ASSETS;
  }
  return CLIENT_PUBLIC_PAYMENT_ASSETS;
}

export function getPublicPaymentAssets(): StreamPaymentAsset[] {
  const raw = configuredAssetsRaw().trim();
  if (!raw) return [...STREAM_PAYMENT_ASSETS];
  const configured = new Set<StreamPaymentAsset>();
  for (const value of raw.split(",")) {
    const asset = value.trim().toLowerCase() as StreamPaymentAsset;
    if (PAYMENT_ASSET_SET.has(asset)) configured.add(asset);
  }
  return STREAM_PAYMENT_ASSETS.filter((asset) => configured.has(asset));
}

export function isPublicPaymentAsset(asset: StreamPaymentAsset): boolean {
  return getPublicPaymentAssets().includes(asset);
}
