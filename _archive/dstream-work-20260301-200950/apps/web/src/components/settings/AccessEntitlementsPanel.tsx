"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ShieldMinus, ShieldPlus } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import {
  buildAccessAdminProof,
  grantAccessEntitlementClient,
  listVodPlaylistCatalogClient,
  listAccessEntitlementsClient,
  revokeAccessEntitlementClient,
  type AccessEntitlementStatusFilter,
  type VodPlaylistCatalogRow
} from "@/lib/access/client";
import { ACCESS_ACTIONS, ACCESS_ENTITLEMENT_SOURCES, type AccessAction, type AccessEntitlement } from "@/lib/access/types";

const STREAM_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const PLAYLIST_ID_RE = /^(?:__root__|[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})$/;
type VodPackageDurationPreset = "24h" | "7d" | "30d" | "365d" | "custom";

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

function statusClassName(status: AccessEntitlement["status"]): string {
  if (status === "active") return "text-emerald-300 border-emerald-600/30 bg-emerald-950/30";
  if (status === "revoked") return "text-red-300 border-red-600/30 bg-red-950/30";
  return "text-amber-200 border-amber-600/30 bg-amber-950/30";
}

function parsePositiveInt(raw: string): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  if (value <= 0) return undefined;
  return Math.trunc(value);
}

function normalizeStreamIdInput(raw: string): string | null {
  const value = (raw ?? "").trim();
  if (!STREAM_ID_RE.test(value)) return null;
  return value;
}

function normalizePlaylistIdInput(raw: string): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (!PLAYLIST_ID_RE.test(value)) return null;
  return value;
}

function presetDurationHours(preset: VodPackageDurationPreset, customHoursInput: string): number | null {
  if (preset === "24h") return 24;
  if (preset === "7d") return 24 * 7;
  if (preset === "30d") return 24 * 30;
  if (preset === "365d") return 24 * 365;
  const custom = parsePositiveInt(customHoursInput);
  return custom ?? null;
}

function formatVodPlaylistLabel(row: VodPlaylistCatalogRow): string {
  if (row.id === "__root__") return "Root files";
  return row.id;
}

function formatVodPlaylistTitle(row: VodPlaylistCatalogRow): string {
  const modified =
    Number.isFinite(row.latestModifiedAtMs) && row.latestModifiedAtMs > 0
      ? new Date(row.latestModifiedAtMs).toLocaleString()
      : "unknown";
  return `${formatVodPlaylistLabel(row)} · ${row.fileCount} file${row.fileCount === 1 ? "" : "s"} · updated ${modified}`;
}

function formatHoursCompact(hours: number): string {
  if (hours % (24 * 365) === 0) return `${hours / (24 * 365)}y`;
  if (hours % (24 * 30) === 0) return `${hours / (24 * 30)}mo`;
  if (hours % 24 === 0) return `${hours / 24}d`;
  return `${hours}h`;
}

export function AccessEntitlementsPanel() {
  const { identity, signEvent } = useIdentity();

  const [hostInput, setHostInput] = useState("");
  const [subjectFilterInput, setSubjectFilterInput] = useState("");
  const [resourceFilterInput, setResourceFilterInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<AccessEntitlementStatusFilter>("active");
  const [limitInput, setLimitInput] = useState("200");

  const [subjectGrantInput, setSubjectGrantInput] = useState("");
  const [resourceGrantInput, setResourceGrantInput] = useState("");
  const [grantSource, setGrantSource] = useState<(typeof ACCESS_ENTITLEMENT_SOURCES)[number]>("manual_grant");
  const [grantSourceRef, setGrantSourceRef] = useState("");
  const [grantExpiresHoursInput, setGrantExpiresHoursInput] = useState("");
  const [grantActions, setGrantActions] = useState<AccessAction[]>(["watch_live", "chat_send"]);
  const [vodPackageSubjectInput, setVodPackageSubjectInput] = useState("");
  const [vodPackageStreamIdInput, setVodPackageStreamIdInput] = useState("");
  const [vodPackagePlaylistIdInput, setVodPackagePlaylistIdInput] = useState("");
  const [vodPackageDurationPreset, setVodPackageDurationPreset] = useState<VodPackageDurationPreset>("30d");
  const [vodPackageCustomHoursInput, setVodPackageCustomHoursInput] = useState("");
  const [vodPackageSource, setVodPackageSource] = useState<(typeof ACCESS_ENTITLEMENT_SOURCES)[number]>("purchase_verified");
  const [vodPackageSourceRef, setVodPackageSourceRef] = useState("");
  const [vodCatalogRows, setVodCatalogRows] = useState<VodPlaylistCatalogRow[]>([]);
  const [vodCatalogFileCount, setVodCatalogFileCount] = useState(0);
  const [isLoadingVodCatalog, setIsLoadingVodCatalog] = useState(false);
  const [isGrantingVodPackage, setIsGrantingVodPackage] = useState(false);

  const [entitlements, setEntitlements] = useState<AccessEntitlement[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isGranting, setIsGranting] = useState(false);
  const [revokeBusyId, setRevokeBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!identity?.pubkey) return;
    setHostInput((prev) => (prev.trim() ? prev : identity.pubkey));
  }, [identity?.pubkey]);

  useEffect(() => {
    setVodCatalogRows([]);
    setVodCatalogFileCount(0);
  }, [hostInput, vodPackageStreamIdInput]);

  const normalizedHostPubkey = useMemo(() => normalizePubkeyInput(hostInput), [hostInput]);
  const hostPubkeyForActions = normalizedHostPubkey ?? identity?.pubkey ?? null;
  const normalizedVodPlaylistSelection = useMemo(() => {
    const raw = vodPackagePlaylistIdInput.trim();
    if (!raw) return "";
    return normalizePlaylistIdInput(raw) ?? "__invalid__";
  }, [vodPackagePlaylistIdInput]);
  const normalizedVodStreamId = useMemo(
    () => normalizeStreamIdInput(vodPackageStreamIdInput),
    [vodPackageStreamIdInput]
  );
  const normalizedVodPlaylistId = useMemo(() => {
    const raw = vodPackagePlaylistIdInput.trim();
    if (!raw) return null;
    return normalizePlaylistIdInput(raw);
  }, [vodPackagePlaylistIdInput]);
  const vodPackageDurationHours = useMemo(
    () => presetDurationHours(vodPackageDurationPreset, vodPackageCustomHoursInput),
    [vodPackageCustomHoursInput, vodPackageDurationPreset]
  );
  const vodResourcePreview = useMemo(() => {
    if (!normalizedHostPubkey || !normalizedVodStreamId) return "";
    if (normalizedVodPlaylistId) {
      return `stream:${normalizedHostPubkey}:${normalizedVodStreamId}:vod:${normalizedVodPlaylistId}:*`;
    }
    return `stream:${normalizedHostPubkey}:${normalizedVodStreamId}:vod:*`;
  }, [normalizedHostPubkey, normalizedVodPlaylistId, normalizedVodStreamId]);
  const vodScopePreviewLabel = useMemo(() => {
    if (!normalizedVodPlaylistId) return "All VOD folders";
    if (normalizedVodPlaylistId === "__root__") return "Root files";
    return normalizedVodPlaylistId;
  }, [normalizedVodPlaylistId]);
  const vodDurationPreview = useMemo(() => {
    if (!vodPackageDurationHours || vodPackageDurationHours <= 0) return "—";
    return formatHoursCompact(vodPackageDurationHours);
  }, [vodPackageDurationHours]);

  const buildProof = useCallback(
    async (hostPubkey: string) => {
      if (!identity?.pubkey) throw new Error("Connect an identity to sign access admin proof events.");
      const proof = await buildAccessAdminProof(signEvent, identity.pubkey, hostPubkey);
      if (!proof) throw new Error("Failed to sign access admin proof event.");
      return proof;
    },
    [identity?.pubkey, signEvent]
  );

  const loadVodCatalog = useCallback(async () => {
    setError(null);
    setNotice(null);

    const hostPubkey = normalizePubkeyInput(hostInput);
    if (!hostPubkey) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const streamId = normalizeStreamIdInput(vodPackageStreamIdInput);
    if (!streamId) {
      setError("Stream ID must use letters, digits, '-' or '_' (max 128 chars).");
      return;
    }

    setIsLoadingVodCatalog(true);
    try {
      const proof = await buildProof(hostPubkey);
      const response = await listVodPlaylistCatalogClient({
        hostPubkey,
        streamId,
        operatorProofEvent: proof
      });
      setVodCatalogRows(response.playlists);
      setVodCatalogFileCount(response.fileCount);
      if (response.playlists.length === 0) {
        setNotice("No VOD files found for this stream yet.");
      } else {
        setNotice(
          `Loaded ${response.playlists.length} VOD folder${response.playlists.length === 1 ? "" : "s"} (${response.fileCount} file${
            response.fileCount === 1 ? "" : "s"
          }).`
        );
      }
    } catch (loadError: any) {
      setError(loadError?.message ?? "Failed to load VOD catalog.");
    } finally {
      setIsLoadingVodCatalog(false);
    }
  }, [buildProof, hostInput, vodPackageStreamIdInput]);

  const loadEntitlements = useCallback(async () => {
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

    setIsLoadingList(true);
    try {
      const proof = await buildProof(hostPubkey);
      const response = await listAccessEntitlementsClient({
        hostPubkey,
        operatorProofEvent: proof,
        subjectPubkey: subjectPubkey ?? undefined,
        resourceId: resourceFilterInput.trim() || undefined,
        status: statusFilter,
        limit: parsePositiveInt(limitInput)
      });
      setEntitlements(response.entitlements);
      setNotice(`Loaded ${response.count} entitlement${response.count === 1 ? "" : "s"}.`);
    } catch (loadError: any) {
      setError(loadError?.message ?? "Failed to load entitlements.");
    } finally {
      setIsLoadingList(false);
    }
  }, [buildProof, hostInput, limitInput, resourceFilterInput, statusFilter, subjectFilterInput]);

  const grantVodPackage = useCallback(async () => {
    setError(null);
    setNotice(null);

    const hostPubkey = normalizePubkeyInput(hostInput);
    if (!hostPubkey) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const subjectPubkey = normalizePubkeyInput(vodPackageSubjectInput);
    if (!subjectPubkey) {
      setError("VOD package subject must be a valid npub or 64-hex pubkey.");
      return;
    }
    const streamId = normalizeStreamIdInput(vodPackageStreamIdInput);
    if (!streamId) {
      setError("Stream ID must use letters, digits, '-' or '_' (max 128 chars).");
      return;
    }
    const playlistIdInput = vodPackagePlaylistIdInput.trim();
    const playlistId = normalizePlaylistIdInput(playlistIdInput);
    if (playlistIdInput && !playlistId) {
      setError("Playlist ID must use letters, digits, '.', '-' or '_' (max 80 chars), or __root__.");
      return;
    }

    const durationHours = presetDurationHours(vodPackageDurationPreset, vodPackageCustomHoursInput);
    if (!durationHours || durationHours <= 0) {
      setError("Select a valid package duration.");
      return;
    }
    const expiresAtSec = Math.floor(Date.now() / 1000) + durationHours * 60 * 60;
    const resourceId = playlistId
      ? `stream:${hostPubkey}:${streamId}:vod:${playlistId}:*`
      : `stream:${hostPubkey}:${streamId}:vod:*`;

    setIsGrantingVodPackage(true);
    try {
      const proof = await buildProof(hostPubkey);
      const result = await grantAccessEntitlementClient({
        hostPubkey,
        subjectPubkey,
        resourceId,
        actions: ["watch_vod"],
        source: vodPackageSource,
        sourceRef: vodPackageSourceRef.trim() || undefined,
        expiresAtSec,
        operatorProofEvent: proof
      });
      setEntitlements((prev) => [result.entitlement, ...prev.filter((row) => row.id !== result.entitlement.id)]);
      setNotice(
        `Granted ${
          playlistId ? `${playlistId === "__root__" ? "root files" : `playlist ${playlistId}`}` : "all VOD"
        } access to ${formatPubkey(result.entitlement.subjectPubkey)} for ${durationHours}h.`
      );
      setVodPackageSubjectInput("");
      setVodPackagePlaylistIdInput("");
      setVodPackageSourceRef("");
      setVodPackageCustomHoursInput("");
      await loadEntitlements();
    } catch (grantError: any) {
      setError(grantError?.message ?? "Failed to grant VOD package.");
    } finally {
      setIsGrantingVodPackage(false);
    }
  }, [
    buildProof,
    hostInput,
    loadEntitlements,
    vodPackageCustomHoursInput,
    vodPackageDurationPreset,
    vodPackagePlaylistIdInput,
    vodPackageSource,
    vodPackageSourceRef,
    vodPackageStreamIdInput,
    vodPackageSubjectInput
  ]);

  const toggleGrantAction = useCallback((action: AccessAction) => {
    setGrantActions((prev) => {
      if (prev.includes(action)) return prev.filter((value) => value !== action);
      return [...prev, action];
    });
  }, []);

  const grantEntitlement = useCallback(async () => {
    setError(null);
    setNotice(null);

    const hostPubkey = normalizePubkeyInput(hostInput);
    if (!hostPubkey) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const subjectPubkey = normalizePubkeyInput(subjectGrantInput);
    if (!subjectPubkey) {
      setError("Subject pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const resourceId = resourceGrantInput.trim();
    if (!resourceId) {
      setError("Resource ID is required.");
      return;
    }
    if (grantActions.length === 0) {
      setError("Select at least one action.");
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresInHours = parsePositiveInt(grantExpiresHoursInput);
    const expiresAtSec = expiresInHours ? now + expiresInHours * 60 * 60 : undefined;

    setIsGranting(true);
    try {
      const proof = await buildProof(hostPubkey);
      const result = await grantAccessEntitlementClient({
        hostPubkey,
        subjectPubkey,
        resourceId,
        actions: grantActions,
        source: grantSource,
        sourceRef: grantSourceRef.trim() || undefined,
        expiresAtSec,
        operatorProofEvent: proof
      });
      setEntitlements((prev) => [result.entitlement, ...prev.filter((row) => row.id !== result.entitlement.id)]);
      setNotice(`Granted access for ${formatPubkey(result.entitlement.subjectPubkey)}.`);
      setSubjectGrantInput("");
      setResourceGrantInput("");
      setGrantSourceRef("");
      setGrantExpiresHoursInput("");
      await loadEntitlements();
    } catch (grantError: any) {
      setError(grantError?.message ?? "Failed to grant entitlement.");
    } finally {
      setIsGranting(false);
    }
  }, [buildProof, grantActions, grantExpiresHoursInput, grantSource, grantSourceRef, hostInput, loadEntitlements, resourceGrantInput, subjectGrantInput]);

  const revokeEntitlement = useCallback(
    async (row: AccessEntitlement) => {
      if (!hostPubkeyForActions) {
        setError("Host pubkey is required to revoke entitlement.");
        return;
      }
      const confirmed = window.confirm(`Revoke entitlement for ${formatPubkey(row.subjectPubkey)}?`);
      if (!confirmed) return;

      setError(null);
      setNotice(null);
      setRevokeBusyId(row.id);
      try {
        const reason = window.prompt("Optional revoke reason", "manual revoke") ?? "";
        const proof = await buildProof(hostPubkeyForActions);
        const result = await revokeAccessEntitlementClient({
          entitlementId: row.id,
          hostPubkey: hostPubkeyForActions,
          revokeReason: reason.trim() || undefined,
          operatorProofEvent: proof
        });
        setNotice(`Revoked entitlement ${result.entitlement.id.slice(0, 8)}.`);
        await loadEntitlements();
      } catch (revokeError: any) {
        setError(revokeError?.message ?? "Failed to revoke entitlement.");
      } finally {
        setRevokeBusyId(null);
      }
    },
    [buildProof, hostPubkeyForActions, loadEntitlements]
  );

  if (!identity) {
    return (
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">Access Entitlements</h2>
        <p className="text-sm text-neutral-500">Connect an identity to manage grants and revocations.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-200">Access Entitlements</h2>
        <p className="text-xs text-neutral-500 mt-1">
          Creator controls are grouped by workflow: scope → VOD packages → manual overrides → active grants.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">1) Creator scope & grant list</div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_160px_100px_auto] gap-2">
          <input
            value={hostInput}
            onChange={(event) => setHostInput(event.target.value)}
            placeholder="Host pubkey (npub or 64-hex)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as AccessEntitlementStatusFilter)}
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          >
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
            <option value="expired">Expired</option>
            <option value="all">All</option>
          </select>
          <input
            value={limitInput}
            onChange={(event) => setLimitInput(event.target.value)}
            placeholder="200"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <button
            type="button"
            disabled={isLoadingList}
            onClick={() => void loadEntitlements()}
            className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
          >
            {isLoadingList ? "Loading grants…" : "Reload grants"}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={subjectFilterInput}
            onChange={(event) => setSubjectFilterInput(event.target.value)}
            placeholder="Filter by subject pubkey (optional)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <input
            value={resourceFilterInput}
            onChange={(event) => setResourceFilterInput(event.target.value)}
            placeholder="Filter by resource ID (optional)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">2) VOD package grant</div>
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                value={vodPackageSubjectInput}
                onChange={(event) => setVodPackageSubjectInput(event.target.value)}
                placeholder="Buyer pubkey (npub or 64-hex)"
                className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
              />
              <input
                value={vodPackageStreamIdInput}
                onChange={(event) => setVodPackageStreamIdInput(event.target.value)}
                placeholder="Stream ID (required)"
                className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                value={vodPackagePlaylistIdInput}
                onChange={(event) => setVodPackagePlaylistIdInput(event.target.value)}
                placeholder="Playlist ID (optional, top-level VOD folder or __root__)"
                className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
              />
              <select
                value={vodPackageDurationPreset}
                onChange={(event) => setVodPackageDurationPreset(event.target.value as VodPackageDurationPreset)}
                className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
              >
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="365d">365 days</option>
                <option value="custom">Custom hours</option>
              </select>
              <input
                value={vodPackageCustomHoursInput}
                onChange={(event) => setVodPackageCustomHoursInput(event.target.value)}
                placeholder="Custom hours"
                disabled={vodPackageDurationPreset !== "custom"}
                className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono disabled:opacity-50"
              />
            </div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Package preview</div>
            <div className="text-xs text-neutral-400">
              Scope: <span className="text-neutral-200">{vodScopePreviewLabel}</span>
            </div>
            <div className="text-xs text-neutral-400">
              Duration: <span className="text-neutral-200">{vodDurationPreview}</span>
            </div>
            <div className="text-xs text-neutral-400">
              Access: <span className="text-neutral-200 font-mono">watch_vod</span>
            </div>
            <div className="text-[11px] text-neutral-500 break-all">
              {vodResourcePreview || "Resource preview will appear after host + stream are valid."}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isLoadingVodCatalog}
            onClick={() => void loadVodCatalog()}
            className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
          >
            {isLoadingVodCatalog ? "Loading VOD folders…" : "Load VOD folders"}
          </button>
          {vodCatalogRows.length > 0 && (
            <span className="text-[11px] text-neutral-500">
              {vodCatalogRows.length} folder{vodCatalogRows.length === 1 ? "" : "s"} · {vodCatalogFileCount} file{vodCatalogFileCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {vodCatalogRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setVodPackagePlaylistIdInput("")}
              className={`inline-flex items-center px-2.5 py-1.5 rounded-lg border text-xs ${
                normalizedVodPlaylistSelection === ""
                  ? "bg-blue-600/20 border-blue-500 text-blue-200"
                  : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              All VOD
            </button>
            {vodCatalogRows.map((row) => (
              <button
                key={row.id}
                type="button"
                title={formatVodPlaylistTitle(row)}
                onClick={() => setVodPackagePlaylistIdInput(row.id)}
                className={`inline-flex items-center px-2.5 py-1.5 rounded-lg border text-xs ${
                  normalizedVodPlaylistSelection === row.id
                    ? "bg-blue-600/20 border-blue-500 text-blue-200"
                    : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {formatVodPlaylistLabel(row)} ({row.fileCount})
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <select
            value={vodPackageSource}
            onChange={(event) => setVodPackageSource(event.target.value as (typeof ACCESS_ENTITLEMENT_SOURCES)[number])}
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          >
            {ACCESS_ENTITLEMENT_SOURCES.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
          <input
            value={vodPackageSourceRef}
            onChange={(event) => setVodPackageSourceRef(event.target.value)}
            placeholder="Payment/session ref (optional)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-neutral-500">
            Grants <span className="text-neutral-300 font-mono">watch_vod</span> only. Playlist scope maps to
            <span className="text-neutral-300 font-mono"> stream:&lt;host&gt;:&lt;streamId&gt;:vod:&lt;playlist&gt;:*</span>.
          </div>
          <button
            type="button"
            disabled={isGrantingVodPackage}
            onClick={() => void grantVodPackage()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium disabled:opacity-50"
          >
            <ShieldPlus className="w-4 h-4" />
            {isGrantingVodPackage ? "Granting…" : "Grant VOD package"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">3) Manual entitlement override</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={subjectGrantInput}
            onChange={(event) => setSubjectGrantInput(event.target.value)}
            placeholder="Subject pubkey (npub or 64-hex)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <input
            value={resourceGrantInput}
            onChange={(event) => setResourceGrantInput(event.target.value)}
            placeholder="Resource ID (e.g. stream:<host>:<streamId>:live)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select
            value={grantSource}
            onChange={(event) => setGrantSource(event.target.value as (typeof ACCESS_ENTITLEMENT_SOURCES)[number])}
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          >
            {ACCESS_ENTITLEMENT_SOURCES.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
          <input
            value={grantSourceRef}
            onChange={(event) => setGrantSourceRef(event.target.value)}
            placeholder="Source ref (optional)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <input
            value={grantExpiresHoursInput}
            onChange={(event) => setGrantExpiresHoursInput(event.target.value)}
            placeholder="Expires in hours (optional)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {ACCESS_ACTIONS.map((action) => {
            const active = grantActions.includes(action);
            return (
              <button
                key={action}
                type="button"
                onClick={() => toggleGrantAction(action)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                  active ? "bg-blue-600/20 border-blue-500 text-blue-200" : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800"
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
            disabled={isGranting}
            onClick={() => void grantEntitlement()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium disabled:opacity-50"
          >
            <ShieldPlus className="w-4 h-4" />
            {isGranting ? "Granting…" : "Grant access"}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-300">{error}</div>}
      {notice && <div className="text-xs text-emerald-300">{notice}</div>}

      {entitlements.length === 0 ? (
        <div className="text-sm text-neutral-500">No entitlements in the selected scope.</div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-neutral-500">4) Active entitlement records</div>
          {entitlements.map((row) => (
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] uppercase ${statusClassName(row.status)}`}>
                    {row.status}
                  </span>
                  {row.status === "active" && (
                    <button
                      type="button"
                      disabled={revokeBusyId === row.id}
                      onClick={() => void revokeEntitlement(row)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-700/40 bg-red-950/20 text-xs text-red-200 hover:bg-red-950/30 disabled:opacity-50"
                    >
                      <ShieldMinus className="w-3.5 h-3.5" />
                      {revokeBusyId === row.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.actions.map((action) => (
                  <span key={`${row.id}:${action}`} className="inline-flex items-center px-2 py-0.5 rounded border border-neutral-700 bg-neutral-900 text-[11px] text-neutral-300">
                    {actionLabel(action as AccessAction)}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[11px] text-neutral-500">
                <div>
                  <span className="text-neutral-400">Source:</span> {row.source}
                </div>
                <div>
                  <span className="text-neutral-400">Start:</span> {formatEpoch(row.startsAtSec)}
                </div>
                <div>
                  <span className="text-neutral-400">Expires:</span> {formatEpoch(row.expiresAtSec)}
                </div>
                <div className="truncate" title={row.id}>
                  <span className="text-neutral-400">ID:</span> {row.id.slice(0, 8)}
                </div>
              </div>
              {row.revokeReason && (
                <div className="text-[11px] text-red-200/80">
                  <span className="text-red-300/80">Revoke reason:</span> {row.revokeReason}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
