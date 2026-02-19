import { validateEvent, verifyEvent } from "nostr-tools";
import type { NostrEvent } from "@dstream/protocol";
import { createModerationReport, listModerationReports, updateModerationReport } from "@/lib/moderation/reportStore";
import {
  normalizePubkeyHex,
  normalizeReportReasonCode,
  normalizeReportStatus,
  normalizeReportTargetType,
  sanitizeOptionalText
} from "@/lib/moderation/reportTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROOF_FUTURE_SEC = 60 * 60;
const MAX_PROOF_AGE_SEC = 15 * 60;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

function readOperatorPubkeys(): string[] {
  const raw = (process.env.NEXT_PUBLIC_DISCOVERY_OPERATOR_PUBKEYS ?? "").trim();
  if (!raw) return [];
  const list = raw
    .split(/[\n,]+/g)
    .map((value) => normalizePubkeyHex(value))
    .filter((value): value is string => !!value);
  return Array.from(new Set(list));
}

function isSignedEvent(input: NostrEvent): input is NostrEvent & { id: string; sig: string } {
  return typeof input.id === "string" && input.id.length > 0 && typeof input.sig === "string" && input.sig.length > 0;
}

function getFirstTagValue(tags: string[][] | undefined, name: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (tag[0] !== name) continue;
    const value = (tag[1] ?? "").trim();
    if (!value) continue;
    return value;
  }
  return null;
}

function verifyScopedProof(
  proofEvent: unknown,
  scope: "report_submit" | "moderation_operator",
  allowedPubkeys: string[]
): { ok: true; pubkey: string } | { ok: false; status: number; error: string } {
  if (!proofEvent || typeof proofEvent !== "object") {
    return { ok: false, status: 401, error: "Signed proof is required." };
  }

  const event = proofEvent as NostrEvent;
  if (!isSignedEvent(event) || !validateEvent(event as any) || !verifyEvent(event as any)) {
    return { ok: false, status: 401, error: "Signed proof event is invalid." };
  }

  const eventPubkey = normalizePubkeyHex(event.pubkey);
  if (!eventPubkey) return { ok: false, status: 401, error: "Signed proof pubkey is invalid." };

  const scopeTag = getFirstTagValue(event.tags, "dstream");
  if (scopeTag !== scope) {
    return { ok: false, status: 401, error: `Signed proof scope must be ${scope}.` };
  }

  const now = nowSec();
  const expRaw = getFirstTagValue(event.tags, "exp");
  const expSec = expRaw && /^\d+$/.test(expRaw) ? Number(expRaw) : 0;
  if (!Number.isInteger(expSec) || expSec <= now || expSec > now + MAX_PROOF_FUTURE_SEC) {
    return { ok: false, status: 401, error: "Signed proof expiration is invalid." };
  }
  if (event.created_at > now + 30 || now - event.created_at > MAX_PROOF_AGE_SEC) {
    return { ok: false, status: 401, error: "Signed proof timestamp is stale." };
  }

  if (allowedPubkeys.length > 0 && !allowedPubkeys.includes(eventPubkey)) {
    return { ok: false, status: 403, error: "Pubkey is not configured as a moderation operator." };
  }

  return { ok: true, pubkey: eventPubkey };
}

function parseLimit(input: unknown, fallback: number): number {
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(parsed, 500));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (!isPlainObject(body)) {
    return Response.json({ ok: false, error: "request body must be an object" }, { status: 400 });
  }

  const actionRaw = typeof body.action === "string" ? body.action.trim().toLowerCase() : "submit";
  const operatorPubkeys = readOperatorPubkeys();

  if (actionRaw === "submit") {
    const report = isPlainObject(body.report) ? body.report : {};
    const targetType = normalizeReportTargetType(report.targetType);
    if (!targetType) {
      return Response.json({ ok: false, error: "targetType must be stream, user, or message." }, { status: 400 });
    }

    let reporterPubkey = normalizePubkeyHex(report.reporterPubkey);
    if (body.reporterProofEvent) {
      const proof = verifyScopedProof(body.reporterProofEvent, "report_submit", []);
      if (!proof.ok) return Response.json({ ok: false, error: proof.error }, { status: proof.status });
      reporterPubkey = proof.pubkey;
    }

    try {
      const created = createModerationReport({
        reasonCode: normalizeReportReasonCode(report.reasonCode),
        note: sanitizeOptionalText(report.note, 1000),
        reporterPubkey: reporterPubkey ?? undefined,
        targetType,
        targetPubkey: normalizePubkeyHex(report.targetPubkey) ?? undefined,
        targetStreamId: sanitizeOptionalText(report.targetStreamId, 160),
        targetMessageId: sanitizeOptionalText(report.targetMessageId, 160),
        targetMessagePreview: sanitizeOptionalText(report.targetMessagePreview, 280),
        contextPage: sanitizeOptionalText(report.contextPage, 160),
        contextUrl: sanitizeOptionalText(report.contextUrl, 500)
      });
      return Response.json({ ok: true, report: created }, { status: 201 });
    } catch (error: any) {
      return Response.json({ ok: false, error: error?.message ?? "failed to create report" }, { status: 400 });
    }
  }

  if (actionRaw === "list") {
    const proof = verifyScopedProof(body.operatorProofEvent, "moderation_operator", operatorPubkeys);
    if (!proof.ok) return Response.json({ ok: false, error: proof.error }, { status: proof.status });

    const statusRaw = typeof body.status === "string" ? body.status.trim().toLowerCase() : "all";
    const status = statusRaw === "all" ? "all" : normalizeReportStatus(statusRaw);
    if (!status) {
      return Response.json({ ok: false, error: "status must be all|open|reviewing|resolved|dismissed." }, { status: 400 });
    }

    const reports = listModerationReports({
      status,
      limit: parseLimit(body.limit, 200)
    });
    return Response.json({ ok: true, reports });
  }

  if (actionRaw === "update") {
    const proof = verifyScopedProof(body.operatorProofEvent, "moderation_operator", operatorPubkeys);
    if (!proof.ok) return Response.json({ ok: false, error: proof.error }, { status: proof.status });

    const reportId = sanitizeOptionalText(body.reportId, 160);
    if (!reportId) {
      return Response.json({ ok: false, error: "reportId is required." }, { status: 400 });
    }

    const status = body.status ? normalizeReportStatus(body.status) : null;
    if (body.status && !status) {
      return Response.json({ ok: false, error: "status must be open|reviewing|resolved|dismissed." }, { status: 400 });
    }

    try {
      const updated = updateModerationReport(reportId, {
        status: status ?? undefined,
        actionTaken: sanitizeOptionalText(body.actionTaken, 120),
        resolutionNote: sanitizeOptionalText(body.resolutionNote, 500),
        resolverPubkey: proof.pubkey
      });
      return Response.json({ ok: true, report: updated });
    } catch (error: any) {
      return Response.json({ ok: false, error: error?.message ?? "failed to update report" }, { status: 400 });
    }
  }

  return Response.json({ ok: false, error: "unsupported action" }, { status: 400 });
}
