import type { VideoPurchasePolicy } from "./videoPackagePolicy";

export type VideoCheckoutVerificationMode =
  | "stake_verified"
  | "external_verified"
  | "operator_override"
  | "unverified_fallback";

export function formatVideoCheckoutVerificationMode(mode: VideoCheckoutVerificationMode | null | undefined): string | null {
  if (mode === "stake_verified") return "verified stake settlement";
  if (mode === "external_verified") return "verified external settlement";
  if (mode === "operator_override") return "host operator confirmation";
  if (mode === "unverified_fallback") return "unverified fallback";
  return null;
}

export function normalizeVideoPurchaseErrorMessage(
  message: string | null | undefined,
  policy: VideoPurchasePolicy | null | undefined
): string {
  const raw = typeof message === "string" && message.trim() ? message.trim() : "Failed to unlock this package.";
  const lower = raw.toLowerCase();

  if (lower.includes("invalid stake session token")) {
    return "Verified stake session is invalid or expired. Start a new stake session and retry.";
  }
  if (lower.includes("no confirmed stake payment found")) {
    return "Stake payment is not confirmed yet. Wait for confirmations and retry unlock.";
  }
  if (lower.includes("xmr wallet rpc not configured")) {
    return "Host wallet verification is not configured for this stream.";
  }
  if (lower.includes("requires verified settlement")) {
    return "This package requires verified settlement. Use verified stake flow or host confirmation.";
  }
  if (lower.includes("requires verified settlement or host operator confirmation")) {
    return "This package requires verified settlement or host operator confirmation.";
  }
  if (lower.includes("unverified unlocks are disabled")) {
    return "Unverified unlock fallback is disabled on this node.";
  }
  if (lower.includes("verification failed")) {
    if (policy === "verified_only") {
      return "Verification failed. This package is verified-only; complete a verified settlement and retry.";
    }
    if (policy === "operator_or_verified") {
      return "Verification failed. Ask host operator to confirm purchase or complete verified settlement.";
    }
  }
  return raw;
}

