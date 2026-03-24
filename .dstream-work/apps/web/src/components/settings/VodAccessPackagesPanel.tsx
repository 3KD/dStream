"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, PackagePlus, Pencil, RefreshCcw, ShieldPlus, Trash2 } from "lucide-react";
import { STREAM_PAYMENT_ASSETS, type StreamPaymentAsset } from "@dstream/protocol";
import { useIdentity } from "@/context/IdentityContext";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import {
  buildAccessAdminProof,
  buildAccessPurchaseProof,
  disableVodAccessPackageClient,
  grantAccessEntitlementClient,
  listAccessEntitlementsClient,
  listVodCatalogEntriesClient,
  listVodPlaylistCatalogClient,
  listVodAccessPackagesClient,
  purchaseVodAccessPackageClient,
  upsertVodAccessPackageClient,
  type VodAccessPackage,
  type VodPackagePurchaseStats,
  type VodCatalogListRow,
  type VodAccessPackageStatus,
  type VodAccessPackageVisibility,
  type VodPlaylistCatalogRow
} from "@/lib/access/client";
import type { AccessEntitlement } from "@/lib/access/types";
import {
  buildVodEntitlementCoverage,
  buildVodPricingCoverage,
  summarizeVodRelease,
  type VodReleaseEntitlementCoverage,
  type VodReleaseEntryInput
} from "@/lib/vodRelease";
import {
  DEFAULT_VOD_PURCHASE_POLICY,
  VOD_PURCHASE_POLICIES,
  getVodPurchasePolicyFromMetadata,
  getVodPurchasePolicyLabel,
  type VodPurchasePolicy
} from "@/lib/access/vodPackagePolicy";

const STREAM_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const PLAYLIST_ID_RE = /^(?:__root__|[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})$/;
const RELATIVE_PATH_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const VOD_PACKAGE_IMPORT_EVENT = "dstream:vod-package-bulk-import";
type BulkPreset = "monthly" | "weekly" | "daily" | "lifetime";

interface VodPackageBulkImportDetail {
  hostPubkey: string;
  streamId: string;
  playlistIds: string[];
  relativePaths: string[];
  titlePrefix?: string;
}

const BULK_PRESETS: Record<BulkPreset, { label: string; durationHours: number; amountHint: string; titleSuffix: string }> = {
  monthly: {
    label: "Monthly playlist pass",
    durationHours: 24 * 30,
    amountHint: "0.10",
    titleSuffix: "Monthly Pass"
  },
  weekly: {
    label: "Weekly playlist pass",
    durationHours: 24 * 7,
    amountHint: "0.03",
    titleSuffix: "Weekly Pass"
  },
  daily: {
    label: "24h playlist pass",
    durationHours: 24,
    amountHint: "0.01",
    titleSuffix: "24h Pass"
  },
  lifetime: {
    label: "Lifetime playlist pass",
    durationHours: 24 * 365 * 10,
    amountHint: "0.50",
    titleSuffix: "Lifetime Access"
  }
};

function normalizeRelativePath(raw: string): string {
  return raw.trim().replace(/\\/g, "/");
}

function derivePlaylistScope(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return "__root__";
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) return "__root__";
  return segments[0] ?? "__root__";
}

function isValidRelativePath(raw: string): boolean {
  const normalized = normalizeRelativePath(raw);
  if (!normalized) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => RELATIVE_PATH_SEGMENT_RE.test(segment));
}

function parsePositiveInt(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (value <= 0) return null;
  return Math.trunc(value);
}

function shortHost(pubkey: string): string {
  const npub = pubkeyHexToNpub(pubkey);
  if (npub) return `${npub.slice(0, 16)}…${npub.slice(-8)}`;
  return `${pubkey.slice(0, 12)}…${pubkey.slice(-8)}`;
}

function formatDuration(hours: number): string {
  if (hours % (24 * 365) === 0) return `${hours / (24 * 365)} year`;
  if (hours % (24 * 30) === 0) return `${hours / (24 * 30)} month`;
  if (hours % 24 === 0) return `${hours / 24} day`;
  return `${hours} hour`;
}

function formatStatsTimestamp(seconds: number | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function VodAccessPackagesPanel() {
  const { identity, signEvent } = useIdentity();

  const [hostInput, setHostInput] = useState("");
  const [streamIdInput, setStreamIdInput] = useState("");
  const [playlistIdInput, setPlaylistIdInput] = useState("");
  const [relativePathInput, setRelativePathInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [paymentAsset, setPaymentAsset] = useState<StreamPaymentAsset>("xmr");
  const [paymentAmountInput, setPaymentAmountInput] = useState("");
  const [paymentRailIdInput, setPaymentRailIdInput] = useState("");
  const [durationHoursInput, setDurationHoursInput] = useState("720");
  const [purchasePolicyInput, setPurchasePolicyInput] = useState<VodPurchasePolicy>(DEFAULT_VOD_PURCHASE_POLICY);
  const [statusInput, setStatusInput] = useState<VodAccessPackageStatus>("active");
  const [visibilityInput, setVisibilityInput] = useState<VodAccessPackageVisibility>("public");
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [grantSubjectInput, setGrantSubjectInput] = useState("");
  const [grantDurationHoursInput, setGrantDurationHoursInput] = useState("720");
  const [grantBusyPackageId, setGrantBusyPackageId] = useState<string | null>(null);

  const [packages, setPackages] = useState<VodAccessPackage[]>([]);
  const [purchaseStatsByPackageId, setPurchaseStatsByPackageId] = useState<Record<string, VodPackagePurchaseStats>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [enableBusyId, setEnableBusyId] = useState<string | null>(null);
  const [purchaseBusyId, setPurchaseBusyId] = useState<string | null>(null);
  const [playlistCatalogRows, setPlaylistCatalogRows] = useState<VodPlaylistCatalogRow[]>([]);
  const [playlistCatalogLoading, setPlaylistCatalogLoading] = useState(false);
  const [playlistCatalogError, setPlaylistCatalogError] = useState<string | null>(null);
  const [catalogRows, setCatalogRows] = useState<VodCatalogListRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [streamEntitlements, setStreamEntitlements] = useState<AccessEntitlement[]>([]);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);
  const [entitlementsError, setEntitlementsError] = useState<string | null>(null);
  const [selectedBulkPlaylistIds, setSelectedBulkPlaylistIds] = useState<string[]>([]);
  const [selectedBulkRelativePaths, setSelectedBulkRelativePaths] = useState<string[]>([]);
  const [bulkPreset, setBulkPreset] = useState<BulkPreset>("monthly");
  const [bulkTitlePrefixInput, setBulkTitlePrefixInput] = useState("");
  const [bulkAmountInput, setBulkAmountInput] = useState(BULK_PRESETS.monthly.amountHint);
  const [bulkDurationHoursInput, setBulkDurationHoursInput] = useState(String(BULK_PRESETS.monthly.durationHours));
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [showOnlyCurrentStreamPackages, setShowOnlyCurrentStreamPackages] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!identity?.pubkey) return;
    setHostInput((prev) => (prev.trim() ? prev : identity.pubkey));
  }, [identity?.pubkey]);

  useEffect(() => {
    const onImport = (event: Event) => {
      const detail = (event as CustomEvent<VodPackageBulkImportDetail>).detail;
      if (!detail || typeof detail !== "object") return;

      const normalizedHost = typeof detail.hostPubkey === "string" ? pubkeyParamToHex(detail.hostPubkey) : null;
      const streamId = typeof detail.streamId === "string" ? detail.streamId.trim() : "";
      const playlistIds = Array.isArray(detail.playlistIds)
        ? Array.from(
            new Set(
              detail.playlistIds
                .map((playlistId) => (typeof playlistId === "string" ? playlistId.trim() : ""))
                .filter((playlistId) => PLAYLIST_ID_RE.test(playlistId))
            )
          )
        : [];
      const relativePaths = Array.isArray(detail.relativePaths)
        ? Array.from(
            new Set(
              detail.relativePaths
                .map((relativePath) => (typeof relativePath === "string" ? normalizeRelativePath(relativePath) : ""))
                .filter((relativePath) => isValidRelativePath(relativePath))
            )
          )
        : [];

      if (!normalizedHost || !STREAM_ID_RE.test(streamId) || (playlistIds.length === 0 && relativePaths.length === 0)) return;

      setHostInput(normalizedHost);
      setStreamIdInput(streamId);
      setSelectedBulkPlaylistIds(playlistIds);
      setSelectedBulkRelativePaths(relativePaths);
      setBulkTitlePrefixInput(typeof detail.titlePrefix === "string" && detail.titlePrefix.trim() ? detail.titlePrefix.trim() : streamId);
      setError(null);
      setNotice(null);
      setBulkError(null);
      setPlaylistCatalogError(null);
      setBulkNotice(
        `Imported ${
          playlistIds.length
        } playlist scope${playlistIds.length === 1 ? "" : "s"} and ${relativePaths.length} file scope${
          relativePaths.length === 1 ? "" : "s"
        } from VOD selection. Review preset and apply.`
      );
    };

    window.addEventListener(VOD_PACKAGE_IMPORT_EVENT, onImport as EventListener);
    return () => {
      window.removeEventListener(VOD_PACKAGE_IMPORT_EVENT, onImport as EventListener);
    };
  }, []);

  const normalizedHostPubkey = useMemo(() => pubkeyParamToHex(hostInput), [hostInput]);
  const normalizedStreamIdInput = useMemo(() => streamIdInput.trim(), [streamIdInput]);
  const normalizedGrantSubjectPubkey = useMemo(() => pubkeyParamToHex(grantSubjectInput), [grantSubjectInput]);
  const grantDurationHours = useMemo(() => parsePositiveInt(grantDurationHoursInput), [grantDurationHoursInput]);
  const selectedBulkPlaylistSet = useMemo(() => new Set(selectedBulkPlaylistIds), [selectedBulkPlaylistIds]);
  const selectedBulkRelativePathSet = useMemo(() => new Set(selectedBulkRelativePaths), [selectedBulkRelativePaths]);
  const playlistCatalogById = useMemo(() => new Map(playlistCatalogRows.map((row) => [row.id, row])), [playlistCatalogRows]);
  const bulkPresetConfig = BULK_PRESETS[bulkPreset];
  const streamPlaylistPackagesById = useMemo(() => {
    const result = new Map<string, VodAccessPackage>();
    if (!normalizedStreamIdInput) return result;
    for (const row of packages) {
      if (row.streamId !== normalizedStreamIdInput) continue;
      if (!row.playlistId || row.relativePath) continue;
      const existing = result.get(row.playlistId);
      if (!existing || row.updatedAtSec > existing.updatedAtSec) {
        result.set(row.playlistId, row);
      }
    }
    return result;
  }, [normalizedStreamIdInput, packages]);
  const visiblePackages = useMemo(() => {
    if (!showOnlyCurrentStreamPackages) return packages;
    if (!normalizedStreamIdInput) return packages;
    return packages.filter((row) => row.streamId === normalizedStreamIdInput);
  }, [normalizedStreamIdInput, packages, showOnlyCurrentStreamPackages]);
  const streamScopedPackages = useMemo(() => {
    if (!normalizedStreamIdInput || !STREAM_ID_RE.test(normalizedStreamIdInput)) return [];
    return packages.filter((row) => row.streamId === normalizedStreamIdInput);
  }, [normalizedStreamIdInput, packages]);
  const catalogReleaseEntries = useMemo<VodReleaseEntryInput[]>(
    () =>
      catalogRows.map((row) => ({
        relativePath: row.relativePath,
        playlistId:
          (typeof row.metadata?.playlistId === "string" && row.metadata.playlistId.trim()
            ? row.metadata.playlistId.trim()
            : derivePlaylistScope(row.relativePath)) || "__root__",
        visibility: row.metadata?.visibility ?? "public",
        published: !!row.metadata?.publishedAtSec
      })),
    [catalogRows]
  );
  const releaseCoverageByPath = useMemo(
    () => buildVodPricingCoverage(catalogReleaseEntries, streamScopedPackages),
    [catalogReleaseEntries, streamScopedPackages]
  );
  const releaseSummary = useMemo(
    () => summarizeVodRelease(catalogReleaseEntries, releaseCoverageByPath),
    [catalogReleaseEntries, releaseCoverageByPath]
  );
  const entitlementCoverageByPath = useMemo<Record<string, VodReleaseEntitlementCoverage>>(() => {
    if (!normalizedHostPubkey || !normalizedStreamIdInput) return {};
    if (catalogReleaseEntries.length === 0) return {};
    return buildVodEntitlementCoverage(catalogReleaseEntries, streamEntitlements, {
      hostPubkey: normalizedHostPubkey,
      streamId: normalizedStreamIdInput
    });
  }, [catalogReleaseEntries, normalizedHostPubkey, normalizedStreamIdInput, streamEntitlements]);
  const missingPrivatePublishedRows = useMemo(
    () =>
      catalogRows
        .filter((row) => {
          const isPrivatePublished = row.metadata?.visibility === "private" && !!row.metadata?.publishedAtSec;
          if (!isPrivatePublished) return false;
          return releaseCoverageByPath[row.relativePath]?.hasActiveCoverage !== true;
        })
        .map((row) => ({
          relativePath: row.relativePath,
          fileName: row.fileName,
          playlistId:
            (typeof row.metadata?.playlistId === "string" && row.metadata.playlistId.trim()
              ? row.metadata.playlistId.trim()
              : derivePlaylistScope(row.relativePath)) || "__root__"
        })),
    [catalogRows, releaseCoverageByPath]
  );
  const privatePublishedAccessRows = useMemo(
    () =>
      catalogRows
        .filter((row) => row.metadata?.visibility === "private" && !!row.metadata?.publishedAtSec)
        .map((row) => ({
          relativePath: row.relativePath,
          fileName: row.fileName,
          playlistId:
            (typeof row.metadata?.playlistId === "string" && row.metadata.playlistId.trim()
              ? row.metadata.playlistId.trim()
              : derivePlaylistScope(row.relativePath)) || "__root__",
          hasPackageCoverage: releaseCoverageByPath[row.relativePath]?.hasActiveCoverage === true,
          activeEntitlementCount: entitlementCoverageByPath[row.relativePath]?.matchingEntitlementIds.length ?? 0,
          uniqueViewerCount: entitlementCoverageByPath[row.relativePath]?.uniqueSubjectPubkeys.length ?? 0,
          entitlementScopeCounts: entitlementCoverageByPath[row.relativePath]
            ? {
                stream: entitlementCoverageByPath[row.relativePath]!.streamEntitlementCount,
                playlist: entitlementCoverageByPath[row.relativePath]!.playlistEntitlementCount,
                file: entitlementCoverageByPath[row.relativePath]!.fileEntitlementCount
              }
            : { stream: 0, playlist: 0, file: 0 }
        })),
    [catalogRows, entitlementCoverageByPath, releaseCoverageByPath]
  );
  const privatePublishedAccessSummary = useMemo(() => {
    const total = privatePublishedAccessRows.length;
    const priced = privatePublishedAccessRows.filter((row) => row.hasPackageCoverage).length;
    const unlocked = privatePublishedAccessRows.filter((row) => row.activeEntitlementCount > 0).length;
    const viewerSet = new Set<string>();
    for (const row of privatePublishedAccessRows) {
      for (const pubkey of entitlementCoverageByPath[row.relativePath]?.uniqueSubjectPubkeys ?? []) {
        viewerSet.add(pubkey);
      }
    }
    return {
      total,
      priced,
      unlocked,
      locked: Math.max(0, total - unlocked),
      uniqueViewers: viewerSet.size
    };
  }, [entitlementCoverageByPath, privatePublishedAccessRows]);
  const missingPrivatePlaylistIds = useMemo(
    () => Array.from(new Set(missingPrivatePublishedRows.map((row) => row.playlistId))),
    [missingPrivatePublishedRows]
  );
  const missingPrivateRelativePaths = useMemo(
    () => missingPrivatePublishedRows.map((row) => row.relativePath),
    [missingPrivatePublishedRows]
  );

  const buildProof = useCallback(async () => {
    if (!normalizedHostPubkey) throw new Error("Host pubkey must be a valid npub or 64-hex pubkey.");
    if (!identity?.pubkey) throw new Error("Connect identity to manage VOD packages.");
    const proof = await buildAccessAdminProof(signEvent, identity.pubkey, normalizedHostPubkey);
    if (!proof) throw new Error("Failed to sign access admin proof.");
    return proof;
  }, [identity?.pubkey, normalizedHostPubkey, signEvent]);

  useEffect(() => {
    setBulkAmountInput(bulkPresetConfig.amountHint);
    setBulkDurationHoursInput(String(bulkPresetConfig.durationHours));
  }, [bulkPresetConfig]);

  useEffect(() => {
    setPlaylistCatalogRows([]);
    setCatalogRows([]);
    setStreamEntitlements([]);
    setPurchaseStatsByPackageId({});
    setSelectedBulkPlaylistIds([]);
    setSelectedBulkRelativePaths([]);
    setPlaylistCatalogError(null);
    setCatalogError(null);
    setEntitlementsError(null);
  }, [normalizedHostPubkey, streamIdInput]);

  const resetForm = useCallback(() => {
    setEditingPackageId(null);
    setStreamIdInput("");
    setPlaylistIdInput("");
    setRelativePathInput("");
    setTitleInput("");
    setDescriptionInput("");
    setPaymentAsset("xmr");
    setPaymentAmountInput("");
    setPaymentRailIdInput("");
    setDurationHoursInput("720");
    setPurchasePolicyInput(DEFAULT_VOD_PURCHASE_POLICY);
    setStatusInput("active");
    setVisibilityInput("public");
  }, []);

  const applyPackageToForm = useCallback((row: VodAccessPackage) => {
    setEditingPackageId(row.id);
    setStreamIdInput(row.streamId);
    setPlaylistIdInput(row.playlistId ?? "");
    setRelativePathInput(row.relativePath ?? "");
    setTitleInput(row.title ?? "");
    setDescriptionInput(row.description ?? "");
    setPaymentAsset(row.paymentAsset);
    setPaymentAmountInput(row.paymentAmount);
    setPaymentRailIdInput(row.paymentRailId ?? "");
    setDurationHoursInput(String(row.durationHours));
    setPurchasePolicyInput(getVodPurchasePolicyFromMetadata(row.metadata));
    setStatusInput(row.status);
    setVisibilityInput(row.visibility);
  }, []);

  const loadPackages = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!normalizedHostPubkey) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    setIsLoading(true);
    try {
      const proof = await buildProof();
      const result = await listVodAccessPackagesClient({
        hostPubkey: normalizedHostPubkey,
        includeDisabled: true,
        includeUnlisted: true,
        includePurchaseStats: true,
        purchaseStatsLimit: 20000,
        limit: 400,
        operatorProofEvent: proof
      });
      setPackages(result.packages);
      setPurchaseStatsByPackageId(result.purchaseStatsByPackageId);
      setNotice(`Loaded ${result.count} package${result.count === 1 ? "" : "s"}.`);
    } catch (loadError: any) {
      setPurchaseStatsByPackageId({});
      setError(loadError?.message ?? "Failed to load packages.");
    } finally {
      setIsLoading(false);
    }
  }, [buildProof, normalizedHostPubkey]);

  const loadPlaylistCatalog = useCallback(async () => {
    setPlaylistCatalogError(null);
    setCatalogError(null);
    setEntitlementsError(null);
    setBulkError(null);
    setBulkNotice(null);
    if (!normalizedHostPubkey) {
      setPlaylistCatalogError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const streamId = streamIdInput.trim();
    if (!STREAM_ID_RE.test(streamId)) {
      setPlaylistCatalogError("Enter a valid stream id before loading playlists.");
      return;
    }
    setPlaylistCatalogLoading(true);
    setCatalogLoading(true);
    setEntitlementsLoading(true);
    try {
      const proof = await buildProof();
      const [playlistResult, catalogResult, entitlementsResult] = await Promise.all([
        listVodPlaylistCatalogClient({
          hostPubkey: normalizedHostPubkey,
          streamId,
          operatorProofEvent: proof
        }),
        listVodCatalogEntriesClient({
          hostPubkey: normalizedHostPubkey,
          streamId,
          operatorProofEvent: proof,
          adminRows: true,
          includePrivate: true,
          includeUnlisted: true,
          includeUnpublished: true,
          curatedOnly: false
        }),
        listAccessEntitlementsClient({
          hostPubkey: normalizedHostPubkey,
          operatorProofEvent: proof,
          status: "active",
          limit: 5000
        })
          .then((result) => ({ ok: true as const, entitlements: result.entitlements }))
          .catch((error: any) => ({
            ok: false as const,
            error: error?.message ?? "Failed to load active entitlements."
          }))
      ]);
      const rows = [...playlistResult.playlists].sort((left, right) => {
        if (left.id === "__root__") return -1;
        if (right.id === "__root__") return 1;
        return left.id.localeCompare(right.id);
      });
      setPlaylistCatalogRows(rows);
      setCatalogRows(catalogResult.rows);
      setSelectedBulkPlaylistIds((prev) => {
        const keep = prev.filter((id) => rows.some((row) => row.id === id));
        return keep;
      });
      setSelectedBulkRelativePaths((prev) => {
        const catalogPaths = new Set(catalogResult.rows.map((row) => row.relativePath));
        return prev.filter((relativePath) => catalogPaths.has(relativePath));
      });
      if (entitlementsResult.ok) {
        const resourcePrefix = `stream:${normalizedHostPubkey}:${streamId}:vod`;
        setStreamEntitlements(
          entitlementsResult.entitlements.filter(
            (row) => row.resourceId.startsWith(resourcePrefix) && (row.actions.includes("watch_vod") || row.actions.includes("*"))
          )
        );
        setEntitlementsError(null);
      } else {
        setStreamEntitlements([]);
        setEntitlementsError(entitlementsResult.error);
      }
      setBulkNotice(
        `Loaded ${rows.length} playlist folder${rows.length === 1 ? "" : "s"} and ${catalogResult.rows.length} catalog row${
          catalogResult.rows.length === 1 ? "" : "s"
        } for bulk package presets.`
      );
    } catch (catalogError: any) {
      setPlaylistCatalogRows([]);
      setCatalogRows([]);
      setSelectedBulkPlaylistIds([]);
      setSelectedBulkRelativePaths([]);
      setStreamEntitlements([]);
      const message = catalogError?.message ?? "Failed to load stream catalog.";
      setPlaylistCatalogError(message);
      setCatalogError(message);
      setEntitlementsError(message);
    } finally {
      setPlaylistCatalogLoading(false);
      setCatalogLoading(false);
      setEntitlementsLoading(false);
    }
  }, [buildProof, normalizedHostPubkey, streamIdInput]);

  const queueMissingPlaylistScopes = useCallback(() => {
    if (missingPrivatePlaylistIds.length === 0) {
      setBulkNotice("All private published catalog rows already have active package coverage.");
      setBulkError(null);
      return;
    }
    setSelectedBulkPlaylistIds((prev) => Array.from(new Set([...prev, ...missingPrivatePlaylistIds])));
    setBulkNotice(
      `Queued ${missingPrivatePlaylistIds.length} playlist scope${
        missingPrivatePlaylistIds.length === 1 ? "" : "s"
      } missing private release coverage.`
    );
    setBulkError(null);
  }, [missingPrivatePlaylistIds]);

  const queueMissingFileScopes = useCallback(() => {
    if (missingPrivateRelativePaths.length === 0) {
      setBulkNotice("All private published catalog rows already have active package coverage.");
      setBulkError(null);
      return;
    }
    setSelectedBulkRelativePaths((prev) => Array.from(new Set([...prev, ...missingPrivateRelativePaths])));
    setBulkNotice(
      `Queued ${missingPrivateRelativePaths.length} file scope${
        missingPrivateRelativePaths.length === 1 ? "" : "s"
      } missing private release coverage.`
    );
    setBulkError(null);
  }, [missingPrivateRelativePaths]);

  const queueSinglePlaylistScope = useCallback(
    (playlistId: string) => {
      const normalizedPlaylistId = playlistId.trim();
      if (!PLAYLIST_ID_RE.test(normalizedPlaylistId)) {
        setBulkError("Playlist scope is invalid and cannot be queued.");
        return;
      }
      setBulkError(null);
      setSelectedBulkPlaylistIds((prev) => {
        if (prev.includes(normalizedPlaylistId)) return prev;
        return [...prev, normalizedPlaylistId];
      });
      setBulkNotice(`Queued playlist scope "${normalizedPlaylistId === "__root__" ? "Root files" : normalizedPlaylistId}".`);
    },
    []
  );

  const queueSingleFileScope = useCallback((relativePath: string) => {
    const normalizedRelativePath = normalizeRelativePath(relativePath);
    if (!isValidRelativePath(normalizedRelativePath)) {
      setBulkError("File scope is invalid and cannot be queued.");
      return;
    }
    setBulkError(null);
    setSelectedBulkRelativePaths((prev) => {
      if (prev.includes(normalizedRelativePath)) return prev;
      return [...prev, normalizedRelativePath];
    });
    setBulkNotice(`Queued file scope "${normalizedRelativePath}".`);
  }, []);

  const toggleBulkPlaylist = useCallback((playlistId: string) => {
    setSelectedBulkPlaylistIds((prev) => (prev.includes(playlistId) ? prev.filter((value) => value !== playlistId) : [...prev, playlistId]));
  }, []);

  const selectAllBulkPlaylists = useCallback(() => {
    setSelectedBulkPlaylistIds(playlistCatalogRows.map((row) => row.id));
  }, [playlistCatalogRows]);

  const clearBulkPlaylistSelection = useCallback(() => {
    setSelectedBulkPlaylistIds([]);
  }, []);

  const clearBulkRelativePathSelection = useCallback(() => {
    setSelectedBulkRelativePaths([]);
  }, []);

  const preparePlaylistPackageDraft = useCallback(
    (playlistRow: VodPlaylistCatalogRow) => {
      const streamId = streamIdInput.trim();
      if (!STREAM_ID_RE.test(streamId)) {
        setBulkError("Enter a valid stream id before creating a playlist package draft.");
        return;
      }

      const existing = streamPlaylistPackagesById.get(playlistRow.id);
      if (existing) {
        applyPackageToForm(existing);
        setNotice(`Loaded existing package for "${playlistRow.id === "__root__" ? "Root files" : playlistRow.id}".`);
        return;
      }

      const playlistLabel = playlistRow.id === "__root__" ? "Root files" : playlistRow.id;
      const parsedDuration = parsePositiveInt(bulkDurationHoursInput) ?? bulkPresetConfig.durationHours;
      setEditingPackageId(null);
      setStreamIdInput(streamId);
      setPlaylistIdInput(playlistRow.id);
      setRelativePathInput("");
      setTitleInput(`${streamId} · ${playlistLabel} · ${bulkPresetConfig.titleSuffix}`);
      setDescriptionInput(`Playlist package for ${playlistLabel}.`);
      if (!paymentAmountInput.trim()) {
        setPaymentAmountInput(bulkAmountInput.trim() || bulkPresetConfig.amountHint);
      }
      setDurationHoursInput(String(parsedDuration));
      setStatusInput("active");
      setVisibilityInput("public");
      setNotice(`Prepared draft package for "${playlistLabel}". Save it in the package form above.`);
    },
    [
      applyPackageToForm,
      bulkAmountInput,
      bulkDurationHoursInput,
      bulkPresetConfig.amountHint,
      bulkPresetConfig.durationHours,
      bulkPresetConfig.titleSuffix,
      paymentAmountInput,
      streamIdInput,
      streamPlaylistPackagesById
    ]
  );

  const applyBulkPreset = useCallback(async () => {
    setBulkError(null);
    setBulkNotice(null);
    setError(null);
    setNotice(null);
    if (!normalizedHostPubkey) {
      setBulkError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const streamId = streamIdInput.trim();
    if (!STREAM_ID_RE.test(streamId)) {
      setBulkError("Stream ID must use letters, digits, '-' or '_' (max 128 chars).");
      return;
    }
    const durationHours = parsePositiveInt(bulkDurationHoursInput);
    if (!durationHours) {
      setBulkError("Preset duration hours must be a positive integer.");
      return;
    }
    const amount = bulkAmountInput.trim();
    if (!amount) {
      setBulkError("Preset price amount is required.");
      return;
    }
    if (selectedBulkPlaylistIds.length === 0) {
      setBulkError("Select at least one playlist folder for bulk package creation.");
      return;
    }

    setBulkBusy(true);
    try {
      const proof = await buildProof();
      const titlePrefix = bulkTitlePrefixInput.trim() || streamId;
      const existingByPlaylist = new Map<string, VodAccessPackage>();
      for (const row of packages) {
        if (row.streamId !== streamId) continue;
        if (!row.playlistId || row.relativePath) continue;
        const existing = existingByPlaylist.get(row.playlistId);
        if (!existing || row.updatedAtSec > existing.updatedAtSec) {
          existingByPlaylist.set(row.playlistId, row);
        }
      }

      const updatedRows: VodAccessPackage[] = [];
      const failed: Array<{ playlistId: string; reason: string }> = [];

      for (const playlistId of selectedBulkPlaylistIds) {
        const playlistLabel = playlistId === "__root__" ? "root" : playlistId;
        try {
          const result = await upsertVodAccessPackageClient({
            hostPubkey: normalizedHostPubkey,
            packageId: existingByPlaylist.get(playlistId)?.id,
            streamId,
            playlistId,
            title: `${titlePrefix} · ${playlistLabel} · ${bulkPresetConfig.titleSuffix}`,
            description: `Playlist package for ${playlistLabel}.`,
            paymentAsset,
            paymentAmount: amount,
            paymentRailId: paymentRailIdInput.trim() || undefined,
            durationHours,
            status: "active",
            visibility: visibilityInput,
            metadata: { purchasePolicy: purchasePolicyInput },
            operatorProofEvent: proof
          });
          updatedRows.push(result.package);
        } catch (applyError: any) {
          failed.push({ playlistId, reason: applyError?.message ?? "unknown error" });
        }
      }

      if (updatedRows.length > 0) {
        setPackages((prev) => {
          const byId = new Map(prev.map((row) => [row.id, row]));
          for (const row of updatedRows) byId.set(row.id, row);
          return Array.from(byId.values()).sort((left, right) => right.updatedAtSec - left.updatedAtSec);
        });
      }

      if (failed.length > 0) {
        setBulkError(`Bulk preset completed with ${failed.length} failure${failed.length === 1 ? "" : "s"} (first: ${failed[0]?.playlistId}).`);
      }
      setBulkNotice(
        `Bulk preset applied to ${updatedRows.length} playlist${updatedRows.length === 1 ? "" : "s"} (${failed.length} failed).`
      );
    } finally {
      setBulkBusy(false);
    }
  }, [
    buildProof,
    bulkAmountInput,
    bulkDurationHoursInput,
    bulkPresetConfig.titleSuffix,
    bulkTitlePrefixInput,
    normalizedHostPubkey,
    packages,
    paymentAsset,
    paymentRailIdInput,
    purchasePolicyInput,
    selectedBulkPlaylistIds,
    streamIdInput,
    visibilityInput
  ]);

  const applyBulkFilePreset = useCallback(async () => {
    setBulkError(null);
    setBulkNotice(null);
    setError(null);
    setNotice(null);
    if (!normalizedHostPubkey) {
      setBulkError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const streamId = streamIdInput.trim();
    if (!STREAM_ID_RE.test(streamId)) {
      setBulkError("Stream ID must use letters, digits, '-' or '_' (max 128 chars).");
      return;
    }
    const durationHours = parsePositiveInt(bulkDurationHoursInput);
    if (!durationHours) {
      setBulkError("Preset duration hours must be a positive integer.");
      return;
    }
    const amount = bulkAmountInput.trim();
    if (!amount) {
      setBulkError("Preset price amount is required.");
      return;
    }
    if (selectedBulkRelativePaths.length === 0) {
      setBulkError("Select at least one file scope for bulk file package creation.");
      return;
    }

    setBulkBusy(true);
    try {
      const proof = await buildProof();
      const titlePrefix = bulkTitlePrefixInput.trim() || streamId;
      const existingByRelativePath = new Map<string, VodAccessPackage>();
      for (const row of packages) {
        if (row.streamId !== streamId) continue;
        if (!row.relativePath || row.playlistId) continue;
        const existing = existingByRelativePath.get(row.relativePath);
        if (!existing || row.updatedAtSec > existing.updatedAtSec) {
          existingByRelativePath.set(row.relativePath, row);
        }
      }

      const updatedRows: VodAccessPackage[] = [];
      const failed: Array<{ relativePath: string; reason: string }> = [];

      for (const relativePath of selectedBulkRelativePaths) {
        const normalizedRelativePath = normalizeRelativePath(relativePath);
        if (!isValidRelativePath(normalizedRelativePath)) {
          failed.push({ relativePath, reason: "invalid relative path" });
          continue;
        }
        const fileLabel = normalizedRelativePath.split("/").at(-1) ?? normalizedRelativePath;
        try {
          const result = await upsertVodAccessPackageClient({
            hostPubkey: normalizedHostPubkey,
            packageId: existingByRelativePath.get(normalizedRelativePath)?.id,
            streamId,
            relativePath: normalizedRelativePath,
            title: `${titlePrefix} · ${fileLabel} · ${bulkPresetConfig.titleSuffix}`,
            description: `File package for ${normalizedRelativePath}.`,
            paymentAsset,
            paymentAmount: amount,
            paymentRailId: paymentRailIdInput.trim() || undefined,
            durationHours,
            status: "active",
            visibility: visibilityInput,
            metadata: { purchasePolicy: purchasePolicyInput },
            operatorProofEvent: proof
          });
          updatedRows.push(result.package);
        } catch (applyError: any) {
          failed.push({ relativePath: normalizedRelativePath, reason: applyError?.message ?? "unknown error" });
        }
      }

      if (updatedRows.length > 0) {
        setPackages((prev) => {
          const byId = new Map(prev.map((row) => [row.id, row]));
          for (const row of updatedRows) byId.set(row.id, row);
          return Array.from(byId.values()).sort((left, right) => right.updatedAtSec - left.updatedAtSec);
        });
      }

      if (failed.length > 0) {
        setBulkError(
          `File preset completed with ${failed.length} failure${failed.length === 1 ? "" : "s"} (first: ${failed[0]?.relativePath}).`
        );
      }
      setBulkNotice(
        `File preset applied to ${updatedRows.length} file scope${updatedRows.length === 1 ? "" : "s"} (${failed.length} failed).`
      );
    } finally {
      setBulkBusy(false);
    }
  }, [
    buildProof,
    bulkAmountInput,
    bulkDurationHoursInput,
    bulkPresetConfig.titleSuffix,
    bulkTitlePrefixInput,
    normalizedHostPubkey,
    packages,
    paymentAsset,
    paymentRailIdInput,
    purchasePolicyInput,
    selectedBulkRelativePaths,
    streamIdInput,
    visibilityInput
  ]);

  const savePackage = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!normalizedHostPubkey) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    const streamId = streamIdInput.trim();
    if (!STREAM_ID_RE.test(streamId)) {
      setError("Stream ID must use letters, digits, '-' or '_' (max 128 chars).");
      return;
    }
    const playlistId = playlistIdInput.trim();
    const relativePath = normalizeRelativePath(relativePathInput);
    if (playlistId && !PLAYLIST_ID_RE.test(playlistId)) {
      setError("Playlist ID must use letters, digits, '.', '-', '_' or __root__.");
      return;
    }
    if (relativePath && !isValidRelativePath(relativePath)) {
      setError("Relative file path must use slash-separated safe segments (letters/digits/._-).");
      return;
    }
    if (playlistId && relativePath) {
      setError("Choose one package scope only: playlist or relative file path.");
      return;
    }
    const title = titleInput.trim();
    if (!title) {
      setError("Package title is required.");
      return;
    }
    const amount = paymentAmountInput.trim();
    if (!amount) {
      setError("Price amount is required.");
      return;
    }
    const durationHours = parsePositiveInt(durationHoursInput);
    if (!durationHours) {
      setError("Duration hours must be a positive integer.");
      return;
    }

    setIsSaving(true);
    try {
      const proof = await buildProof();
      const result = await upsertVodAccessPackageClient({
        hostPubkey: normalizedHostPubkey,
        packageId: editingPackageId ?? undefined,
        streamId,
        playlistId: playlistId || undefined,
        relativePath: relativePath || undefined,
        title,
        description: descriptionInput.trim() || undefined,
        paymentAsset,
        paymentAmount: amount,
        paymentRailId: paymentRailIdInput.trim() || undefined,
        durationHours,
        status: statusInput,
        visibility: visibilityInput,
        metadata: { purchasePolicy: purchasePolicyInput },
        operatorProofEvent: proof
      });
      setPackages((prev) => {
        const next = [result.package, ...prev.filter((row) => row.id !== result.package.id)];
        return next.sort((a, b) => b.updatedAtSec - a.updatedAtSec);
      });
      setEditingPackageId(result.package.id);
      setNotice(`Saved package "${result.package.title}".`);
    } catch (saveError: any) {
      setError(saveError?.message ?? "Failed to save package.");
    } finally {
      setIsSaving(false);
    }
  }, [
    buildProof,
    descriptionInput,
    durationHoursInput,
    editingPackageId,
    normalizedHostPubkey,
    paymentAmountInput,
    paymentAsset,
    paymentRailIdInput,
    purchasePolicyInput,
    playlistIdInput,
    relativePathInput,
    statusInput,
    streamIdInput,
    titleInput,
    visibilityInput
  ]);

  const disablePackage = useCallback(
    async (row: VodAccessPackage) => {
      if (!normalizedHostPubkey) {
        setError("Host pubkey must be a valid npub or 64-hex pubkey.");
        return;
      }
      const confirmed = window.confirm(`Disable package "${row.title}"?`);
      if (!confirmed) return;
      setError(null);
      setNotice(null);
      setDeleteBusyId(row.id);
      try {
        const proof = await buildProof();
        const result = await disableVodAccessPackageClient({
          hostPubkey: normalizedHostPubkey,
          packageId: row.id,
          operatorProofEvent: proof
        });
        setPackages((prev) => prev.map((entry) => (entry.id === row.id ? result.package : entry)));
        setNotice(`Disabled package "${result.package.title}".`);
      } catch (disableError: any) {
        setError(disableError?.message ?? "Failed to disable package.");
      } finally {
        setDeleteBusyId(null);
      }
    },
    [buildProof, normalizedHostPubkey]
  );

  const enablePackage = useCallback(
    async (row: VodAccessPackage) => {
      if (!normalizedHostPubkey) {
        setError("Host pubkey must be a valid npub or 64-hex pubkey.");
        return;
      }
      setError(null);
      setNotice(null);
      setEnableBusyId(row.id);
      try {
        const proof = await buildProof();
        const result = await upsertVodAccessPackageClient({
          hostPubkey: normalizedHostPubkey,
          packageId: row.id,
          streamId: row.streamId,
          playlistId: row.playlistId,
          relativePath: row.relativePath,
          title: row.title,
          description: row.description,
          paymentAsset: row.paymentAsset,
          paymentAmount: row.paymentAmount,
          paymentRailId: row.paymentRailId,
          durationHours: row.durationHours,
          status: "active",
          visibility: row.visibility,
          operatorProofEvent: proof
        });
        setPackages((prev) => prev.map((entry) => (entry.id === row.id ? result.package : entry)));
        setNotice(`Enabled package "${result.package.title}".`);
      } catch (enableError: any) {
        setError(enableError?.message ?? "Failed to enable package.");
      } finally {
        setEnableBusyId(null);
      }
    },
    [buildProof, normalizedHostPubkey]
  );

  const duplicatePackageToDraft = useCallback((row: VodAccessPackage) => {
    setEditingPackageId(null);
    setStreamIdInput(row.streamId);
    setPlaylistIdInput(row.playlistId ?? "");
    setRelativePathInput(row.relativePath ?? "");
    setTitleInput(`${row.title} (copy)`);
    setDescriptionInput(row.description ?? "");
    setPaymentAsset(row.paymentAsset);
    setPaymentAmountInput(row.paymentAmount);
    setPaymentRailIdInput(row.paymentRailId ?? "");
    setDurationHoursInput(String(row.durationHours));
    setPurchasePolicyInput(getVodPurchasePolicyFromMetadata(row.metadata));
    setStatusInput("disabled");
    setVisibilityInput(row.visibility);
    setNotice(`Prepared duplicate draft from "${row.title}". Save to create a new package.`);
  }, []);

  const testPurchase = useCallback(
    async (row: VodAccessPackage) => {
      if (!identity?.pubkey || !normalizedHostPubkey) {
        setError("Connect identity to run a purchase self-test.");
        return;
      }
      setError(null);
      setNotice(null);
      setPurchaseBusyId(row.id);
      try {
        const buyerProof = await buildAccessPurchaseProof(signEvent, identity.pubkey, {
          hostPubkey: row.hostPubkey,
          packageId: row.id
        });
        if (!buyerProof) throw new Error("Failed to sign purchase proof.");
        const adminProof = await buildAccessAdminProof(signEvent, identity.pubkey, row.hostPubkey);
        if (!adminProof) throw new Error("Failed to sign admin proof.");

        const result = await purchaseVodAccessPackageClient({
          packageId: row.id,
          buyerProofEvent: buyerProof,
          operatorProofEvent: adminProof,
          verifiedByOperator: true,
          sourceRef: `settings-self-test:${Date.now()}`,
          metadata: { origin: "settings_self_test" }
        });
        setNotice(
          `${result.granted ? "Granted" : "Reused"} ${row.title} for ${shortHost(identity.pubkey)} (${result.purchase.source}).`
        );
      } catch (purchaseError: any) {
        setError(purchaseError?.message ?? "Failed to run purchase self-test.");
      } finally {
        setPurchaseBusyId(null);
      }
    },
    [identity?.pubkey, normalizedHostPubkey, signEvent]
  );

  const issuePackageUnlock = useCallback(
    async (row: VodAccessPackage) => {
      if (!identity?.pubkey) {
        setError("Connect identity to grant package access.");
        return;
      }
      if (!normalizedGrantSubjectPubkey) {
        setError("Grant subject must be a valid npub or 64-hex pubkey.");
        return;
      }
      if (!grantDurationHours) {
        setError("Grant duration hours must be a positive integer.");
        return;
      }

      setError(null);
      setNotice(null);
      setGrantBusyPackageId(row.id);
      try {
        const operatorProofEvent = await buildAccessAdminProof(signEvent, identity.pubkey, row.hostPubkey);
        if (!operatorProofEvent) throw new Error("Failed to sign access admin proof.");
        const startsAtSec = Math.floor(Date.now() / 1000);
        const result = await grantAccessEntitlementClient({
          hostPubkey: row.hostPubkey,
          subjectPubkey: normalizedGrantSubjectPubkey,
          resourceId: row.resourceId,
          actions: ["watch_vod"],
          source: "manual_grant",
          sourceRef: `package:${row.id}:manual:${startsAtSec}`,
          startsAtSec,
          expiresAtSec: startsAtSec + grantDurationHours * 3600,
          metadata: {
            packageId: row.id,
            packageTitle: row.title,
            streamId: row.streamId,
            playlistId: row.playlistId ?? null,
            relativePath: row.relativePath ?? null,
            issuedFrom: "vod_packages_panel"
          },
          operatorProofEvent
        });
        setStreamEntitlements((prev) => [result.entitlement, ...prev.filter((entry) => entry.id !== result.entitlement.id)]);
        setEntitlementsError(null);
        setNotice(`Issued "${row.title}" unlock to ${shortHost(normalizedGrantSubjectPubkey)} for ${grantDurationHours}h.`);
      } catch (grantError: any) {
        setError(grantError?.message ?? "Failed to grant package access.");
      } finally {
        setGrantBusyPackageId(null);
      }
    },
    [grantDurationHours, identity?.pubkey, normalizedGrantSubjectPubkey, signEvent]
  );

  if (!identity) {
    return (
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">VOD Access Packages</h2>
        <p className="text-sm text-neutral-500">Connect an identity to publish and manage paid VOD packages.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-200">VOD Access Packages</h2>
        <p className="text-xs text-neutral-500 mt-1">
          Publish reusable paid access products (stream-wide, playlist, or single-file scope). Purchases mint entitlement records for watch access.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-2">
          <input
            value={hostInput}
            onChange={(event) => setHostInput(event.target.value)}
            placeholder="Host pubkey (npub or 64-hex)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void loadPackages()}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            {isLoading ? "Loading…" : "Load packages"}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            value={streamIdInput}
            onChange={(event) => setStreamIdInput(event.target.value)}
            placeholder="Stream ID"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <input
            value={playlistIdInput}
            onChange={(event) => setPlaylistIdInput(event.target.value)}
            placeholder="Playlist ID (optional, folder or __root__)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <input
            value={relativePathInput}
            onChange={(event) => setRelativePathInput(event.target.value)}
            placeholder="Relative file path (optional, e.g. season1/ep01.mp4)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={titleInput}
            onChange={(event) => setTitleInput(event.target.value)}
            placeholder="Package title"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            value={descriptionInput}
            onChange={(event) => setDescriptionInput(event.target.value)}
            placeholder="Description (optional)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select
            value={paymentAsset}
            onChange={(event) => setPaymentAsset(event.target.value as StreamPaymentAsset)}
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          >
            {STREAM_PAYMENT_ASSETS.map((asset) => (
              <option key={asset} value={asset}>
                {asset.toUpperCase()}
              </option>
            ))}
          </select>
          <input
            value={paymentAmountInput}
            onChange={(event) => setPaymentAmountInput(event.target.value)}
            placeholder="Price amount"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <input
            value={durationHoursInput}
            onChange={(event) => setDurationHoursInput(event.target.value)}
            placeholder="Duration hours"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <input
            value={paymentRailIdInput}
            onChange={(event) => setPaymentRailIdInput(event.target.value)}
            placeholder="Rail ID (optional)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select
            value={purchasePolicyInput}
            onChange={(event) => setPurchasePolicyInput(event.target.value as VodPurchasePolicy)}
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          >
            {VOD_PURCHASE_POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {getVodPurchasePolicyLabel(policy)}
              </option>
            ))}
          </select>
          <select
            value={statusInput}
            onChange={(event) => setStatusInput(event.target.value as VodAccessPackageStatus)}
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          >
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
          <select
            value={visibilityInput}
            onChange={(event) => setVisibilityInput(event.target.value as VodAccessPackageVisibility)}
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-neutral-500">
            {normalizedHostPubkey ? (
              <span>
                Host: <span className="text-neutral-300 font-mono">{shortHost(normalizedHostPubkey)}</span>
              </span>
            ) : (
              "Enter a valid host pubkey to manage packages."
            )}
          </div>
          <div className="text-[11px] text-neutral-500">
            Purchase policy: <span className="text-neutral-300">{getVodPurchasePolicyLabel(purchasePolicyInput)}</span>
          </div>
          <div className="flex items-center gap-2">
            {editingPackageId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
              >
                New package
              </button>
            )}
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void savePackage()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium disabled:opacity-50"
            >
              <PackagePlus className="w-4 h-4" />
              {isSaving ? "Saving…" : editingPackageId ? "Update package" : "Create package"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Playlist pricing presets (bulk)</div>
        <p className="text-xs text-neutral-500">
          Build/update one package per playlist folder for a stream. Uses current payment rail settings from the package form above.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-2">
          <input
            value={streamIdInput}
            onChange={(event) => setStreamIdInput(event.target.value)}
            placeholder="Stream ID for bulk presets"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <button
            type="button"
            disabled={playlistCatalogLoading}
            onClick={() => void loadPlaylistCatalog()}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            {playlistCatalogLoading || catalogLoading ? "Loading stream catalog…" : "Load playlists + catalog"}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 px-2.5 py-2">
          <div className="text-[11px] text-neutral-500">
            Release status: <span className="text-neutral-300">{releaseSummary.publishedEntries}</span> published ·{" "}
            <span className="text-neutral-300">{releaseSummary.privatePublishedEntries}</span> private published ·{" "}
            <span className="text-emerald-300">{releaseSummary.privatePublishedCoveredEntries}</span> priced ·{" "}
            <span className={releaseSummary.privatePublishedMissingEntries > 0 ? "text-amber-300" : "text-neutral-300"}>
              {releaseSummary.privatePublishedMissingEntries}
            </span>{" "}
            missing package
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={queueMissingPlaylistScopes}
              className="px-2.5 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-xs text-amber-200"
            >
              Queue missing playlists
            </button>
            <button
              type="button"
              onClick={queueMissingFileScopes}
              className="px-2.5 py-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/20 hover:bg-indigo-500/30 text-xs text-indigo-200"
            >
              Queue missing files
            </button>
          </div>
        </div>
        <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-2.5">
          <div className="text-[11px] text-neutral-500">
            Access matrix: <span className="text-neutral-300">{privatePublishedAccessSummary.total}</span> private published ·{" "}
            <span className="text-emerald-300">{privatePublishedAccessSummary.priced}</span> priced ·{" "}
            <span className="text-blue-300">{privatePublishedAccessSummary.unlocked}</span> unlocked scope{" "}
            {privatePublishedAccessSummary.unlocked === 1 ? "" : "rows"} ·{" "}
            <span className="text-neutral-300">{privatePublishedAccessSummary.uniqueViewers}</span> unique viewers
          </div>
          {entitlementsLoading ? (
            <div className="text-[11px] text-neutral-500">Loading active entitlement matrix…</div>
          ) : privatePublishedAccessRows.length === 0 ? (
            <div className="text-[11px] text-neutral-500">No private published catalog rows yet.</div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-auto">
              {privatePublishedAccessRows.slice(0, 40).map((row) => (
                <div
                  key={row.relativePath}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950/50 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-neutral-200 truncate">{row.fileName}</div>
                    <div className="text-[11px] text-neutral-500 font-mono truncate" title={row.relativePath}>
                      {row.relativePath}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span
                      className={`px-1.5 py-0.5 rounded border ${
                        row.hasPackageCoverage
                          ? "border-emerald-600/30 bg-emerald-950/30 text-emerald-300"
                          : "border-amber-600/30 bg-amber-950/30 text-amber-300"
                      }`}
                    >
                      {row.hasPackageCoverage ? "priced" : "unpriced"}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded border ${
                        row.activeEntitlementCount > 0
                          ? "border-blue-600/30 bg-blue-950/30 text-blue-300"
                          : "border-neutral-700 bg-neutral-900 text-neutral-400"
                      }`}
                    >
                      unlocks {row.activeEntitlementCount}
                    </span>
                    <span className="text-neutral-500">
                      viewers {row.uniqueViewerCount}
                    </span>
                    <span className="px-1.5 py-0.5 rounded border border-neutral-700 bg-neutral-900 text-neutral-400 font-mono">
                      stream {row.entitlementScopeCounts.stream}
                    </span>
                    <span className="px-1.5 py-0.5 rounded border border-neutral-700 bg-neutral-900 text-neutral-400 font-mono">
                      playlist {row.entitlementScopeCounts.playlist}
                    </span>
                    <span className="px-1.5 py-0.5 rounded border border-neutral-700 bg-neutral-900 text-neutral-400 font-mono">
                      file {row.entitlementScopeCounts.file}
                    </span>
                    {!row.hasPackageCoverage ? (
                      <>
                        <button
                          type="button"
                          onClick={() => queueSinglePlaylistScope(row.playlistId)}
                          className={`px-1.5 py-0.5 rounded border text-[11px] ${
                            selectedBulkPlaylistSet.has(row.playlistId)
                              ? "border-blue-600/40 bg-blue-950/30 text-blue-300"
                              : "border-blue-700/40 bg-blue-950/20 text-blue-200 hover:bg-blue-950/30"
                          }`}
                        >
                          {selectedBulkPlaylistSet.has(row.playlistId) ? "playlist queued" : "queue playlist"}
                        </button>
                        <button
                          type="button"
                          onClick={() => queueSingleFileScope(row.relativePath)}
                          className={`px-1.5 py-0.5 rounded border text-[11px] ${
                            selectedBulkRelativePathSet.has(row.relativePath)
                              ? "border-indigo-600/40 bg-indigo-950/30 text-indigo-300"
                              : "border-indigo-700/40 bg-indigo-950/20 text-indigo-200 hover:bg-indigo-950/30"
                          }`}
                        >
                          {selectedBulkRelativePathSet.has(row.relativePath) ? "file queued" : "queue file"}
                        </button>
                        {playlistCatalogById.has(row.playlistId) ? (
                          <button
                            type="button"
                            onClick={() => preparePlaylistPackageDraft(playlistCatalogById.get(row.playlistId)!)}
                            className="px-1.5 py-0.5 rounded border border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 text-[11px]"
                          >
                            draft package
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select
            value={bulkPreset}
            onChange={(event) => setBulkPreset(event.target.value as BulkPreset)}
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          >
            {(Object.keys(BULK_PRESETS) as BulkPreset[]).map((preset) => (
              <option key={preset} value={preset}>
                {BULK_PRESETS[preset].label}
              </option>
            ))}
          </select>
          <input
            value={bulkTitlePrefixInput}
            onChange={(event) => setBulkTitlePrefixInput(event.target.value)}
            placeholder="Title prefix (optional)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            value={bulkAmountInput}
            onChange={(event) => setBulkAmountInput(event.target.value)}
            placeholder="Preset price amount"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <input
            value={bulkDurationHoursInput}
            onChange={(event) => setBulkDurationHoursInput(event.target.value)}
            placeholder="Preset duration hours"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="text-[11px] text-neutral-500">
          {playlistCatalogRows.length === 0
            ? "Load playlist folders to select package scope."
            : `${playlistCatalogRows.length} folder${playlistCatalogRows.length === 1 ? "" : "s"} loaded · ${
                selectedBulkPlaylistIds.length
              } selected`}
          {catalogRows.length > 0
            ? ` · ${catalogRows.length} catalog row${catalogRows.length === 1 ? "" : "s"}`
            : ""}
          {selectedBulkRelativePaths.length > 0
            ? ` · ${selectedBulkRelativePaths.length} file scope${selectedBulkRelativePaths.length === 1 ? "" : "s"} selected`
            : ""}
        </div>
        {playlistCatalogRows.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={selectAllBulkPlaylists}
                className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearBulkPlaylistSelection}
                className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
              >
                Clear
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {playlistCatalogRows.map((row) => {
                const selected = selectedBulkPlaylistSet.has(row.id);
                const label = row.id === "__root__" ? "Root files" : row.id;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => toggleBulkPlaylist(row.id)}
                    className={`inline-flex items-center px-2.5 py-1.5 rounded-lg border text-xs ${
                      selected
                        ? "bg-blue-600/20 border-blue-500 text-blue-200"
                        : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800"
                    }`}
                    title={`${label} (${row.fileCount} file${row.fileCount === 1 ? "" : "s"})`}
                  >
                    {label} ({row.fileCount})
                  </button>
                );
              })}
            </div>
            <div className="space-y-1.5">
              {playlistCatalogRows.map((row) => {
                const existing = streamPlaylistPackagesById.get(row.id);
                const label = row.id === "__root__" ? "Root files" : row.id;
                return (
                  <div key={`draft-${row.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950/50 px-2.5 py-2">
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-200 truncate">{label}</div>
                      <div className="text-[11px] text-neutral-500 truncate">
                        {existing
                          ? `${existing.paymentAmount} ${existing.paymentAsset.toUpperCase()} · ${formatDuration(existing.durationHours)} · ${existing.status}`
                          : "No playlist package yet"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => preparePlaylistPackageDraft(row)}
                      className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                    >
                      {existing ? "Edit package" : "Create draft"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {selectedBulkRelativePaths.length > 0 && (
          <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950/50 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-neutral-400">Imported file scopes ({selectedBulkRelativePaths.length})</div>
              <button
                type="button"
                onClick={clearBulkRelativePathSelection}
                className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
              >
                Clear file scopes
              </button>
            </div>
            <div className="max-h-28 overflow-auto flex flex-wrap gap-1.5">
              {selectedBulkRelativePaths.map((relativePath) => (
                <span
                  key={relativePath}
                  className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-300 font-mono"
                  title={relativePath}
                >
                  {relativePath}
                </span>
              ))}
            </div>
          </div>
        )}
        {playlistCatalogError && <div className="text-xs text-amber-300">{playlistCatalogError}</div>}
        {catalogError && <div className="text-xs text-amber-300">{catalogError}</div>}
        {entitlementsError && <div className="text-xs text-amber-300">{entitlementsError}</div>}
        {bulkError && <div className="text-xs text-red-300">{bulkError}</div>}
        {bulkNotice && <div className="text-xs text-emerald-300">{bulkNotice}</div>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-neutral-500">
            Preset: <span className="text-neutral-300">{bulkPresetConfig.label}</span> · Visibility:{" "}
            <span className="text-neutral-300">{visibilityInput}</span> · Asset:{" "}
            <span className="text-neutral-300 uppercase">{paymentAsset}</span> · Policy:{" "}
            <span className="text-neutral-300">{getVodPurchasePolicyLabel(purchasePolicyInput)}</span>
          </div>
          <button
            type="button"
            disabled={bulkBusy || selectedBulkPlaylistIds.length === 0}
            onClick={() => void applyBulkPreset()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium disabled:opacity-50"
          >
            <PackagePlus className="w-4 h-4" />
            {bulkBusy ? "Applying…" : "Apply playlist preset"}
          </button>
          <button
            type="button"
            disabled={bulkBusy || selectedBulkRelativePaths.length === 0}
            onClick={() => void applyBulkFilePreset()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50"
          >
            <PackagePlus className="w-4 h-4" />
            {bulkBusy ? "Applying…" : "Apply file preset"}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-300">{error}</div>}
      {notice && <div className="text-xs text-emerald-300">{notice}</div>}

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Manual unlock issue</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_12rem_auto] gap-2">
          <input
            value={grantSubjectInput}
            onChange={(event) => setGrantSubjectInput(event.target.value)}
            placeholder="Viewer pubkey (npub or 64-hex)"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <input
            value={grantDurationHoursInput}
            onChange={(event) => setGrantDurationHoursInput(event.target.value)}
            placeholder="Duration hours"
            className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
          />
          <div className="flex items-center text-[11px] text-neutral-500">
            {normalizedGrantSubjectPubkey ? (
              <span>
                Target: <span className="text-neutral-300 font-mono">{shortHost(normalizedGrantSubjectPubkey)}</span>
              </span>
            ) : (
              "Set viewer pubkey + duration, then use Issue unlock on a package row."
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-neutral-950/30 px-3 py-2">
        <div className="text-[11px] text-neutral-500">
          Showing {visiblePackages.length} / {packages.length} package{packages.length === 1 ? "" : "s"}
          {normalizedStreamIdInput ? (
            <>
              {" "}for stream <span className="font-mono text-neutral-300">{normalizedStreamIdInput}</span>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowOnlyCurrentStreamPackages((prev) => !prev)}
          className={`px-2.5 py-1.5 rounded-lg border text-xs ${
            showOnlyCurrentStreamPackages
              ? "bg-blue-600/20 border-blue-500 text-blue-200"
              : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800"
          }`}
        >
          {showOnlyCurrentStreamPackages ? "Current stream only" : "All streams"}
        </button>
      </div>

      {visiblePackages.length === 0 ? (
        <div className="text-sm text-neutral-500">
          {packages.length === 0 ? "No VOD packages loaded for this host." : "No packages in the current stream filter."}
        </div>
      ) : (
        <div className="space-y-2">
          {visiblePackages.map((row) => {
            const purchasePolicy = getVodPurchasePolicyFromMetadata(row.metadata);
            const purchasePolicyLabel = getVodPurchasePolicyLabel(purchasePolicy);
            const purchaseTestDisabled = purchasePolicy === "verified_only";
            const purchaseStats = purchaseStatsByPackageId[row.id];
            const latestPurchaseLabel = formatStatsTimestamp(purchaseStats?.latestPurchaseAtSec);
            const latestGrantLabel = formatStatsTimestamp(purchaseStats?.latestGrantedAtSec);
            return (
            <article key={row.id} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-neutral-200 truncate">{row.title}</div>
                  <div className="text-[11px] text-neutral-500 font-mono break-all">{row.resourceId}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] uppercase ${
                      row.status === "active"
                        ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
                        : "border-neutral-700 bg-neutral-900 text-neutral-400"
                    }`}
                  >
                    {row.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => applyPackageToForm(row)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicatePackageToDraft(row)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200"
                  >
                    <PackagePlus className="w-3.5 h-3.5" />
                    Duplicate
                  </button>
                  {row.status === "active" && (
                    <button
                      type="button"
                      disabled={deleteBusyId === row.id}
                      onClick={() => void disablePackage(row)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-700/40 bg-red-950/20 hover:bg-red-950/30 text-xs text-red-200 disabled:opacity-50"
                    >
                      {deleteBusyId === row.id ? <Ban className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                      {deleteBusyId === row.id ? "Disabling…" : "Disable"}
                    </button>
                  )}
                  {row.status === "disabled" && (
                    <button
                      type="button"
                      disabled={enableBusyId === row.id}
                      onClick={() => void enablePackage(row)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-700/40 bg-emerald-950/20 hover:bg-emerald-950/30 text-xs text-emerald-200 disabled:opacity-50"
                    >
                      <PackagePlus className="w-3.5 h-3.5" />
                      {enableBusyId === row.id ? "Enabling…" : "Enable"}
                    </button>
                  )}
                  {row.status === "active" && (
                    <button
                      type="button"
                      disabled={purchaseBusyId === row.id || purchaseTestDisabled}
                      onClick={() => void testPurchase(row)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs disabled:opacity-50 ${
                        purchaseTestDisabled
                          ? "border-neutral-800 bg-neutral-900/50 text-neutral-500 cursor-not-allowed"
                          : "border-blue-700/40 bg-blue-950/20 hover:bg-blue-950/30 text-blue-200"
                      }`}
                      title={purchaseTestDisabled ? "Verified-settlement-only packages cannot be granted via self-test." : undefined}
                    >
                      <PackagePlus className="w-3.5 h-3.5" />
                      {purchaseBusyId === row.id ? "Granting…" : purchaseTestDisabled ? "Verified only" : "Purchase test"}
                    </button>
                  )}
                  {row.status === "active" && (
                    <button
                      type="button"
                      disabled={grantBusyPackageId === row.id || !normalizedGrantSubjectPubkey || !grantDurationHours}
                      onClick={() => void issuePackageUnlock(row)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-violet-700/40 bg-violet-950/20 hover:bg-violet-950/30 text-xs text-violet-200 disabled:opacity-50"
                      title={!normalizedGrantSubjectPubkey ? "Set a valid viewer pubkey in Manual unlock issue." : undefined}
                    >
                      <ShieldPlus className="w-3.5 h-3.5" />
                      {grantBusyPackageId === row.id ? "Issuing…" : "Issue unlock"}
                    </button>
                  )}
                </div>
              </div>
              <div className="text-[11px] text-neutral-500">
                {row.paymentAsset.toUpperCase()} {row.paymentAmount} · {formatDuration(row.durationHours)} · {row.visibility}
              </div>
              <div className="text-[11px] text-neutral-500">
                Policy: <span className="text-neutral-300">{purchasePolicyLabel}</span>
              </div>
              <div className="text-[11px] text-neutral-500">
                Scope:{" "}
                <span className="font-mono text-neutral-400">
                  {row.relativePath ? `file:${row.relativePath}` : row.playlistId ? `playlist:${row.playlistId}` : "stream:*"}
                </span>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-2.5 py-2 text-[11px] text-neutral-500">
                {purchaseStats ? (
                  <>
                    <div className="text-neutral-300">
                      Purchases {purchaseStats.totalPurchases} · grants {purchaseStats.grantedPurchases} · existing{" "}
                      {purchaseStats.existingPurchases} · viewers {purchaseStats.uniqueViewerCount}
                    </div>
                    <div>
                      Verified {purchaseStats.verifiedPurchases} · unverified {purchaseStats.unverifiedPurchases} · overrides{" "}
                      {purchaseStats.operatorOverridePurchases} · fallback {purchaseStats.unverifiedFallbackPurchases}
                    </div>
                    <div>
                      Last purchase {latestPurchaseLabel ?? "n/a"} · last grant {latestGrantLabel ?? "n/a"}
                    </div>
                  </>
                ) : (
                  <div>No purchase stats yet (or no recent package purchases in retention window).</div>
                )}
              </div>
              {row.description ? <div className="text-xs text-neutral-400">{row.description}</div> : null}
            </article>
          )})}
        </div>
      )}
    </section>
  );
}
