"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ServerCog, XCircle } from "lucide-react";

type RailReadinessStatus = "ready" | "fallback" | "missing" | "error";

interface RailReadiness {
  railId: string;
  label: string;
  assets: string[];
  status: RailReadinessStatus;
  operatorMode: string;
  summary: string;
  requiredEnv: string[];
  configuredEnv: string[];
  missingEnv: string[];
  details?: Record<string, string | number | boolean>;
}

interface ReadinessResponse {
  ok: true;
  checkedAtMs: number;
  rails: RailReadiness[];
  summary: Record<RailReadinessStatus, number>;
}

function statusLabel(status: RailReadinessStatus): string {
  if (status === "ready") return "Ready";
  if (status === "fallback") return "Fallback";
  if (status === "missing") return "Missing";
  return "Error";
}

function statusClass(status: RailReadinessStatus): string {
  if (status === "ready") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "fallback") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "missing") return "border-red-500/30 bg-red-500/10 text-red-200";
  return "border-red-500/40 bg-red-500/15 text-red-100";
}

function statusIcon(status: RailReadinessStatus) {
  if (status === "ready") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "fallback") return <AlertTriangle className="h-4 w-4" />;
  if (status === "missing") return <XCircle className="h-4 w-4" />;
  return <AlertTriangle className="h-4 w-4" />;
}

export function PaymentOperatorReadinessPanel() {
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/payment-operator/readiness", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ReadinessResponse | { error?: string } | null;
      if (!response.ok || !body || !("ok" in body)) throw new Error((body as { error?: string } | null)?.error || `Readiness failed (${response.status})`);
      setData(body);
      setStatus("idle");
    } catch (err: any) {
      setError(err?.message ?? "Failed to load payment operator readiness.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totals = useMemo(() => {
    if (!data) return { ready: 0, fallback: 0, missing: 0, error: 0 };
    return data.summary;
  }, [data]);

  return (
    <section id="payment-operator-readiness" className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4 scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-200 inline-flex items-center gap-2">
            <ServerCog className="h-4 w-4" />
            Payment Operator Readiness
          </h2>
          <div className="mt-1 text-xs text-neutral-500">
            {data?.checkedAtMs ? `Checked ${new Date(data.checkedAtMs).toLocaleTimeString()}` : "Checking payment rail configuration"}
          </div>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={status === "loading"}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${status === "loading" ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(["ready", "fallback", "missing", "error"] as RailReadinessStatus[]).map((key) => (
          <div key={key} className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wider text-neutral-500">{statusLabel(key)}</div>
            <div className="mt-1 font-mono text-lg text-neutral-100">{totals[key]}</div>
          </div>
        ))}
      </div>

      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div> : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {(data?.rails ?? []).map((rail) => (
          <article key={rail.railId} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-neutral-100">{rail.label}</h3>
                  <span className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[11px] uppercase tracking-wider text-neutral-400">
                    {rail.assets.join(", ")}
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">{rail.operatorMode}</div>
              </div>
              <div className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${statusClass(rail.status)}`}>
                {statusIcon(rail.status)}
                {statusLabel(rail.status)}
              </div>
            </div>

            <div className="text-xs text-neutral-400">{rail.summary}</div>

            {rail.requiredEnv.length ? (
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-neutral-500">Config</div>
                <div className="flex flex-wrap gap-1.5">
                  {rail.requiredEnv.map((name) => {
                    const isConfigured = rail.configuredEnv.includes(name);
                    return (
                      <span
                        key={name}
                        className={`rounded-md border px-2 py-1 font-mono text-[11px] ${
                          isConfigured
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                            : "border-neutral-800 bg-neutral-900 text-neutral-400"
                        }`}
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {rail.details && Object.keys(rail.details).length ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(rail.details).map(([key, value]) => (
                  <div key={key} className="rounded-lg border border-neutral-800 bg-neutral-900/70 px-2 py-1.5">
                    <div className="text-[11px] text-neutral-500">{key}</div>
                    <div className="font-mono text-neutral-200">{String(value)}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
