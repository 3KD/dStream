export const Video_PURCHASE_POLICIES = ["operator_or_verified", "verified_only", "unverified_ok"] as const;
export type VideoPurchasePolicy = (typeof Video_PURCHASE_POLICIES)[number];

export const DEFAULT_Video_PURCHASE_POLICY: VideoPurchasePolicy = "operator_or_verified";

export function normalizeVideoPurchasePolicy(input: unknown): VideoPurchasePolicy {
  if (typeof input !== "string") return DEFAULT_Video_PURCHASE_POLICY;
  const value = input.trim().toLowerCase();
  if (value === "verified_only") return "verified_only";
  if (value === "unverified_ok") return "unverified_ok";
  return DEFAULT_Video_PURCHASE_POLICY;
}

export function getVideoPurchasePolicyFromMetadata(metadata: Record<string, unknown> | null | undefined): VideoPurchasePolicy {
  return normalizeVideoPurchasePolicy(metadata?.purchasePolicy);
}

export function getVideoPurchasePolicyLabel(policy: VideoPurchasePolicy): string {
  if (policy === "verified_only") return "Verified settlement only";
  if (policy === "unverified_ok") return "Allow unverified unlocks";
  return "Verified or operator override";
}
