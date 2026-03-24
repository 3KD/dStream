"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ShieldAlert } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import {
  buildAccessAdminProof,
  listAccessAuditClient,
  listAccessDenyRulesClient,
  upsertAccessDenyRuleClient
} from "@/lib/access/client";
import { ACCESS_ACTIONS, type AccessAction, type AccessAuditRecord, type AccessDenyRule } from "@/lib/access/types";

function formatPubkey(pubkey: string): string {
  const npub = pubkeyHexToNpub(pubkey);
  return shortenText(npub ?? pubkey, { head: 18, tail: 8 });
}

function formatEpoch(value: number | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value * 1000).toLocaleString();
  } catch {
    return String(value);
  }
}

function normalizePubkeyInput(raw: string): string | null {
  return pubkeyParamToHex(raw);
}

function parsePositiveInt(raw: string): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  if (value <= 0) return undefined;
  return Math.trunc(value);
}

function actionLabel(action: AccessAction): string {
  switch (action) {
    case "watch_live":
      return "Watch live";
    case "watch_vod":
      return "Watch VOD";
    case "chat_send":
      return "Chat";
    case "p2p_assist":
      return "P2P assist";
    case "rebroadcast":
      return "Rebroadcast";
    default:
      return action;
  }
}

function auditReasonClass(reasonCode: string): string {
  if (reasonCode.startsWith("allow_")) return "text-emerald-300";
  if (reasonCode.startsWith("deny_")) return "text-red-300";
  return "text-neutral-300";
}

export function AccessDenyAuditPanel() {
  const { identity, signEvent } = useIdentity();

  const [hostInput, setHostInput] = useState("");
  const [subjectFilterInput, setSubjectFilterInput] = useState("");
  const [resourceFilterInput, setResourceFilterInput] = useState("");
  const [limitInput, setLimitInput] = useState("200");

  const [subjectDenyInput, setSubjectDenyInput] = useState("");
  const [resourceDenyInput, setResourceDenyInput] = useState("");
  const [denyReasonInput, setDenyReasonInput] = useState("");
  const [denyExpiresHoursInput, setDenyExpiresHoursInput] = useState("");
  const [denyActions, setDenyActions] = useState<AccessAction[]>(["watch_live", "watch_vod", "chat_send"]);

  const [denyRules, setDenyRules] = useState<AccessDenyRule[]>([]);
  const [auditRows, setAuditRows] = useState<AccessAuditRecord[]>([]);
  const [isLoadingDenies, setIsLoadingDenies] = useState(false);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [isSavingDeny, setIsSavingDeny] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!identity?.pubkey) return;
    setHostInput((prev) => (prev.trim() ? prev : identity.pubkey));
  }, [identity?.pubkey]);

  const normalizedHostPubkey = useMemo(() => normalizePubkeyInput(hostInput), [hostInput]);

  const buildProof = useCallback(
    async (hostPubkey: string) => {
      if (!identity?.pubkey) throw new Error("Connect an identity to sign access admin proof events.");
      const proof = await buildAccessAdminProof(signEvent, identity.pubkey, hostPubkey);
      if (!proof) throw new Error("Failed to sign access admin proof event.");
      return proof;
    },
    [identity?.pubkey, signEvent]
  );

  const loadDenyRules = useCallback(async () => {
    setError(null);
    setNotice(null);
    const hostPubkey = normalizePubkeyInput(hostInput);
    if (!hostPubkey) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const subjectPubkey = subjectFilterInput.trim() ? normalizePubkeyInput(subjectFilterInput) : null;
    if (subjectFilterInput.trim() && !subjectPubkey) {
      setError("Subject filter must be a valid npub or 64-hex pubkey.");
      return;
    }

    setIsLoadingDenies(true);
    try {
      const proof = await buildProof(hostPubkey);
      const response = await listAccessDenyRulesClient({
        hostPubkey,
        operatorProofEvent: proof,
        subjectPubkey: subjectPubkey ?? undefined,
        resourceId: resourceFilterInput.trim() || undefined,
        limit: parsePositiveInt(limitInput)
      });
      setDenyRules(response.denyRules);
      setNotice(`Loaded ${response.count} deny rule${response.count === 1 ? "" : "s"}.`);
    } catch (loadError: any) {
      setError(loadError?.message ?? "Failed to load deny rules.");
    } finally {
      setIsLoadingDenies(false);
    }
  }, [buildProof, hostInput, limitInput, resourceFilterInput, subjectFilterInput]);

  const loadAudit = useCallback(async () => {
    setError(null);
    setNotice(null);
    const hostPubkey = normalizePubkeyInput(hostInput);
    if (!hostPubkey) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const subjectPubkey = subjectFilterInput.trim() ? normalizePubkeyInput(subjectFilterInput) : null;
    if (subjectFilterInput.trim() && !subjectPubkey) {
      setError("Subject filter must be a valid npub or 64-hex pubkey.");
      return;
    }

    setIsLoadingAudit(true);
    try {
      const proof = await buildProof(hostPubkey);
      const response = await listAccessAuditClient({
        hostPubkey,
        operatorProofEvent: proof,
        subjectPubkey: subjectPubkey ?? undefined,
        resourceId: resourceFilterInput.trim() || undefined,
        limit: parsePositiveInt(limitInput)
      });
      setAuditRows(response.audit);
      setNotice(`Loaded ${response.count} audit record${response.count === 1 ? "" : "s"}.`);
    } catch (loadError: any) {
      setError(loadError?.message ?? "Failed to load access audit.");
    } finally {
      setIsLoadingAudit(false);
    }
  }, [buildProof, hostInput, limitInput, resourceFilterInput, subjectFilterInput]);

  const upsertDenyRule = useCallback(async () => {
    setError(null);
    setNotice(null);

    const hostPubkey = normalizePubkeyInput(hostInput);
    if (!hostPubkey) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const subjectPubkey = normalizePubkeyInput(subjectDenyInput);
    if (!subjectPubkey) {
      setError("Subject pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const resourceId = resourceDenyInput.trim();
    if (!resourceId) {
      setError("Resource ID is required.");
      return;
    }
    if (denyActions.length === 0) {
      setError("Select at least one action.");
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresInHours = parsePositiveInt(denyExpiresHoursInput);
    const expiresAtSec = expiresInHours ? now + expiresInHours * 60 * 60 : undefined;

    setIsSavingDeny(true);
    try {
      const proof = await buildProof(hostPubkey);
      const result = await upsertAccessDenyRuleClient({
        hostPubkey,
        subjectPubkey,
        resourceId,
        actions: denyActions,
        reason: denyReasonInput.trim() || undefined,
        expiresAtSec,
        operatorProofEvent: proof
      });
      setNotice(`Saved deny rule for ${formatPubkey(result.denyRule.subjectPubkey)}.`);
      setSubjectDenyInput("");
      setResourceDenyInput("");
      setDenyReasonInput("");
      setDenyExpiresHoursInput("");
      await loadDenyRules();
    } catch (saveError: any) {
      setError(saveError?.message ?? "Failed to save deny rule.");
    } finally {
      setIsSavingDeny(false);
    }
  }, [buildProof, denyActions, denyExpiresHoursInput, denyReasonInput, hostInput, loadDenyRules, resourceDenyInput, subjectDenyInput]);

  const toggleDenyAction = useCallback((action: AccessAction) => {
    setDenyActions((prev) => {
      if (prev.includes(action)) return prev.filter((value) => value !== action);
      return [...prev, action];
    });
  }, []);

  if (!identity) {
    return (
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">Deny Rules &amp; Audit</h2>
        <p className="text-sm text-neutral-500">Connect an identity to manage deny rules and inspect audit history.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-200">Deny Rules &amp; Audit</h2>
        <p className="text-xs text-neutral-500 mt-1">Set explicit deny rules and review access evaluator decisions.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_120px] gap-2">
        <input
          value={hostInput}
          onChange={(event) => setHostInput(event.target.value)}
          placeholder="Host pubkey (npub or 64-hex)"
          className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
        />
        <input
          value={subjectFilterInput}
          onChange={(event) => setSubjectFilterInput(event.target.value)}
          placeholder="Subject filter (optional)"
          className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
        />
        <input
          value={resourceFilterInput}
          onChange={(event) => setResourceFilterInput(event.target.value)}
          placeholder="Resource filter (optional)"
          className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
        />
        <input
          value={limitInput}
          onChange={(event) => setLimitInput(event.target.value)}
          placeholder="Limit"
          className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isLoadingDenies}
          onClick={() => void loadDenyRules()}
          className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
        >
          {isLoadingDenies ? "Loading denies…" : "Reload deny rules"}
        </button>
        <button
          type="button"
          disabled={isLoadingAudit}
          onClick={() => void loadAudit()}
          className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
        >
          {isLoadingAudit ? "Loading audit…" : "Reload audit"}
        </button>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Upsert deny rule</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={subjectDenyInput}
            onChange={(event) => setSubjectDenyInput(event.target.value)}
            placeholder="Subject pubkey (npub or 64-hex)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <input
            value={resourceDenyInput}
            onChange={(event) => setResourceDenyInput(event.target.value)}
            placeholder="Resource ID (e.g. stream:<host>:<streamId>:live)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={denyReasonInput}
            onChange={(event) => setDenyReasonInput(event.target.value)}
            placeholder="Reason (optional)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            value={denyExpiresHoursInput}
            onChange={(event) => setDenyExpiresHoursInput(event.target.value)}
            placeholder="Expires in hours (optional)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {ACCESS_ACTIONS.map((action) => {
            const active = denyActions.includes(action);
            return (
              <button
                key={action}
                type="button"
                onClick={() => toggleDenyAction(action)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                  active ? "bg-red-600/20 border-red-500 text-red-200" : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {active && <Check className="w-3.5 h-3.5" />}
                {actionLabel(action)}
              </button>
            );
          })}
        </div>
        <div>
          <button
            type="button"
            disabled={isSavingDeny}
            onClick={() => void upsertDenyRule()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-700/60 hover:bg-red-600/70 text-sm font-medium disabled:opacity-50"
          >
            <ShieldAlert className="w-4 h-4" />
            {isSavingDeny ? "Saving…" : "Save deny rule"}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-300">{error}</div>}
      {notice && <div className="text-xs text-emerald-300">{notice}</div>}

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Active deny rules</div>
        {denyRules.length === 0 ? (
          <div className="text-sm text-neutral-500">No active deny rules in scope.</div>
        ) : (
          <div className="space-y-2">
            {denyRules.map((row) => (
              <article key={row.id} className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-neutral-200 font-mono truncate" title={row.subjectPubkey}>
                      {formatPubkey(row.subjectPubkey)}
                    </div>
                    <div className="text-[11px] text-neutral-500 font-mono truncate" title={row.resourceId}>
                      {row.resourceId}
                    </div>
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Start: {formatEpoch(row.startsAtSec)} · Expires: {formatEpoch(row.expiresAtSec)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.actions.map((action) => (
                    <span key={`${row.id}:${action}`} className="inline-flex items-center px-2 py-0.5 rounded border border-red-700/30 bg-red-950/20 text-[11px] text-red-200">
                      {actionLabel(action as AccessAction)}
                    </span>
                  ))}
                </div>
                {row.reason && (
                  <div className="text-[11px] text-red-200/80">
                    <span className="text-red-300/80">Reason:</span> {row.reason}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Access audit</div>
        {auditRows.length === 0 ? (
          <div className="text-sm text-neutral-500">No audit records in scope.</div>
        ) : (
          <div className="space-y-2">
            {auditRows.map((row) => (
              <article key={row.id} className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-neutral-400">{formatEpoch(row.atSec)}</div>
                  <div className={`text-xs font-medium ${auditReasonClass(row.reasonCode)}`}>{row.reasonCode}</div>
                </div>
                <div className="text-xs text-neutral-300">
                  <span className="font-medium">{row.allowed ? "ALLOW" : "DENY"}</span> · {actionLabel(row.action as AccessAction)}
                </div>
                <div className="text-[11px] text-neutral-500 font-mono truncate" title={row.resourceId}>
                  {row.resourceId}
                </div>
                {row.subjectPubkey && (
                  <div className="text-[11px] text-neutral-500 font-mono truncate" title={row.subjectPubkey}>
                    {formatPubkey(row.subjectPubkey)}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
