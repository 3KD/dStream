"use client";

import { useEffect, useState } from "react";
import { REPORT_REASON_CODES, type ReportReasonCode } from "@/lib/moderation/reportTypes";
import { ShieldCheck } from "lucide-react";

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
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReasonCode(defaultReason);
    setNote("");
    setSuccess(false);
  }, [defaultReason, open]);

  if (!open) return null;

  const handleSubmit = async () => {
    try {
      await onSubmit({ reasonCode, note });
      setSuccess(true);
    } catch {
      // Error handled by parent / props
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75" onClick={() => !busy && onClose()} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl">
        {success ? (
          <div className="px-5 py-8 text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center mb-2">
               <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-neutral-100">Report Submitted</h3>
            <p className="text-sm text-neutral-400 max-w-sm mx-auto">
              Your report has been securely transmitted. Decentralized moderation operators and the stream owner have been notified. We have hidden this user's message from your view.
            </p>
            <div className="pt-4">
               <button
                 type="button"
                 onClick={onClose}
                 className="px-6 py-2 rounded-xl bg-neutral-800 text-sm font-medium text-white hover:bg-neutral-700"
               >
                 Understood
               </button>
            </div>
          </div>
        ) : (
          <>
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

            <div className="px-5 py-4 border-t border-neutral-800 flex items-center justify-between gap-2">
              <div className="text-[10px] text-neutral-500 max-w-[200px] leading-tight">
                Submission issues cryptographically-signed Nostr events (NIP-56).
              </div>
              <div className="flex items-center gap-2">
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
                  onClick={handleSubmit}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-red-600/90 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-60"
                >
                  {busy ? "Submitting…" : "Submit Report"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
