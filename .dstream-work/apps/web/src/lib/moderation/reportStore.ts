import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { CreateModerationReportInput, ModerationReport, ReportStatus } from "./reportTypes";
import {
  normalizePubkeyHex,
  normalizeReportReasonCode,
  sanitizeOptionalText
} from "./reportTypes";

const STORE_PATH = (process.env.DSTREAM_REPORT_STORE_PATH ?? "/tmp/dstream-reports.json").trim() || "/tmp/dstream-reports.json";
const MAX_REPORTS = 2000;

let loaded = false;
let reportsCache: ModerationReport[] = [];

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parseStoredReport(input: unknown): ModerationReport | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<ModerationReport>;
  if (typeof row.id !== "string" || !row.id) return null;
  const targetType = typeof row.targetType === "string" ? row.targetType : "";
  if (targetType !== "stream" && targetType !== "user" && targetType !== "message") return null;
  const status = typeof row.status === "string" ? row.status : "";
  if (status !== "open" && status !== "reviewing" && status !== "resolved" && status !== "dismissed") return null;
  const createdAtSec = Number(row.createdAtSec);
  const updatedAtSec = Number(row.updatedAtSec);
  if (!Number.isInteger(createdAtSec) || !Number.isInteger(updatedAtSec)) return null;
  const reasonCode = normalizeReportReasonCode(row.reasonCode);

  const parsed: ModerationReport = {
    id: row.id,
    createdAtSec,
    updatedAtSec,
    status,
    reasonCode,
    targetType
  };

  const reporterPubkey = normalizePubkeyHex(row.reporterPubkey);
  if (reporterPubkey) parsed.reporterPubkey = reporterPubkey;
  const targetPubkey = normalizePubkeyHex(row.targetPubkey);
  if (targetPubkey) parsed.targetPubkey = targetPubkey;

  parsed.note = sanitizeOptionalText(row.note, 1000);
  parsed.targetStreamId = sanitizeOptionalText(row.targetStreamId, 160);
  parsed.targetMessageId = sanitizeOptionalText(row.targetMessageId, 160);
  parsed.targetMessagePreview = sanitizeOptionalText(row.targetMessagePreview, 280);
  parsed.contextPage = sanitizeOptionalText(row.contextPage, 160);
  parsed.contextUrl = sanitizeOptionalText(row.contextUrl, 500);
  parsed.actionTaken = sanitizeOptionalText(row.actionTaken, 120);
  parsed.resolutionNote = sanitizeOptionalText(row.resolutionNote, 500);

  const resolvedAtSec = Number(row.resolvedAtSec);
  if (Number.isInteger(resolvedAtSec) && resolvedAtSec > 0) parsed.resolvedAtSec = resolvedAtSec;
  const resolverPubkey = normalizePubkeyHex(row.resolverPubkey);
  if (resolverPubkey) parsed.resolverPubkey = resolverPubkey;

  return parsed;
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { reports?: unknown[] } | null;
    const rows = Array.isArray(parsed?.reports) ? parsed.reports : [];
    reportsCache = rows.map(parseStoredReport).filter((value): value is ModerationReport => !!value);
  } catch {
    reportsCache = [];
  }
}

function persist(): void {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    const payload = {
      version: 1,
      updatedAtSec: nowSec(),
      reports: reportsCache
    };
    writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // ignore persistence errors; in-memory queue still functions.
  }
}

function assertValidTarget(input: {
  targetType: "stream" | "user" | "message";
  targetPubkey?: string;
  targetStreamId?: string;
  targetMessageId?: string;
}): void {
  if (input.targetType === "stream") {
    if (!input.targetPubkey || !input.targetStreamId) {
      throw new Error("stream reports require targetPubkey and targetStreamId.");
    }
    return;
  }
  if (input.targetType === "user") {
    if (!input.targetPubkey) throw new Error("user reports require targetPubkey.");
    return;
  }
  if (!input.targetPubkey || !input.targetMessageId) {
    throw new Error("message reports require targetPubkey and targetMessageId.");
  }
}

export function createModerationReport(input: CreateModerationReportInput): ModerationReport {
  ensureLoaded();

  const targetType = input.targetType;
  const targetPubkey = normalizePubkeyHex(input.targetPubkey);
  const targetStreamId = sanitizeOptionalText(input.targetStreamId, 160);
  const targetMessageId = sanitizeOptionalText(input.targetMessageId, 160);
  const reasonCode = normalizeReportReasonCode(input.reasonCode);
  const reporterPubkey = normalizePubkeyHex(input.reporterPubkey);
  const note = sanitizeOptionalText(input.note, 1000);
  const targetMessagePreview = sanitizeOptionalText(input.targetMessagePreview, 280);
  const contextPage = sanitizeOptionalText(input.contextPage, 160);
  const contextUrl = sanitizeOptionalText(input.contextUrl, 500);

  assertValidTarget({
    targetType,
    targetPubkey: targetPubkey ?? undefined,
    targetStreamId,
    targetMessageId
  });

  const timestamp = nowSec();
  const report: ModerationReport = {
    id: randomUUID(),
    createdAtSec: timestamp,
    updatedAtSec: timestamp,
    status: "open",
    reasonCode,
    targetType,
    reporterPubkey: reporterPubkey ?? undefined,
    targetPubkey: targetPubkey ?? undefined,
    targetStreamId,
    targetMessageId,
    targetMessagePreview,
    note,
    contextPage,
    contextUrl
  };

  reportsCache.push(report);
  reportsCache = reportsCache
    .sort((a, b) => b.createdAtSec - a.createdAtSec)
    .slice(0, MAX_REPORTS);
  persist();
  return report;
}

export function listModerationReports(options?: {
  status?: ReportStatus | "all";
  limit?: number;
}): ModerationReport[] {
  ensureLoaded();
  const status = options?.status ?? "all";
  const limit = Math.max(1, Math.min(options?.limit ?? 200, MAX_REPORTS));
  const filtered = status === "all" ? reportsCache : reportsCache.filter((row) => row.status === status);
  return filtered.slice(0, limit);
}

export function updateModerationReport(
  reportId: string,
  input: {
    status?: ReportStatus;
    actionTaken?: string;
    resolutionNote?: string;
    resolverPubkey?: string;
  }
): ModerationReport {
  ensureLoaded();
  const normalizedId = sanitizeOptionalText(reportId, 160);
  if (!normalizedId) throw new Error("reportId is required.");

  const existing = reportsCache.find((row) => row.id === normalizedId);
  if (!existing) throw new Error("Report not found.");

  const nextStatus = input.status ?? existing.status;
  const actionTaken = sanitizeOptionalText(input.actionTaken, 120);
  const resolutionNote = sanitizeOptionalText(input.resolutionNote, 500);
  const resolverPubkey = normalizePubkeyHex(input.resolverPubkey);
  const timestamp = nowSec();

  existing.status = nextStatus;
  existing.updatedAtSec = timestamp;
  existing.actionTaken = actionTaken;
  existing.resolutionNote = resolutionNote;

  if (nextStatus === "resolved" || nextStatus === "dismissed") {
    existing.resolvedAtSec = timestamp;
    existing.resolverPubkey = resolverPubkey ?? existing.resolverPubkey;
  } else {
    existing.resolvedAtSec = undefined;
    existing.resolverPubkey = undefined;
  }

  persist();
  return existing;
}

