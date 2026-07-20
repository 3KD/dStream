import { constants, accessSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PaymentRailCapability } from "./types";

const INTENT_STORE_PATH =
  (process.env.DSTREAM_PAYMENT_INTENT_STORE_PATH ?? "/var/lib/dstream/payment-intents.json").trim() ||
  "/var/lib/dstream/payment-intents.json";
const SETTLEMENT_STORE_PATH =
  (process.env.DSTREAM_PAYMENT_SETTLEMENT_STORE_PATH ?? "/var/lib/dstream/payment-settlements.json").trim() ||
  "/var/lib/dstream/payment-settlements.json";

export interface PaymentStoreHealth {
  name: "intents" | "settlements";
  ok: boolean;
  writable: boolean;
  valid: boolean;
  backupUsed: boolean;
  persistentPath: boolean;
  reason?: string;
}

export function paymentCapabilityKey(capability: Pick<PaymentRailCapability, "asset" | "railId">): string {
  return `${capability.asset}:${capability.railId}`;
}

export function readRequiredPaymentCapabilities(): string[] {
  const raw = (process.env.DSTREAM_REQUIRED_PAYMENT_CAPABILITIES ?? "").trim();
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/g)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function evaluatePaymentCapabilities(capabilities: PaymentRailCapability[]) {
  const required = readRequiredPaymentCapabilities();
  const byKey = new Map(capabilities.map((capability) => [paymentCapabilityKey(capability), capability]));
  const missing = required.filter((key) => !byKey.get(key)?.configured);
  return {
    required,
    missing,
    ready: missing.length === 0,
    capabilities: capabilities.map((capability) => ({
      ...capability,
      required: required.includes(paymentCapabilityKey(capability))
    }))
  };
}

function validJsonFile(path: string): { valid: boolean; backupUsed: boolean; reason?: string } {
  if (!existsSync(path)) return { valid: true, backupUsed: false };
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return { valid: true, backupUsed: false };
  } catch {
    const backup = `${path}.bak`;
    try {
      JSON.parse(readFileSync(backup, "utf8"));
      return { valid: true, backupUsed: true, reason: "Primary store is invalid; readable backup is available." };
    } catch {
      return { valid: false, backupUsed: false, reason: "Store and backup are unreadable or invalid." };
    }
  }
}

function inspectStore(name: PaymentStoreHealth["name"], path: string): PaymentStoreHealth {
  let writable = false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    accessSync(dirname(path), constants.R_OK | constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  const json = validJsonFile(path);
  const persistentPath = path === "/var/lib/dstream" || path.startsWith("/var/lib/dstream/");
  return {
    name,
    ok: writable && json.valid && persistentPath,
    writable,
    valid: json.valid,
    backupUsed: json.backupUsed,
    persistentPath,
    ...(!writable
      ? { reason: "Store directory is not readable and writable." }
      : !persistentPath
        ? { reason: "Store is outside the persistent /var/lib/dstream volume." }
        : json.reason
          ? { reason: json.reason }
          : {})
  };
}

export function getPaymentStorageHealth(): PaymentStoreHealth[] {
  return [inspectStore("intents", INTENT_STORE_PATH), inspectStore("settlements", SETTLEMENT_STORE_PATH)];
}
