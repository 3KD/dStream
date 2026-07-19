import { NativePaymentVerificationError } from "./types";

export function decimalToAtomic(amount: string, decimals: number): bigint {
  const value = amount.trim();
  const match = value.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new NativePaymentVerificationError("Payment amount must be a positive decimal string.", 400);
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new NativePaymentVerificationError(`Payment amount supports at most ${decimals} decimal places.`, 400);
  }
  const atomic = BigInt(match[1] ?? "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (atomic <= 0n) throw new NativePaymentVerificationError("Payment amount must be positive.", 400);
  return atomic;
}

export function parseHexQuantity(input: unknown, label: string): bigint {
  if (typeof input !== "string" || !/^0x[0-9a-f]+$/i.test(input)) {
    throw new NativePaymentVerificationError(`${label} is missing or malformed.`, 502);
  }
  return BigInt(input);
}

export function parseIntegerQuantity(input: unknown, label: string): bigint {
  if (typeof input === "string" && /^\d+$/.test(input)) return BigInt(input);
  if (typeof input === "number" && Number.isSafeInteger(input) && input >= 0) return BigInt(input);
  throw new NativePaymentVerificationError(`${label} is missing or outside the safe integer range.`, 502);
}

export function parsePositiveEnvInt(name: string, fallback: number, max = 10000): number {
  const value = Number.parseInt((process.env[name] ?? String(fallback)).trim(), 10);
  return Number.isInteger(value) && value > 0 && value <= max ? value : fallback;
}
