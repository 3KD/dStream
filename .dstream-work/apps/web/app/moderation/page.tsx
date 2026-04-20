"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, EyeOff, Shield, ShieldCheck, Trash2, Volume2, VolumeX } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useIdentity } from "@/context/IdentityContext";
import { useDiscoveryModeration } from "@/hooks/useDiscoveryModeration";
import { useStreamModeration } from "@/hooks/useStreamModeration";
import { getNostrRelays } from "@/lib/config";
import { buildSignedScopeProof, listModerationReports, updateModerationReport } from "@/lib/moderation/reportClient";
import { publishEventDetailed } from "@/lib/publish";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";
import { buildDiscoveryModerationEvent } from "@dstream/protocol";
import type { ModerationReport, ReportStatus } from "@/lib/moderation/reportTypes";

const STREAM_ID_STORAGE_KEY = "dstream_moderation_stream_id_v1";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export default function ModerationPage() {
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const discoveryModeration = useDiscoveryModeration();
  const operatorPubkeys = useMemo(() => new Set(discoveryModeration.operatorPubkeys), [discoveryModeration.operatorPubkeys]);
  const isOperator = !!identity?.pubkey && operatorPubkeys.has(identity.pubkey.toLowerCase());
  const [streamPubkey, setStreamPubkey] = useState("");
  const [streamId, setStreamId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [operatorType, setOperatorType] = useState<"pubkey" | "stream">("pubkey");
  const [operatorTargetPubkey, setOperatorTargetPubkey] = useState("");
  const [operatorTargetStreamId, setOperatorTargetStreamId] = useState("");
  const [operatorReason, setOperatorReason] = useState("");
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const [operatorNotice, setOperatorNotice] = useState<string | null>(null);
  const [reportStatusFilter, setReportStatusFilter] = useState<ReportStatus | "all">("open");
  const [reportRows, setReportRows] = useState<ModerationReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportsNotice, setReportsNotice] = useState<string | null>(null);
  const [reportBusyById, setReportBusyById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!identity?.pubkey) return;
    setStreamPubkey(identity.pubkey);
  }, [identity?.pubkey]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STREAM_ID_STORAGE_KEY);
      if (saved) setStreamId(saved);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STREAM_ID_STORAGE_KEY, streamId);
    } catch {
      // ignore
    }
  }, [streamId]);

  const moderation = useStreamModeration({
    streamPubkey: streamPubkey.trim().toLowerCase(),
    streamId: streamId.trim(),
    identityPubkey: identity?.pubkey ?? null,
    signEvent
  });

  const participants = useMemo(() => {
    const set = new Set<string>();
    for (const pubkey of moderation.moderators) set.add(pubkey);
    for (const pubkey of moderation.subscribers) set.add(pubkey);
    for (const pubkey of moderation.remoteMuted) set.add(pubkey);
    for (const pubkey of moderation.remoteBlocked) set.add(pubkey);
    for (const pubkey of Object.keys(moderation.effectiveActionsByTarget)) set.add(pubkey);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [
    moderation.effectiveActionsByTarget,
    moderation.moderators,
    moderation.remoteBlocked,
    moderation.remoteMuted,
    moderation.subscribers
  ]);

  const hiddenPubkeys = useMemo(() => discoveryModeration.hiddenPubkeys, [discoveryModeration.hiddenPubkeys]);
  const hiddenStreams = useMemo(() => discoveryModeration.hiddenStreams, [discoveryModeration.hiddenStreams]);

  const publishDiscoveryAction = async (
    action: "hide" | "show",
    target: { targetPubkey: string; targetStreamId?: string; targetType: "pubkey" | "stream" },
    reasonOverride?: string
  ) => {
    if (!identity || !isOperator) return;
    setOperatorBusy(true);
    setOperatorError(null);
    setOperatorNotice(null);

    try {
      const unsigned = buildDiscoveryModerationEvent({
        pubkey: identity.pubkey,
        createdAt: nowSec(),
        action,
        targetType: target.targetType,
        targetPubkey: target.targetPubkey,
        targetStreamId: target.targetType === "stream" ? target.targetStreamId : undefined,
        reason: reasonOverride?.trim() || operatorReason.trim() || undefined
      });
      const signed = await signEvent(unsigned as any);
      const report = await publishEventDetailed(relays, signed as any);
      if (!report.ok) throw new Error("No relays acknowledged discovery moderation update.");
      setOperatorNotice(
        `${action === "hide" ? "Hidden from official discovery." : "Restored to official discovery."} (${report.okRelays.length}/${relays.length})`
      );
      if (action === "hide") {
        setOperatorTargetPubkey("");
        setOperatorTargetStreamId("");
      }
    } catch (err: any) {
      setOperatorError(err?.message ?? "Failed to publish discovery moderation update.");
    } finally {
      setOperatorBusy(false);
    }
  };

  const setReportBusy = (reportId: string, busy: boolean) => {
    setReportBusyById((prev) => ({ ...prev, [reportId]: busy }));
  };

  const loadReportRows = useCallback(async () => {
    if (!identity || !isOperator) return;
    setReportsLoading(true);
    setReportsError(null);
    try {
      const proof = await buildSignedScopeProof(signEvent as any, identity.pubkey, "moderation_operator");
      if (!proof) throw new Error("Failed to sign moderation operator proof.");
      const rows = await listModerationReports({
        operatorProofEvent: proof as any,
        status: reportStatusFilter,
        limit: 300
      });
      setReportRows(rows);
    } catch (error: any) {
      setReportsError(error?.message ?? "Failed to load moderation reports.");
    } finally {
      setReportsLoading(false);
    }
  }, [identity, isOperator, reportStatusFilter, signEvent]);

  useEffect(() => {
    if (!isOperator || !identity) {
      setReportRows([]);
      return;
    }
    void loadReportRows();
  }, [identity, isOperator, loadReportRows]);

  const setReportStatus = async (report: ModerationReport, status: ReportStatus, actionTaken?: string, resolutionNote?: string) => {
    if (!identity || !isOperator) return;
    setReportsError(null);
    setReportsNotice(null);
    setReportBusy(report.id, true);
    try {
      const proof = await buildSignedScopeProof(signEvent as any, identity.pubkey, "moderation_operator");
      if (!proof) throw new Error("Failed to sign moderation operator proof.");
      await updateModerationReport({
        operatorProofEvent: proof as any,
        reportId: report.id,
        status,
        actionTaken,
        resolutionNote
      });
      setReportsNotice(`Report ${report.id.slice(0, 8)} updated (${status}).`);
      await loadReportRows();
    } catch (error: any) {
      setReportsError(error?.message ?? "Failed to update report.");
    } finally {
      setReportBusy(report.id, false);
    }
  };

  const hideReportTargetFromDiscovery = async (report: ModerationReport) => {
    if (!identity || !isOperator) return;
    if (!report.targetPubkey) {
      setReportsError("Report target is missing a pubkey; cannot hide from discovery.");
      return;
    }

    const target =
      report.targetType === "stream" && report.targetStreamId
        ? { targetType: "stream" as const, targetPubkey: report.targetPubkey, targetStreamId: report.targetStreamId }
        : { targetType: "pubkey" as const, targetPubkey: report.targetPubkey };

    setReportBusy(report.id, true);
    setReportsError(null);
    setReportsNotice(null);
    try {
      await publishDiscoveryAction("hide", target, report.note ?? undefined);
      const actionTaken = target.targetType === "stream" ? "hide_stream_official_discovery" : "hide_pubkey_official_discovery";
      const proof = await buildSignedScopeProof(signEvent as any, identity.pubkey, "moderation_operator");
      if (!proof) throw new Error("Failed to sign moderation operator proof.");
      await updateModerationReport({
        operatorProofEvent: proof as any,
        reportId: report.id,
        status: "resolved",
        actionTaken,
        resolutionNote: "Hidden from official discovery surfaces."
      });
      setReportsNotice("Report resolved and hidden from official discovery.");
      await loadReportRows();
    } catch (error: any) {
      setReportsError(error?.message ?? "Failed to apply discovery hide action.");
    } finally {
      setReportBusy(report.id, false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Moderation</h1>
            <p className="text-sm text-neutral-400">Manage relay-backed stream moderation actions and role assignments.</p>
          </div>
          <Link className="text-sm text-neutral-300 hover:text-white" href="/broadcast">
            Broadcast
          </Link>
        </header>

        {!identity ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300">
            Connect an identity to manage moderation.
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200">Stream Scope</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">Stream Pubkey</div>
                  <input
                    value={streamPubkey}
                    onChange={(e) => setStreamPubkey(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                    placeholder="64-hex pubkey"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">Stream ID</div>
                  <input
                    value={streamId}
                    onChange={(e) => setStreamId(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                    placeholder="live-20260210-2200"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-neutral-400">
                <span>Owner: {moderation.isOwner ? "yes" : "no"}</span>
                <span>Can moderate: {moderation.canModerate ? "yes" : "no"}</span>
                <span>Moderators: {moderation.moderators.size}</span>
                <span>Subscribers: {moderation.subscribers.size}</span>
                <span>Blocked: {moderation.remoteBlocked.size}</span>
                <span>Muted: {moderation.remoteMuted.size}</span>
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200">Participants</h2>
              {participants.length === 0 ? (
                <div className="text-sm text-neutral-500">No moderation records in scope yet.</div>
              ) : (
                <div className="space-y-2">
                  {participants.map((pubkey) => {
                    const npub = pubkeyHexToNpub(pubkey);
                    const label = shortenText(npub ?? pubkey, { head: 18, tail: 10 });
                    const isModerator = moderation.moderators.has(pubkey);
                    const isSubscriber = moderation.subscribers.has(pubkey);
                    const isMuted = moderation.remoteMuted.has(pubkey);
                    const isBlocked = moderation.remoteBlocked.has(pubkey);
                    return (
                      <div key={pubkey} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-200 font-mono truncate">{label}</div>
                          <div className="text-xs text-neutral-500 font-mono truncate">{pubkey}</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {isModerator && (
                              <span
                                className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-950/60 border border-blue-700/40 text-blue-200"
                                title="Admin"
                                aria-label="Admin"
                              >
                                <ShieldCheck className="w-3 h-3" />
                              </span>
                            )}
                            {isSubscriber && <span className="text-[10px] bg-amber-950/50 border border-amber-700/30 text-amber-200 px-1.5 py-0.5 rounded">SUB</span>}
                            {isBlocked && <span className="text-[10px] bg-red-950/50 border border-red-700/30 text-red-200 px-1.5 py-0.5 rounded">BLOCKED</span>}
                            {isMuted && <span className="text-[10px] bg-neutral-950/50 border border-neutral-700/30 text-neutral-200 px-1.5 py-0.5 rounded">MUTED</span>}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {moderation.canModerate && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  void moderation.publishModerationAction(pubkey, isMuted ? "clear" : "mute").then((ok) => {
                                    setNotice(ok ? "Moderation action published." : "Failed to publish moderation action.");
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs inline-flex items-center gap-1.5"
                              >
                                {isMuted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                                {isMuted ? "Clear Mute" : "Mute"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void moderation.publishModerationAction(pubkey, isBlocked ? "clear" : "block").then((ok) => {
                                    setNotice(ok ? "Moderation action published." : "Failed to publish moderation action.");
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs inline-flex items-center gap-1.5"
                              >
                                {isBlocked ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                                {isBlocked ? "Clear Block" : "Block"}
                              </button>
                            </>
                          )}

                          {moderation.isOwner && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = isModerator ? "none" : "moderator";
                                  void moderation.publishModeratorRole(pubkey, next).then((ok) => {
                                    setNotice(ok ? "Role update published." : "Failed to publish role update.");
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs inline-flex items-center gap-1.5"
                              >
                                {isModerator ? <ShieldCheck className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                                {isModerator ? "Unset Mod" : "Set Mod"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = isSubscriber ? "none" : "subscriber";
                                  void moderation.publishModeratorRole(pubkey, next).then((ok) => {
                                    setNotice(ok ? "Role update published." : "Failed to publish role update.");
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                              >
                                {isSubscriber ? "Unset Sub" : "Set Sub"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200 inline-flex items-center gap-2">
                <EyeOff className="w-4 h-4" />
                Official Discovery Moderation
              </h2>
              <p className="text-xs text-neutral-500">
                This controls only dStream official discovery surfaces (home/browse/search). It does not delete or censor decentralized network content.
              </p>

              {discoveryModeration.operatorPubkeys.length === 0 ? (
                <div className="text-sm text-amber-200 bg-amber-950/20 border border-amber-900/40 rounded-xl px-3 py-2">
                  No operators configured. Set <span className="font-mono">NEXT_PUBLIC_DISCOVERY_OPERATOR_PUBKEYS</span> to enable operator moderation.
                </div>
              ) : !isOperator ? (
                <div className="text-sm text-neutral-400">
                  Connected pubkey is not in operator allowlist. Streamer-level moderation still works; operator discovery controls are restricted.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
                    <label className="space-y-1">
                      <div className="text-xs text-neutral-500">Target type</div>
                      <select
                        value={operatorType}
                        onChange={(e) => setOperatorType(e.target.value === "stream" ? "stream" : "pubkey")}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                        disabled={operatorBusy}
                      >
                        <option value="pubkey">Creator pubkey</option>
                        <option value="stream">Specific stream</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs text-neutral-500">Target pubkey</div>
                      <input
                        value={operatorTargetPubkey}
                        onChange={(e) => setOperatorTargetPubkey(e.target.value)}
                        placeholder="npub… or 64-hex"
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                        disabled={operatorBusy}
                      />
                    </label>
                  </div>

                  {operatorType === "stream" && (
                    <label className="space-y-1 block">
                      <div className="text-xs text-neutral-500">Target stream ID</div>
                      <input
                        value={operatorTargetStreamId}
                        onChange={(e) => setOperatorTargetStreamId(e.target.value)}
                        placeholder="live-20260216-0001"
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                        disabled={operatorBusy}
                      />
                    </label>
                  )}

                  <label className="space-y-1 block">
                    <div className="text-xs text-neutral-500">Reason (optional)</div>
                    <input
                      value={operatorReason}
                      onChange={(e) => setOperatorReason(e.target.value)}
                      placeholder="policy violation / abuse report"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                      disabled={operatorBusy}
                    />
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={operatorBusy}
                      onClick={() => {
                        setOperatorError(null);
                        const targetPubkey = pubkeyParamToHex(operatorTargetPubkey);
                        if (!targetPubkey) {
                          setOperatorError("Target pubkey must be npub… or 64-hex.");
                          return;
                        }
                        if (operatorType === "stream") {
                          const targetStreamId = operatorTargetStreamId.trim();
                          if (!targetStreamId) {
                            setOperatorError("Target stream ID is required for stream-level hide.");
                            return;
                          }
                          void publishDiscoveryAction("hide", { targetType: "stream", targetPubkey, targetStreamId });
                          return;
                        }
                        void publishDiscoveryAction("hide", { targetType: "pubkey", targetPubkey });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/40 border border-red-900/40 text-xs text-red-200 disabled:opacity-50"
                    >
                      Hide from official discovery
                    </button>
                  </div>
                </>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-xs text-neutral-500">Hidden creators</div>
                  {hiddenPubkeys.length === 0 ? (
                    <div className="text-sm text-neutral-500">None.</div>
                  ) : (
                    <div className="space-y-2">
                      {hiddenPubkeys.map((pubkey) => (
                        <div key={`pubkey:${pubkey}`} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                          <div className="text-xs font-mono text-neutral-300 truncate">{pubkeyHexToNpub(pubkey) ?? pubkey}</div>
                          {isOperator && (
                            <button
                              type="button"
                              disabled={operatorBusy}
                              onClick={() => void publishDiscoveryAction("show", { targetType: "pubkey", targetPubkey: pubkey })}
                              className="px-2 py-1 rounded-md border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-[11px]"
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-neutral-500">Hidden streams</div>
                  {hiddenStreams.length === 0 ? (
                    <div className="text-sm text-neutral-500">None.</div>
                  ) : (
                    <div className="space-y-2">
                      {hiddenStreams.map((stream) => (
                        <div
                          key={`stream:${stream.streamPubkey}:${stream.streamId}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2"
                        >
                          <div className="text-xs font-mono text-neutral-300 truncate">{stream.streamPubkey}:{stream.streamId}</div>
                          {isOperator && (
                            <button
                              type="button"
                              disabled={operatorBusy}
                              onClick={() =>
                                void publishDiscoveryAction("show", {
                                  targetType: "stream",
                                  targetPubkey: stream.streamPubkey,
                                  targetStreamId: stream.streamId
                                })
                              }
                              className="px-2 py-1 rounded-md border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-[11px]"
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {operatorError && <div className="text-xs text-red-300">{operatorError}</div>}
              {operatorNotice && <div className="text-xs text-emerald-300">{operatorNotice}</div>}
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-neutral-200">Report Inbox</h2>
                <div className="flex items-center gap-2">
                  <select
                    value={reportStatusFilter}
                    onChange={(event) =>
                      setReportStatusFilter((event.target.value as ReportStatus | "all") ?? "open")
                    }
                    className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-xs"
                    disabled={!isOperator || reportsLoading}
                  >
                    <option value="open">Open</option>
                    <option value="reviewing">Reviewing</option>
                    <option value="resolved">Resolved</option>
                    <option value="dismissed">Dismissed</option>
                    <option value="all">All</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void loadReportRows()}
                    disabled={!isOperator || reportsLoading}
                    className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs disabled:opacity-50"
                  >
                    {reportsLoading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              </div>

              {!isOperator ? (
                <div className="text-sm text-neutral-500">Operator role is required to access the report inbox.</div>
              ) : reportsLoading && reportRows.length === 0 ? (
                <div className="text-sm text-neutral-500">Loading moderation reports…</div>
              ) : reportRows.length === 0 ? (
                <div className="text-sm text-neutral-500">No reports in this queue.</div>
              ) : (
                <div className="space-y-2">
                  {reportRows.map((report) => {
                    const busy = !!reportBusyById[report.id];
                    const targetLabel =
                      report.targetType === "stream"
                        ? `${report.targetPubkey ?? "?"}:${report.targetStreamId ?? "?"}`
                        : report.targetType === "message"
                          ? `${report.targetPubkey ?? "?"} · msg ${shortenText(report.targetMessageId ?? "unknown", { head: 10, tail: 8 })}`
                          : report.targetPubkey ?? "unknown";
                    return (
                      <article
                        key={report.id}
                        className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1 min-w-0">
                            <div className="text-xs text-neutral-500 font-mono">
                              {new Date(report.createdAtSec * 1000).toLocaleString()} · {report.id}
                            </div>
                            <div className="text-sm text-neutral-200">
                              <span className="uppercase text-[10px] text-neutral-500 mr-2">{report.targetType}</span>
                              <span className="font-mono break-all">{targetLabel}</span>
                            </div>
                            <div className="text-xs text-neutral-400">
                              Reason: <span className="text-neutral-200">{report.reasonCode}</span>
                            </div>
                            {report.note ? <div className="text-xs text-neutral-400 break-words">{report.note}</div> : null}
                          </div>
                          <span className="text-[10px] uppercase tracking-wider rounded-full border border-neutral-700 px-2 py-0.5 text-neutral-300">
                            {report.status}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setReportStatus(report, "reviewing")}
                            className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-[11px] disabled:opacity-50"
                          >
                            Mark Reviewing
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setReportStatus(report, "dismissed", "dismissed_no_action")}
                            className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-[11px] disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setReportStatus(report, "resolved", "resolved_manual_review")}
                            className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-[11px] disabled:opacity-50"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            disabled={busy || !report.targetPubkey}
                            onClick={() => void hideReportTargetFromDiscovery(report)}
                            className="px-2.5 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/40 border border-red-900/40 text-[11px] text-red-200 disabled:opacity-50"
                          >
                            Hide on Official Discovery
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {reportsError && <div className="text-xs text-red-300">{reportsError}</div>}
              {reportsNotice && <div className="text-xs text-emerald-300">{reportsNotice}</div>}
            </section>

            {notice && <div className="text-xs text-neutral-300">{notice}</div>}
          </>
        )}
      </main>
    </div>
  );
}
