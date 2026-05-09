import type { StreamPaymentAsset } from "@dstream/protocol";

export const PAYMENT_ASSET_DECIMALS: Record<StreamPaymentAsset, number> = {
  xmr: 12,
  eth: 18,
  btc: 8,
  usdt: 6,
  xrp: 6,
  usdc: 6,
  sol: 9,
  trx: 6,
  doge: 8,
  bch: 8,
  ada: 6,
  pepe: 18
};

export function parseAmountToUnits(amountRaw: string | null | undefined, decimals: number): bigint | null {
  const raw = (amountRaw ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fracInput = match[2] ?? "";
  if (fracInput.length > decimals) return null;
  const frac = fracInput.padEnd(decimals, "0");
  try {
    const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || "0");
    if (value <= 0n) return null;
    return value;
  } catch {
    return null;
  }
}

export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  if (fraction === 0n) return `${negative ? "-" : ""}${whole.toString()}`;
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}.${fractionText}`;
}
