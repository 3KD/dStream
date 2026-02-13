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
type CohortGroupAggregate = {
  addressIndex: number;
  transferCount: number;
  totalAtomic: string;
  confirmedAtomic: string;
  observedAtMs: number | null;
};
type CohortAggregate = {
  totals: {
    transferCount: number;
    totalAtomic: string;
    confirmedAtomic: string;
  };
  groups: CohortGroupAggregate[];
};

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

function toAtomicBigInt(value: string): bigint {
  if (!/^\d+$/.test(value)) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function addAtomic(a: string, b: string): string {
  return (toAtomicBigInt(a) + toAtomicBigInt(b)).toString();
}

function buildTipCohortAggregate(
  tips: Array<{ amountAtomic: string; observedAtMs: number; confirmed: boolean; addressIndex: number }>
): CohortAggregate {
  const byAddress = new Map<
    number,
    {
      transferCount: number;
      totalAtomic: bigint;
      confirmedAtomic: bigint;
      observedAtMs: number | null;
    }
  >();

  for (const tip of tips) {
    const current =
      byAddress.get(tip.addressIndex) ?? {
        transferCount: 0,
        totalAtomic: 0n,
        confirmedAtomic: 0n,
        observedAtMs: null
      };
    const amount = toAtomicBigInt(tip.amountAtomic);
    current.transferCount += 1;
    current.totalAtomic += amount;
    if (tip.confirmed) current.confirmedAtomic += amount;
    if (!current.observedAtMs || tip.observedAtMs >= current.observedAtMs) {
      current.observedAtMs = tip.observedAtMs;
    }
    byAddress.set(tip.addressIndex, current);
  }

  const groups = Array.from(byAddress.entries())
    .map(([addressIndex, value]) => ({
      addressIndex,
      transferCount: value.transferCount,
      totalAtomic: value.totalAtomic.toString(),
      confirmedAtomic: value.confirmedAtomic.toString(),
      observedAtMs: value.observedAtMs
    }))
    .sort((a, b) => (b.observedAtMs ?? 0) - (a.observedAtMs ?? 0));

  return {
    totals: {
      transferCount: tips.length,
      totalAtomic: sumAtomic(tips.map((t) => t.amountAtomic)),
      confirmedAtomic: sumAtomic(tips.filter((t) => t.confirmed).map((t) => t.amountAtomic))
    },
    groups
  };
}

function buildStakeCohortAggregate(
  stakes: Array<{ confirmedAtomic: string; observedAtMs: number | null; transferCount: number; totalAtomic: string; addressIndex: number }>
): CohortAggregate {
  const groups = stakes
    .map((stake) => ({
      addressIndex: stake.addressIndex,
      transferCount: stake.transferCount,
      totalAtomic: stake.totalAtomic,
      confirmedAtomic: stake.confirmedAtomic,
      observedAtMs: stake.observedAtMs
    }))
    .sort((a, b) => (b.observedAtMs ?? 0) - (a.observedAtMs ?? 0));

  return {
    totals: {
      transferCount: stakes.reduce((acc, stake) => acc + stake.transferCount, 0),
      totalAtomic: sumAtomic(stakes.map((s) => s.totalAtomic)),
      confirmedAtomic: sumAtomic(stakes.map((s) => s.confirmedAtomic))
    },
    groups
  };
}

function mergeCohortAggregates(a: CohortAggregate, b: CohortAggregate): CohortAggregate {
  const merged = new Map<number, CohortGroupAggregate>();
  for (const source of [a.groups, b.groups]) {
    for (const row of source) {
      const current =
        merged.get(row.addressIndex) ??
        {
          addressIndex: row.addressIndex,
          transferCount: 0,
          totalAtomic: "0",
          confirmedAtomic: "0",
          observedAtMs: null
        };
      current.transferCount += row.transferCount;
      current.totalAtomic = addAtomic(current.totalAtomic, row.totalAtomic);
      current.confirmedAtomic = addAtomic(current.confirmedAtomic, row.confirmedAtomic);
      if (!current.observedAtMs || (row.observedAtMs ?? 0) >= current.observedAtMs) {
        current.observedAtMs = row.observedAtMs;
      }
      merged.set(row.addressIndex, current);
    }
  }
  const groups = Array.from(merged.values()).sort((x, y) => (y.observedAtMs ?? 0) - (x.observedAtMs ?? 0));
  return {
    totals: {
      transferCount: a.totals.transferCount + b.totals.transferCount,
      totalAtomic: addAtomic(a.totals.totalAtomic, b.totals.totalAtomic),
      confirmedAtomic: addAtomic(a.totals.confirmedAtomic, b.totals.confirmedAtomic)
    },
    groups
  };
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

  const [analysisAsset, setAnalysisAsset] = useState<"tips" | "stake" | "combined">("combined");
  const [tips, setTips] = useState<Array<{ amountAtomic: string; observedAtMs: number; confirmed: boolean; addressIndex: number }>>([]);
  const [stakes, setStakes] = useState<Array<{ addressIndex: number; totalAtomic: string; confirmedAtomic: string; transferCount: number; observedAtMs: number | null }>>([]);
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
            if (typeof t?.amountAtomic !== "string" || typeof t?.observedAtMs !== "number" || typeof t?.addressIndex !== "number") return null;
            return {
              amountAtomic: t.amountAtomic,
              observedAtMs: t.observedAtMs,
              confirmed: !!t.confirmed,
              addressIndex: t.addressIndex
            };
          })
          .filter(Boolean) as Array<{ amountAtomic: string; observedAtMs: number; confirmed: boolean; addressIndex: number }>
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
            if (
              typeof s?.addressIndex !== "number" ||
              typeof s?.totalAtomic !== "string" ||
              typeof s?.confirmedAtomic !== "string" ||
              typeof s?.transferCount !== "number"
            ) {
              return null;
            }
            return {
              addressIndex: s.addressIndex,
              totalAtomic: s.totalAtomic,
              confirmedAtomic: s.confirmedAtomic,
              transferCount: s.transferCount,
              observedAtMs: typeof s?.observedAtMs === "number" ? s.observedAtMs : null
            };
          })
          .filter(Boolean) as Array<{ addressIndex: number; totalAtomic: string; confirmedAtomic: string; transferCount: number; observedAtMs: number | null }>
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
  const tipCohortAggregate = useMemo(() => buildTipCohortAggregate(tips), [tips]);
  const stakeCohortAggregate = useMemo(() => buildStakeCohortAggregate(stakes), [stakes]);
  const selectedCohortAggregate = useMemo(() => {
    if (analysisAsset === "tips") return tipCohortAggregate;
    if (analysisAsset === "stake") return stakeCohortAggregate;
    return mergeCohortAggregates(tipCohortAggregate, stakeCohortAggregate);
  }, [analysisAsset, stakeCohortAggregate, tipCohortAggregate]);

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

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-neutral-500 uppercase tracking-wider">Cohort Aggregates</div>
                  <div className="text-sm text-neutral-300">Aggregates from each group in this stream cohort.</div>
                </div>
                <label className="text-xs text-neutral-400 space-y-1">
                  <div>Select asset to analyze</div>
                  <select
                    value={analysisAsset}
                    onChange={(e) => setAnalysisAsset(e.target.value === "tips" || e.target.value === "stake" ? e.target.value : "combined")}
                    className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="combined">Combined (tips + stake)</option>
                    <option value="tips">Tips only</option>
                    <option value="stake">Stake only</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                  <div className="text-neutral-500 uppercase tracking-wider">Groups</div>
                  <div className="mt-1 text-sm text-neutral-100 font-semibold">{selectedCohortAggregate.groups.length}</div>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                  <div className="text-neutral-500 uppercase tracking-wider">Transfers</div>
                  <div className="mt-1 text-sm text-neutral-100 font-semibold">{selectedCohortAggregate.totals.transferCount}</div>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                  <div className="text-neutral-500 uppercase tracking-wider">Total</div>
                  <div className="mt-1 text-sm text-neutral-100 font-semibold">{formatXmrAtomic(selectedCohortAggregate.totals.totalAtomic)} XMR</div>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                  <div className="text-neutral-500 uppercase tracking-wider">Confirmed</div>
                  <div className="mt-1 text-sm text-neutral-100 font-semibold">{formatXmrAtomic(selectedCohortAggregate.totals.confirmedAtomic)} XMR</div>
                </div>
              </div>

              {selectedCohortAggregate.groups.length === 0 ? (
                <div className="text-xs text-neutral-500">No cohort group data yet.</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-neutral-800">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-900/80 text-neutral-400">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Group</th>
                        <th className="px-3 py-2 text-left font-medium">Transfers</th>
                        <th className="px-3 py-2 text-left font-medium">Total (XMR)</th>
                        <th className="px-3 py-2 text-left font-medium">Confirmed (XMR)</th>
                        <th className="px-3 py-2 text-left font-medium">Last Activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCohortAggregate.groups.map((group) => (
                        <tr key={group.addressIndex} className="border-t border-neutral-800 text-neutral-200">
                          <td className="px-3 py-2 font-mono">subaddr {group.addressIndex}</td>
                          <td className="px-3 py-2">{group.transferCount}</td>
                          <td className="px-3 py-2">{formatXmrAtomic(group.totalAtomic)}</td>
                          <td className="px-3 py-2">{formatXmrAtomic(group.confirmedAtomic)}</td>
                          <td className="px-3 py-2 text-neutral-400">{group.observedAtMs ? new Date(group.observedAtMs).toLocaleString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

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
