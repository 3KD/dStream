"use client";

import { useEffect, useState } from "react";
import { REPORT_REASON_CODES, type ReportReasonCode } from "@/lib/moderation/reportTypes";

const REASON_LABELS: Record<ReportReasonCode, string> = {
  spam: "Spam / Scam",
  harassment: "Harassment",
  hate: "Hate speech",
  sexual: "Sexual content",
  violence: "Violence / Threats",
  illegal: "Illegal content",
  impersonation: "Impersonation",
  copyright: "Copyright",
  scam: "Fraud / Scam",
  other: "Other"
};

interface ReportDialogProps {
  open: boolean;
  busy?: boolean;
  title: string;
  targetSummary: string;
  defaultReason?: ReportReasonCode;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: { reasonCode: ReportReasonCode; note: string }) => void | Promise<void>;
}

export function ReportDialog({
  open,
  busy = false,
  title,
  targetSummary,
  defaultReason = "other",
  error,
  onClose,
  onSubmit
}: ReportDialogProps) {
  const [reasonCode, setReasonCode] = useState<ReportReasonCode>(defaultReason);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setReasonCode(defaultReason);
    setNote("");
  }, [defaultReason, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75" onClick={() => !busy && onClose()} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl">
        <div className="px-5 py-4 border-b border-neutral-800">
          <div className="text-sm font-semibold text-neutral-100">{title}</div>
          <div className="text-xs text-neutral-500 mt-1 break-words">{targetSummary}</div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <label className="space-y-1 block">
            <div className="text-xs text-neutral-500">Reason</div>
            <select
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value as ReportReasonCode)}
              disabled={busy}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
            >
              {REPORT_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 block">
            <div className="text-xs text-neutral-500">Details (optional)</div>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
              maxLength={1000}
              placeholder="Include any extra context for moderators."
              className="w-full min-h-28 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
            />
          </label>

          {error ? <div className="text-xs text-red-300">{error}</div> : null}
        </div>

        <div className="px-5 py-4 border-t border-neutral-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit({ reasonCode, note })}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {busy ? "Submitting…" : "Submit Report"}
          </button>
        </div>
      </div>
    </div>
  );
}

