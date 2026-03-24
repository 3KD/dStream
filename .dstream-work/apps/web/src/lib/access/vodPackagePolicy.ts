export const VOD_PURCHASE_POLICIES = ["operator_or_verified", "verified_only", "unverified_ok"] as const;
export type VodPurchasePolicy = (typeof VOD_PURCHASE_POLICIES)[number];

export const DEFAULT_VOD_PURCHASE_POLICY: VodPurchasePolicy = "operator_or_verified";

export function normalizeVodPurchasePolicy(input: unknown): VodPurchasePolicy {
  if (typeof input !== "string") return DEFAULT_VOD_PURCHASE_POLICY;
  const value = input.trim().toLowerCase();
  if (value === "verified_only") return "verified_only";
  if (value === "unverified_ok") return "unverified_ok";
  return DEFAULT_VOD_PURCHASE_POLICY;
}

export function getVodPurchasePolicyFromMetadata(metadata: Record<string, unknown> | null | undefined): VodPurchasePolicy {
  return normalizeVodPurchasePolicy(metadata?.purchasePolicy);
}

export function getVodPurchasePolicyLabel(policy: VodPurchasePolicy): string {
  if (policy === "verified_only") return "Verified settlement only";
  if (policy === "unverified_ok") return "Allow unverified unlocks";
  return "Verified or operator override";
}
