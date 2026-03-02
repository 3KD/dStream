"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Radio, Users } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { MoneroLogo } from "@/components/icons/MoneroLogo";
import { useIdentity } from "@/context/IdentityContext";
import { useStreamAnnounce } from "@/hooks/useStreamAnnounce";
import { useStreamPresence } from "@/hooks/useStreamPresence";

type StoredBroadcastSession = { pubkey: string; streamId: string; originStreamId: string; startedAt: number };
type MetricSample = { atMs: number; value: number };

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function base64EncodeUtf8(input: string): string {
  try {
    return btoa(unescape(encodeURIComponent(input)));
  } catch {
    return btoa(input);
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function toXmrNumber(amountAtomic: string): number {
  if (!/^\d+$/.test(amountAtomic)) return 0;
  try {
    const value = BigInt(amountAtomic);
    const whole = Number(value / 1_000_000_000_000n);
    const frac = Number(value % 1_000_000_000_000n) / 1_000_000_000_000;
    return whole + frac;
  } catch {
    return 0;
  }
}

function formatXmrAtomic(amountAtomic: string): string {
  try {
    const v = BigInt(amountAtomic);
    const denom = 1_000_000_000_000n;
    const whole = v / denom;
    const frac = v % denom;
    return `${whole.toString()}.${frac.toString().padStart(12, "0")}`;
  } catch {
    return amountAtomic;
  }
}

function useStoredSession(): StoredBroadcastSession | null {
  const { identity } = useIdentity();
  const [session, setSession] = useState<StoredBroadcastSession | null>(null);

  useEffect(() => {
    const parsed = readJson<StoredBroadcastSession>("dstream_broadcast_session_v1");
    if (!parsed) {
      setSession(null);
      return;
    }
    if (!identity || parsed.pubkey !== identity.pubkey) {
      setSession(null);
      return;
    }
    setSession(parsed);
  }, [identity]);

  return session;
}

function pushSample(prev: MetricSample[], value: number): MetricSample[] {
  const next = [...prev, { atMs: Date.now(), value }];
  return next.slice(-24);
}

function sumAtomic(values: string[]): string {
  let total = 0n;
  for (const value of values) {
    if (!/^\d+$/.test(value)) continue;
    try {
      total += BigInt(value);
    } catch {
      // ignore malformed amount
    }
  }
  return total.toString();
}

function MiniBars(props: { samples: MetricSample[]; valueFormatter: (n: number) => string }) {
  const { samples, valueFormatter } = props;
  if (samples.length === 0) {
    return <div className="text-xs text-neutral-500">No samples collected yet for this stream.</div>;
  }
  const max = samples.reduce((best, s) => Math.max(best, s.value), 0);
  return (
    <div className="space-y-2">
      <div className="h-24 flex items-end gap-1">
        {samples.map((s, idx) => {
          const ratio = max > 0 ? s.value / max : 0;
          const height = Math.max(4, Math.round(90 * ratio));
          return <div key={`${s.atMs}:${idx}`} className="flex-1 rounded-sm bg-blue-500/70" style={{ height }} title={`${new Date(s.atMs).toLocaleTimeString()} · ${valueFormatter(s.value)}`} />;
        })}
      </div>
      <div className="flex justify-between text-[11px] text-neutral-500">
        <span>{new Date(samples[0]!.atMs).toLocaleTimeString()}</span>
        <span>{new Date(samples[samples.length - 1]!.atMs).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { identity, signEvent } = useIdentity();
  const storedSession = useStoredSession();

  const [streamId, setStreamId] = useState("");
  useEffect(() => {
    if (storedSession?.streamId) {
      setStreamId(storedSession.streamId);
      return;
    }
    const draft = readJson<any>("dstream_broadcast_draft_v1");
    if (typeof draft?.streamId === "string") setStreamId(draft.streamId);
  }, [storedSession?.streamId]);

  const trimmedStreamId = streamId.trim();
  const { announce } = useStreamAnnounce(identity?.pubkey ?? "", trimmedStreamId);
  const { viewerCount } = useStreamPresence({
    streamPubkey: identity?.pubkey ?? "",
    streamId: trimmedStreamId
  });

  const [xmrRpcAvailable, setXmrRpcAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!identity || !trimmedStreamId) {
      setXmrRpcAvailable(false);
      return;
    }
    void (async () => {
      try {
        const res = await fetch("/api/xmr/health", { cache: "no-store" });
        if (cancelled) return;
        setXmrRpcAvailable(res.ok);
      } catch {
        if (cancelled) return;
        setXmrRpcAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity, trimmedStreamId]);

  const makeNip98AuthHeader = useCallback(
    async (opts: { url: string; method: "POST" }) => {
      if (!identity) throw new Error("Connect identity first.");
      const unsigned: any = {
        kind: 27235,
        created_at: nowSec(),
        content: "",
        tags: [
          ["u", opts.url],
          ["method", opts.method]
        ],
        pubkey: identity.pubkey
      };
      const signed = await signEvent(unsigned);
      return `Nostr ${base64EncodeUtf8(JSON.stringify(signed))}`;
    },
    [identity, signEvent]
  );

  const [tips, setTips] = useState<Array<{ amountAtomic: string; observedAtMs: number; confirmed: boolean }>>([]);
  const [stakes, setStakes] = useState<Array<{ confirmedAtomic: string; observedAtMs: number | null }>>([]);
  const [dataError, setDataError] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    if (!identity || !trimmedStreamId || !xmrRpcAvailable) return;
    setDataError(null);
    try {
      const tipUrl = `${window.location.origin}/api/xmr/tip/list`;
      const tipAuth = await makeNip98AuthHeader({ url: tipUrl, method: "POST" });
      const tipRes = await fetch("/api/xmr/tip/list", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: tipAuth },
        body: JSON.stringify({ streamPubkey: identity.pubkey, streamId: trimmedStreamId })
      });
      if (!tipRes.ok) throw new Error(await tipRes.text());
      const tipData = (await tipRes.json().catch(() => null)) as any;
      const tipList = Array.isArray(tipData?.tips) ? tipData.tips : [];
      setTips(
        tipList
          .map((t: any) => {
            if (typeof t?.amountAtomic !== "string" || typeof t?.observedAtMs !== "number") return null;
            return {
              amountAtomic: t.amountAtomic,
              observedAtMs: t.observedAtMs,
              confirmed: !!t.confirmed
            };
          })
          .filter(Boolean) as Array<{ amountAtomic: string; observedAtMs: number; confirmed: boolean }>
      );

      const stakeUrl = `${window.location.origin}/api/xmr/stake/list`;
      const stakeAuth = await makeNip98AuthHeader({ url: stakeUrl, method: "POST" });
      const stakeRes = await fetch("/api/xmr/stake/list", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: stakeAuth },
        body: JSON.stringify({ streamPubkey: identity.pubkey, streamId: trimmedStreamId })
      });
      if (!stakeRes.ok) throw new Error(await stakeRes.text());
      const stakeData = (await stakeRes.json().catch(() => null)) as any;
      const stakeList = Array.isArray(stakeData?.stakes) ? stakeData.stakes : [];
      setStakes(
        stakeList
          .map((s: any) => {
            if (typeof s?.confirmedAtomic !== "string") return null;
            return {
              confirmedAtomic: s.confirmedAtomic,
              observedAtMs: typeof s?.observedAtMs === "number" ? s.observedAtMs : null
            };
          })
          .filter(Boolean) as Array<{ confirmedAtomic: string; observedAtMs: number | null }>
      );
    } catch (err: any) {
      setDataError(err?.message ?? "Failed to load analytics data.");
    }
  }, [identity, makeNip98AuthHeader, trimmedStreamId, xmrRpcAvailable]);

  useEffect(() => {
    if (!identity || !trimmedStreamId || !xmrRpcAvailable) return;
    void refreshData();
    const interval = setInterval(() => void refreshData(), 15000);
    return () => clearInterval(interval);
  }, [identity, refreshData, trimmedStreamId, xmrRpcAvailable]);

  const totalTipsAtomic = useMemo(() => sumAtomic(tips.map((t) => t.amountAtomic)), [tips]);
  const totalStakeConfirmedAtomic = useMemo(() => sumAtomic(stakes.map((s) => s.confirmedAtomic)), [stakes]);
  const tipsCount = tips.length;

  const [viewerSamples, setViewerSamples] = useState<MetricSample[]>([]);
  const [tipSamples, setTipSamples] = useState<MetricSample[]>([]);
  const [stakeSamples, setStakeSamples] = useState<MetricSample[]>([]);

  useEffect(() => {
    if (!identity || !trimmedStreamId) return;
    setViewerSamples((prev) => pushSample(prev, viewerCount));
  }, [identity, trimmedStreamId, viewerCount]);

  useEffect(() => {
    if (!identity || !trimmedStreamId) return;
    setTipSamples((prev) => pushSample(prev, toXmrNumber(totalTipsAtomic)));
  }, [identity, totalTipsAtomic, trimmedStreamId]);

  useEffect(() => {
    if (!identity || !trimmedStreamId) return;
    setStakeSamples((prev) => pushSample(prev, toXmrNumber(totalStakeConfirmedAtomic)));
  }, [identity, totalStakeConfirmedAtomic, trimmedStreamId]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-blue-500" />
              Analytics
            </h1>
            <p className="text-sm text-neutral-400">Live telemetry from presence and Monero verification routes.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard" className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 inline-flex items-center gap-2">
              <Radio className="w-4 h-4" />
              Dashboard
            </Link>
            <Link href="/broadcast" className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800">
              Broadcast
            </Link>
          </div>
        </header>

        {!identity ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-300">
            Connect an identity to view stream analytics.
          </div>
        ) : !trimmedStreamId ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-300">
            Start or select a stream in the dashboard to load analytics.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                <div className="text-xs text-neutral-500 uppercase tracking-wider">Status</div>
                <div className="mt-2 text-lg font-semibold">{announce?.status === "live" ? "Live" : "Idle/Ended"}</div>
                <div className="text-xs text-neutral-500 font-mono">{trimmedStreamId}</div>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                <div className="text-xs text-neutral-500 uppercase tracking-wider">Viewers</div>
                <div className="mt-2 text-lg font-semibold inline-flex items-center gap-2">
                  <Users className="w-4 h-4 text-neutral-400" />≈ {viewerCount}
                </div>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                <div className="text-xs text-neutral-500 uppercase tracking-wider">Verified Tips</div>
                <div className="mt-2 text-lg font-semibold inline-flex items-center gap-2">
                  <MoneroLogo className="w-4 h-4 text-orange-400" />
                  {formatXmrAtomic(totalTipsAtomic)} XMR
                </div>
                <div className="text-xs text-neutral-500">{tipsCount} transfer(s)</div>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                <div className="text-xs text-neutral-500 uppercase tracking-wider">Confirmed Stake</div>
                <div className="mt-2 text-lg font-semibold inline-flex items-center gap-2">
                  <MoneroLogo className="w-4 h-4 text-orange-400" />
                  {formatXmrAtomic(totalStakeConfirmedAtomic)} XMR
                </div>
                <div className="text-xs text-neutral-500">{stakes.length} stake address(es)</div>
              </div>
            </div>

            {dataError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                {dataError}
              </div>
            )}

            {!xmrRpcAvailable && (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-xs text-neutral-400">
                Monero wallet RPC is not configured, so tip/stake analytics are unavailable.
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                <div className="text-xs text-neutral-500 uppercase tracking-wider">Viewer Samples</div>
                <MiniBars samples={viewerSamples} valueFormatter={(v) => `${Math.round(v)}`} />
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                <div className="text-xs text-neutral-500 uppercase tracking-wider">Tips (XMR)</div>
                <MiniBars samples={tipSamples} valueFormatter={(v) => v.toFixed(6)} />
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                <div className="text-xs text-neutral-500 uppercase tracking-wider">Stake Confirmed (XMR)</div>
                <MiniBars samples={stakeSamples} valueFormatter={(v) => v.toFixed(6)} />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

