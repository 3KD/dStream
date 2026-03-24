export const REPORT_TARGET_TYPES = ["stream", "user", "message"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASON_CODES = [
  "spam",
  "harassment",
  "hate",
  "sexual",
  "violence",
  "illegal",
  "impersonation",
  "copyright",
  "scam",
  "other"
] as const;
export type ReportReasonCode = (typeof REPORT_REASON_CODES)[number];

export const REPORT_STATUSES = ["open", "reviewing", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ModerationReport {
  id: string;
  createdAtSec: number;
  updatedAtSec: number;
  status: ReportStatus;
  reasonCode: ReportReasonCode;
  note?: string;
  reporterPubkey?: string;
  targetType: ReportTargetType;
  targetPubkey?: string;
  targetStreamId?: string;
  targetMessageId?: string;
  targetMessagePreview?: string;
  contextPage?: string;
  contextUrl?: string;
  actionTaken?: string;
  resolutionNote?: string;
  resolvedAtSec?: number;
  resolverPubkey?: string;
}

export interface CreateModerationReportInput {
  reasonCode: ReportReasonCode;
  note?: string;
  reporterPubkey?: string;
  targetType: ReportTargetType;
  targetPubkey?: string;
  targetStreamId?: string;
  targetMessageId?: string;
  targetMessagePreview?: string;
  contextPage?: string;
  contextUrl?: string;
}

export function isReportTargetType(input: string): input is ReportTargetType {
  return (REPORT_TARGET_TYPES as readonly string[]).includes(input);
}

export function isReportReasonCode(input: string): input is ReportReasonCode {
  return (REPORT_REASON_CODES as readonly string[]).includes(input);
}

export function isReportStatus(input: string): input is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(input);
}

export function normalizeReportReasonCode(input: unknown): ReportReasonCode {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  return isReportReasonCode(value) ? value : "other";
}

export function normalizeReportTargetType(input: unknown): ReportTargetType | null {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  return isReportTargetType(value) ? value : null;
}

export function normalizeReportStatus(input: unknown): ReportStatus | null {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  return isReportStatus(value) ? value : null;
}

export function normalizePubkeyHex(input: unknown): string | null {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export function sanitizeOptionalText(input: unknown, maxLen: number): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  return normalized.slice(0, maxLen);
}

