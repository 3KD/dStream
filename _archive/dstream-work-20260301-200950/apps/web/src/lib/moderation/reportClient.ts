"use client";

import type { NostrEvent } from "@dstream/protocol";
import type { CreateModerationReportInput, ModerationReport, ReportStatus } from "./reportTypes";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function asErrorMessage(input: unknown, fallback: string): string {
  if (!input || typeof input !== "object") return fallback;
  const value = (input as any).error;
  return typeof value === "string" && value.trim() ? value : fallback;
}

async function parseJsonResponse(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function buildSignedScopeProof(
  signEvent: ((event: Omit<NostrEvent, "id" | "sig">) => Promise<NostrEvent>) | undefined,
  pubkey: string | null | undefined,
  scope: "report_submit" | "moderation_operator",
  extraTags: string[][] = [],
  ttlSec = 600
): Promise<NostrEvent | null> {
  if (!signEvent || !pubkey) return null;
  const exp = nowSec() + Math.max(60, Math.min(ttlSec, 3600));
  const unsigned: Omit<NostrEvent, "id" | "sig"> = {
    kind: 27235,
    pubkey,
    created_at: nowSec(),
    tags: [["dstream", scope], ["exp", String(exp)], ...extraTags],
    content: ""
  };
  try {
    return await signEvent(unsigned);
  } catch {
    return null;
  }
}

export async function submitModerationReport(input: {
  report: CreateModerationReportInput;
  reporterProofEvent?: NostrEvent | null;
}): Promise<ModerationReport> {
  const response = await fetch("/api/moderation/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "submit",
      report: input.report,
      reporterProofEvent: input.reporterProofEvent ?? null
    }),
    cache: "no-store"
  });

  const body = await parseJsonResponse(response);
  if (!response.ok || !body?.ok || !body?.report) {
    throw new Error(asErrorMessage(body, "Failed to submit report."));
  }
  return body.report as ModerationReport;
}

export async function listModerationReports(input: {
  operatorProofEvent: NostrEvent;
  status?: ReportStatus | "all";
  limit?: number;
}): Promise<ModerationReport[]> {
  const response = await fetch("/api/moderation/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "list",
      operatorProofEvent: input.operatorProofEvent,
      status: input.status ?? "all",
      limit: input.limit
    }),
    cache: "no-store"
  });

  const body = await parseJsonResponse(response);
  if (!response.ok || !body?.ok || !Array.isArray(body.reports)) {
    throw new Error(asErrorMessage(body, "Failed to load moderation reports."));
  }
  return body.reports as ModerationReport[];
}

export async function updateModerationReport(input: {
  operatorProofEvent: NostrEvent;
  reportId: string;
  status?: ReportStatus;
  actionTaken?: string;
  resolutionNote?: string;
}): Promise<ModerationReport> {
  const response = await fetch("/api/moderation/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "update",
      operatorProofEvent: input.operatorProofEvent,
      reportId: input.reportId,
      status: input.status,
      actionTaken: input.actionTaken,
      resolutionNote: input.resolutionNote
    }),
    cache: "no-store"
  });

  const body = await parseJsonResponse(response);
  if (!response.ok || !body?.ok || !body?.report) {
    throw new Error(asErrorMessage(body, "Failed to update moderation report."));
  }
  return body.report as ModerationReport;
}

