"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw, Save, Trash2 } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import {
  buildAccessAdminProof,
  deleteVideoCatalogEntryClient,
  ingestVideoCatalogEntriesClient,
  listVideoAccessPackagesClient,
  listVideoAnalyticsSummaryClient,
  listVideoCatalogEntriesClient,
  processVideoCatalogHostEntriesClient,
  processVideoCatalogEntriesClient,
  uploadVideoCatalogFileClient,
  upsertVideoCatalogEntryClient,
  type VideoAnalyticsSummaryRow,
  type VideoAccessPackage,
  type VideoCatalogEntry,
  type VideoCatalogListRow,
  type VideoProcessingState,
  type VideoCatalogVisibility
} from "@/lib/access/client";
import {
  buildVideoPricingCoverage,
  summarizeVideoRelease,
  type VideoReleaseEntryInput
} from "@/lib/videoRelease";

const STREAM_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const PLAYLIST_ID_RE = /^(?:__root__|[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})$/;
const RELATIVE_PATH_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const Video_PACKAGE_IMPORT_EVENT = "dstream:video-package-bulk-import";

interface VideoPackageBulkImportDetail {
  hostPubkey: string;
  streamId: string;
  playlistIds: string[];
  relativePaths: string[];
  titlePrefix?: string;
}

interface RowDraft {
  title: string;
  description: string;
  playlistId: string;
  orderIndexText: string;
  visibility: VideoCatalogVisibility;
  processingState: VideoProcessingState;
  processingError: string;
  published: boolean;
  thumbnailUrl: string;
  tagsText: string;
}

interface PrivatePricingGapRow {
  relativePath: string;
  playlistId: string;
  fileName: string;
}
type VideoListSort = "modified_desc" | "modified_asc" | "title_asc";

function formatPubkeyShort(pubkey: string): string {
  const npub = pubkeyHexToNpub(pubkey);
  if (npub) return `${npub.slice(0, 16)}…${npub.slice(-8)}`;
  return `${pubkey.slice(0, 12)}…${pubkey.slice(-8)}`;
}

function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatDurationCompact(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return "0s";
  const seconds = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function draftFromRow(row: VideoCatalogListRow): RowDraft {
  const metadata = row.metadata;
  const fallbackTitle = row.fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || row.fileName;
  return {
    title: metadata?.title ?? fallbackTitle,
    description: metadata?.description ?? "",
    playlistId: metadata?.playlistId ?? "",
    orderIndexText:
      typeof metadata?.orderIndex === "number" && Number.isFinite(metadata.orderIndex)
        ? String(metadata.orderIndex)
        : "",
    visibility: metadata?.visibility ?? "public",
    processingState: metadata?.processingState ?? "ready",
    processingError: metadata?.processingError ?? "",
    published: !!metadata?.publishedAtSec,
    thumbnailUrl: metadata?.thumbnailUrl ?? "",
    tagsText: Array.isArray(metadata?.tags) ? metadata?.tags.join(", ") : ""
  };
}

function parseTagsText(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toLowerCase().replace(/\s+/g, "-"))
    .slice(0, 24);
}

function parseOrderIndexText(raw: string): number | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw new Error("Order must be a whole number.");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000_000) {
    throw new Error("Order must be between 0 and 1,000,000,000.");
  }
  return parsed;
}

function normalizeSearchText(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidRelativePath(raw: string): boolean {
  const normalized = raw.trim().replace(/\\/g, "/");
  if (!normalized) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => RELATIVE_PATH_SEGMENT_RE.test(segment));
}

export function VideoLibraryPanel() {
  const { identity, signEvent } = useIdentity();

  const [hostInput, setHostInput] = useState("");
  const [streamIdInput, setStreamIdInput] = useState("");
  const [rows, setRows] = useState<VideoCatalogListRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [saveBusyPath, setSaveBusyPath] = useState<string | null>(null);
  const [deleteBusyPath, setDeleteBusyPath] = useState<string | null>(null);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestOnlyMissing, setIngestOnlyMissing] = useState(true);
  const [ingestPublished, setIngestPublished] = useState(true);
  const [ingestVisibility, setIngestVisibility] = useState<VideoCatalogVisibility>("public");
  const [ingestProcessingState, setIngestProcessingState] = useState<VideoProcessingState>("ready");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPlaylistId, setUploadPlaylistId] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{ uploadedBytes: number; totalBytes: number } | null>(null);
  const [processBusy, setProcessBusy] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsByPath, setAnalyticsByPath] = useState<Record<string, VideoAnalyticsSummaryRow>>({});
  const [packages, setPackages] = useState<VideoAccessPackage[]>([]);
  const [packageLoadError, setPackageLoadError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [playlistFilterInput, setPlaylistFilterInput] = useState("__all__");
  const [sortMode, setSortMode] = useState<VideoListSort>("modified_desc");
  const [showOnlyUnpublished, setShowOnlyUnpublished] = useState(false);
  const [showOnlyMissingPrivatePricing, setShowOnlyMissingPrivatePricing] = useState(false);
  const [selectedRelativePaths, setSelectedRelativePaths] = useState<string[]>([]);
  const [bulkPlaylistIdInput, setBulkPlaylistIdInput] = useState("");
  const [bulkVisibilityInput, setBulkVisibilityInput] = useState<VideoCatalogVisibility>("public");
  const [bulkSaveBusy, setBulkSaveBusy] = useState(false);
  const [bulkClearBusy, setBulkClearBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!identity?.pubkey) return;
    setHostInput((prev) => (prev.trim() ? prev : identity.pubkey));
  }, [identity?.pubkey]);

  const normalizedHost = useMemo(() => pubkeyParamToHex(hostInput), [hostInput]);
  const normalizedStreamId = useMemo(() => {
    const streamId = streamIdInput.trim();
    if (!streamId) return "";
    return STREAM_ID_RE.test(streamId) ? streamId : "__invalid__";
  }, [streamIdInput]);
  const normalizedSearchInput = useMemo(() => normalizeSearchText(searchInput), [searchInput]);
  const playlistFilterOptions = useMemo(() => {
    const values = new Set<string>();
    for (const row of rows) {
      const draft = drafts[row.relativePath] ?? draftFromRow(row);
      const playlistId = draft.playlistId.trim();
      if (playlistId) values.add(playlistId);
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [drafts, rows]);
  const releaseRows = useMemo<VideoReleaseEntryInput[]>(
    () =>
      rows.map((row) => {
        const draft = drafts[row.relativePath] ?? draftFromRow(row);
        return {
          relativePath: row.relativePath,
          playlistId: draft.playlistId.trim() || undefined,
          visibility: draft.visibility,
          published: draft.published
        };
      }),
    [drafts, rows]
  );
  const releaseCoverageByPath = useMemo(() => buildVideoPricingCoverage(releaseRows, packages), [packages, releaseRows]);
  const releaseSummary = useMemo(() => summarizeVideoRelease(releaseRows, releaseCoverageByPath), [releaseCoverageByPath, releaseRows]);
  const privatePricingGapRows = useMemo<PrivatePricingGapRow[]>(
    () =>
      rows
        .map((row) => {
          const draft = drafts[row.relativePath] ?? draftFromRow(row);
          const isPrivatePublished = draft.published && draft.visibility === "private";
          const hasCoverage = releaseCoverageByPath[row.relativePath]?.hasActiveCoverage === true;
          if (!isPrivatePublished || hasCoverage) return null;
          return {
            relativePath: row.relativePath,
            playlistId: draft.playlistId.trim() || "__root__",
            fileName: row.fileName
          };
        })
        .filter((row): row is PrivatePricingGapRow => !!row),
    [drafts, releaseCoverageByPath, rows]
  );
  const filteredRows = useMemo(() => {
    const next = rows.filter((row) => {
      const draft = drafts[row.relativePath] ?? draftFromRow(row);
      if (showOnlyUnpublished && draft.published) return false;
      if (showOnlyMissingPrivatePricing) {
        const isPrivatePublished = draft.published && draft.visibility === "private";
        const hasCoverage = releaseCoverageByPath[row.relativePath]?.hasActiveCoverage === true;
        if (!(isPrivatePublished && !hasCoverage)) return false;
      }
      if (playlistFilterInput !== "__all__" && draft.playlistId.trim() !== playlistFilterInput) return false;
      if (!normalizedSearchInput) return true;
      const text = [
        row.relativePath,
        row.fileName,
        draft.title,
        draft.description,
        draft.playlistId,
        draft.tagsText
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(normalizedSearchInput);
    });

    next.sort((left, right) => {
      const leftDraft = drafts[left.relativePath] ?? draftFromRow(left);
      const rightDraft = drafts[right.relativePath] ?? draftFromRow(right);
      if (sortMode === "title_asc") {
        return leftDraft.title.localeCompare(rightDraft.title);
      }
      if (sortMode === "modified_asc") {
        return left.fileModifiedAtMs - right.fileModifiedAtMs;
      }
      return right.fileModifiedAtMs - left.fileModifiedAtMs;
    });
    return next;
  }, [
    drafts,
    normalizedSearchInput,
    playlistFilterInput,
    releaseCoverageByPath,
    rows,
    showOnlyMissingPrivatePricing,
    showOnlyUnpublished,
    sortMode
  ]);
  const selectedRelativePathSet = useMemo(() => new Set(selectedRelativePaths), [selectedRelativePaths]);
  const visibleRows = useMemo(() => filteredRows.slice(0, 120), [filteredRows]);

  const buildProof = useCallback(async () => {
    if (!normalizedHost) throw new Error("Host pubkey must be a valid npub or 64-hex pubkey.");
    if (!identity?.pubkey) throw new Error("Connect identity to curate Video entries.");
    const proof = await buildAccessAdminProof(signEvent, identity.pubkey, normalizedHost);
    if (!proof) throw new Error("Failed to sign Video admin proof.");
    return proof;
  }, [identity?.pubkey, normalizedHost, signEvent]);

  const loadRows = useCallback(async () => {
    setError(null);
    setNotice(null);
    setPackageLoadError(null);
    if (!normalizedHost) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
      setError("Stream ID is required and must match letters/digits/_/-.");
      return;
    }

    setIsLoading(true);
    setAnalyticsLoading(true);
    try {
      const proof = await buildProof();
      const [result, analyticsResult, packageResult] = await Promise.all([
        listVideoCatalogEntriesClient({
          hostPubkey: normalizedHost,
          streamId: normalizedStreamId,
          operatorProofEvent: proof,
          adminRows: true,
          includePrivate: true,
          includeUnlisted: true,
          includeUnpublished: true,
          curatedOnly: false
        }),
        listVideoAnalyticsSummaryClient({
          hostPubkey: normalizedHost,
          streamId: normalizedStreamId,
          operatorProofEvent: proof,
          limit: 2000
        }).catch(() => null),
        listVideoAccessPackagesClient({
          hostPubkey: normalizedHost,
          streamId: normalizedStreamId,
          includeDisabled: true,
          includeUnlisted: true,
          limit: 600,
          operatorProofEvent: proof
        })
          .then((loadedPackages) => ({
            ok: true as const,
            packages: loadedPackages.packages
          }))
          .catch((packageError: any) => ({
            ok: false as const,
            error: packageError?.message ?? "Failed to load Video access packages."
          }))
      ]);
      setRows(result.rows);
      setDrafts(() => {
        const next: Record<string, RowDraft> = {};
        for (const row of result.rows) {
          next[row.relativePath] = draftFromRow(row);
        }
        return next;
      });
      if (packageResult.ok) {
        setPackages(packageResult.packages);
      } else {
        setPackages([]);
        setPackageLoadError(packageResult.error);
      }
      if (analyticsResult) {
        setAnalyticsByPath(
          Object.fromEntries(analyticsResult.rows.map((row) => [row.relativePath, row]))
        );
      } else {
        setAnalyticsByPath({});
      }
      setNotice(
        `Loaded ${result.count} Video recording${result.count === 1 ? "" : "s"} and ${
          packageResult.ok ? packageResult.packages.length : 0
        } package${packageResult.ok && packageResult.packages.length === 1 ? "" : "s"} for ${formatPubkeyShort(normalizedHost)}.`
      );
    } catch (loadError: any) {
      setPackages([]);
      setError(loadError?.message ?? "Failed to load Video library.");
    } finally {
      setIsLoading(false);
      setAnalyticsLoading(false);
    }
  }, [buildProof, normalizedHost, normalizedStreamId]);

  useEffect(() => {
    setSelectedRelativePaths((prev) => prev.filter((relativePath) => rows.some((row) => row.relativePath === relativePath)));
  }, [rows]);

  const updateDraft = useCallback((relativePath: string, patch: Partial<RowDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [relativePath]: {
        ...(prev[relativePath] ??
          draftFromRow(
            rows.find((row) => row.relativePath === relativePath) ?? {
              relativePath,
              fileName: relativePath,
              fileSizeBytes: 0,
              fileModifiedAtMs: Date.now(),
              fileUrl: "",
              metadata: null
            }
          )),
        ...patch
      }
    }));
  }, [rows]);

  const toggleRowSelection = useCallback((relativePath: string) => {
    setSelectedRelativePaths((prev) =>
      prev.includes(relativePath) ? prev.filter((value) => value !== relativePath) : [...prev, relativePath]
    );
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedRelativePaths(visibleRows.map((row) => row.relativePath));
  }, [visibleRows]);

  const clearSelection = useCallback(() => {
    setSelectedRelativePaths([]);
  }, []);

  const importRowsToPackageBulk = useCallback(
    (
      gapRows: PrivatePricingGapRow[],
      options: { includePlaylists: boolean; includeFiles: boolean; noticePrefix: string }
    ) => {
      if (!normalizedHost) {
        setError("Host pubkey must be a valid npub or 64-hex pubkey.");
        return false;
      }
      if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
        setError("Stream ID is required and must match letters/digits/_/-.");
        return false;
      }
      const playlistIds = options.includePlaylists
        ? Array.from(new Set(gapRows.map((row) => row.playlistId))).filter((playlistId) => PLAYLIST_ID_RE.test(playlistId))
        : [];
      const relativePaths = options.includeFiles
        ? Array.from(new Set(gapRows.map((row) => row.relativePath))).filter((relativePath) => isValidRelativePath(relativePath))
        : [];
      if (playlistIds.length === 0 && relativePaths.length === 0) {
        setError("No valid package scope rows were available to queue.");
        return false;
      }
      const detail: VideoPackageBulkImportDetail = {
        hostPubkey: normalizedHost,
        streamId: normalizedStreamId,
        playlistIds,
        relativePaths,
        titlePrefix: normalizedStreamId
      };
      window.dispatchEvent(new CustomEvent(Video_PACKAGE_IMPORT_EVENT, { detail }));
      setError(null);
      const scopeSummary =
        playlistIds.length > 0 && relativePaths.length > 0
          ? `${playlistIds.length} playlist scope${playlistIds.length === 1 ? "" : "s"} + ${relativePaths.length} file scope${relativePaths.length === 1 ? "" : "s"}`
          : playlistIds.length > 0
            ? `${playlistIds.length} playlist scope${playlistIds.length === 1 ? "" : "s"}`
            : `${relativePaths.length} file scope${relativePaths.length === 1 ? "" : "s"}`;
      setNotice(`${options.noticePrefix} Queued ${scopeSummary} in Video package pricing.`);
      return true;
    },
    [normalizedHost, normalizedStreamId]
  );

  const getPrivatePricingGapsForRelativePaths = useCallback(
    (relativePaths: string[]) => {
      if (relativePaths.length === 0) return [];
      const pathSet = new Set(relativePaths);
      return privatePricingGapRows.filter((row) => pathSet.has(row.relativePath));
    },
    [privatePricingGapRows]
  );

  const selectMissingPrivatePricing = useCallback(() => {
    const missing = privatePricingGapRows.map((row) => row.relativePath);
    setSelectedRelativePaths(missing);
    if (missing.length === 0) {
      setNotice("All private published rows already have active pricing coverage.");
    } else {
      setNotice(`Selected ${missing.length} private published row${missing.length === 1 ? "" : "s"} missing pricing.`);
    }
    setError(null);
  }, [privatePricingGapRows]);

  const queueMissingPrivatePlaylistsToPricing = useCallback(() => {
    if (privatePricingGapRows.length === 0) {
      setError(null);
      setNotice("All private published rows already have active pricing coverage.");
      return;
    }
    void importRowsToPackageBulk(privatePricingGapRows, {
      includePlaylists: true,
      includeFiles: false,
      noticePrefix: "Missing private pricing detected."
    });
  }, [importRowsToPackageBulk, privatePricingGapRows]);

  const queueMissingPrivateFilesToPricing = useCallback(() => {
    if (privatePricingGapRows.length === 0) {
      setError(null);
      setNotice("All private published rows already have active pricing coverage.");
      return;
    }
    void importRowsToPackageBulk(privatePricingGapRows, {
      includePlaylists: false,
      includeFiles: true,
      noticePrefix: "Missing private pricing detected."
    });
  }, [importRowsToPackageBulk, privatePricingGapRows]);

  const setPublishedForSelection = useCallback((published: boolean) => {
    if (selectedRelativePaths.length === 0) {
      setError("Select at least one Video row.");
      return;
    }
    setError(null);
    setNotice(null);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const relativePath of selectedRelativePaths) {
        const row = rows.find((entry) => entry.relativePath === relativePath);
        if (!row) continue;
        next[relativePath] = {
          ...(next[relativePath] ?? draftFromRow(row)),
          published
        };
      }
      return next;
    });
    setNotice(`${published ? "Published" : "Unpublished"} ${selectedRelativePaths.length} draft row${selectedRelativePaths.length === 1 ? "" : "s"}. Save to apply.`);
  }, [rows, selectedRelativePaths]);

  const setVisibilityForSelection = useCallback((visibility: VideoCatalogVisibility) => {
    if (selectedRelativePaths.length === 0) {
      setError("Select at least one Video row.");
      return;
    }
    setError(null);
    setNotice(null);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const relativePath of selectedRelativePaths) {
        const row = rows.find((entry) => entry.relativePath === relativePath);
        if (!row) continue;
        next[relativePath] = {
          ...(next[relativePath] ?? draftFromRow(row)),
          visibility
        };
      }
      return next;
    });
    setNotice(`Applied visibility "${visibility}" to ${selectedRelativePaths.length} draft row${selectedRelativePaths.length === 1 ? "" : "s"}. Save to apply.`);
  }, [rows, selectedRelativePaths]);

  const publishSelectionWithVisibility = useCallback(
    (visibility: VideoCatalogVisibility) => {
      if (selectedRelativePaths.length === 0) {
        setError("Select at least one Video row.");
        return;
      }
      setError(null);
      setNotice(null);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const relativePath of selectedRelativePaths) {
          const row = rows.find((entry) => entry.relativePath === relativePath);
          if (!row) continue;
          next[relativePath] = {
            ...(next[relativePath] ?? draftFromRow(row)),
            published: true,
            visibility
          };
        }
        return next;
      });
      setNotice(
        `Marked ${selectedRelativePaths.length} draft row${selectedRelativePaths.length === 1 ? "" : "s"} as published + ${visibility}. Save to apply.`
      );
    },
    [rows, selectedRelativePaths]
  );

  const setPlaylistForSelection = useCallback((playlistId: string | null) => {
    if (selectedRelativePaths.length === 0) {
      setError("Select at least one Video row.");
      return;
    }
    const normalizedPlaylistId = (playlistId ?? "").trim();
    if (normalizedPlaylistId && !PLAYLIST_ID_RE.test(normalizedPlaylistId)) {
      setError("Playlist ID must use letters, digits, '.', '-', '_' or __root__.");
      return;
    }
    setError(null);
    setNotice(null);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const relativePath of selectedRelativePaths) {
        const row = rows.find((entry) => entry.relativePath === relativePath);
        if (!row) continue;
        next[relativePath] = {
          ...(next[relativePath] ?? draftFromRow(row)),
          playlistId: normalizedPlaylistId
        };
      }
      return next;
    });
    setNotice(
      `${normalizedPlaylistId ? `Set playlist "${normalizedPlaylistId}"` : "Cleared playlist"} on ${
        selectedRelativePaths.length
      } draft row${selectedRelativePaths.length === 1 ? "" : "s"}. Save to apply.`
    );
  }, [rows, selectedRelativePaths]);

  const archiveSelection = useCallback(() => {
    if (selectedRelativePaths.length === 0) {
      setError("Select at least one Video row.");
      return;
    }
    setError(null);
    setNotice(null);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const relativePath of selectedRelativePaths) {
        const row = rows.find((entry) => entry.relativePath === relativePath);
        if (!row) continue;
        next[relativePath] = {
          ...(next[relativePath] ?? draftFromRow(row)),
          published: false,
          visibility: "unlisted"
        };
      }
      return next;
    });
    setNotice(`Archived ${selectedRelativePaths.length} draft row${selectedRelativePaths.length === 1 ? "" : "s"} (unpublished + unlisted). Save to apply.`);
  }, [rows, selectedRelativePaths]);

  const autoOrderSelection = useCallback(() => {
    if (selectedRelativePaths.length === 0) {
      setError("Select at least one Video row.");
      return;
    }
    const selectedRows = rows.filter((row) => selectedRelativePathSet.has(row.relativePath));
    if (selectedRows.length === 0) return;
    const sorted = [...selectedRows].sort((left, right) => left.fileModifiedAtMs - right.fileModifiedAtMs);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const [index, row] of sorted.entries()) {
        next[row.relativePath] = {
          ...(next[row.relativePath] ?? draftFromRow(row)),
          orderIndexText: String(index)
        };
      }
      return next;
    });
    setError(null);
    setNotice(`Applied sequential order indices to ${sorted.length} row${sorted.length === 1 ? "" : "s"}. Save to apply.`);
  }, [rows, selectedRelativePathSet, selectedRelativePaths.length]);

  const saveSelection = useCallback(async () => {
    if (selectedRelativePaths.length === 0) {
      setError("Select at least one Video row.");
      return;
    }
    if (!normalizedHost) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
      setError("Stream ID is required and must match letters/digits/_/-.");
      return;
    }
    setError(null);
    setNotice(null);
    const missingCoverageRows = getPrivatePricingGapsForRelativePaths(selectedRelativePaths);
    if (missingCoverageRows.length > 0) {
      importRowsToPackageBulk(missingCoverageRows, {
        includePlaylists: true,
        includeFiles: true,
        noticePrefix: "Blocked private publish save."
      });
      setError(
        `Blocked save: ${missingCoverageRows.length} selected row${
          missingCoverageRows.length === 1 ? "" : "s"
        } are private + published without active package coverage.`
      );
      return;
    }
    setBulkSaveBusy(true);
    try {
      const proof = await buildProof();
      let success = 0;
      let failed = 0;
      for (const relativePath of selectedRelativePaths) {
        const row = rows.find((entry) => entry.relativePath === relativePath);
        if (!row) continue;
        const draft = drafts[relativePath] ?? draftFromRow(row);
        try {
          let orderIndex: number | undefined;
          try {
            orderIndex = parseOrderIndexText(draft.orderIndexText);
          } catch (parseError: any) {
            throw new Error(`${row.fileName}: ${parseError?.message ?? "invalid order index"}`);
          }

          const result = await upsertVideoCatalogEntryClient({
            hostPubkey: normalizedHost,
            streamId: normalizedStreamId,
            relativePath: row.relativePath,
            operatorProofEvent: proof,
            title: draft.title.trim(),
            description: draft.description.trim() || undefined,
            playlistId: draft.playlistId.trim() || undefined,
            orderIndex,
            visibility: draft.visibility,
            processingState: draft.processingState,
            processingError: draft.processingError.trim() || undefined,
            thumbnailUrl: draft.thumbnailUrl.trim() || undefined,
            tags: parseTagsText(draft.tagsText),
            published: draft.published
          });
          setRows((prev) =>
            prev.map((entry) =>
              entry.relativePath === row.relativePath
                ? {
                    ...entry,
                    metadata: result.entry
                  }
                : entry
            )
          );
          success += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        setError(`Saved ${success} row${success === 1 ? "" : "s"} with ${failed} failure${failed === 1 ? "" : "s"}.`);
      } else {
        setNotice(`Saved ${success} Video row${success === 1 ? "" : "s"}.`);
      }
    } catch (bulkError: any) {
      setError(bulkError?.message ?? "Failed to save selected Video rows.");
    } finally {
      setBulkSaveBusy(false);
    }
  }, [
    buildProof,
    drafts,
    getPrivatePricingGapsForRelativePaths,
    importRowsToPackageBulk,
    normalizedHost,
    normalizedStreamId,
    rows,
    selectedRelativePaths
  ]);

  const clearMetadataForSelection = useCallback(async () => {
    if (selectedRelativePaths.length === 0) {
      setError("Select at least one Video row.");
      return;
    }
    if (!normalizedHost) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
      setError("Stream ID is required and must match letters/digits/_/-.");
      return;
    }

    const confirmed = window.confirm(
      `Clear metadata for ${selectedRelativePaths.length} selected Video row${selectedRelativePaths.length === 1 ? "" : "s"}? This does not delete media files.`
    );
    if (!confirmed) return;

    setError(null);
    setNotice(null);
    setBulkClearBusy(true);
    try {
      const proof = await buildProof();
      let success = 0;
      let failed = 0;
      for (const relativePath of selectedRelativePaths) {
        const row = rows.find((entry) => entry.relativePath === relativePath);
        if (!row?.metadata) continue;
        try {
          await deleteVideoCatalogEntryClient({
            hostPubkey: normalizedHost,
            streamId: normalizedStreamId,
            relativePath: row.relativePath,
            operatorProofEvent: proof
          });
          success += 1;
        } catch {
          failed += 1;
        }
      }

      if (success > 0) {
        setRows((prev) =>
          prev.map((entry) =>
            selectedRelativePaths.includes(entry.relativePath) ? { ...entry, metadata: null } : entry
          )
        );
        setDrafts((prev) => {
          const next = { ...prev };
          for (const relativePath of selectedRelativePaths) {
            const row = rows.find((entry) => entry.relativePath === relativePath);
            if (!row) continue;
            next[relativePath] = draftFromRow({ ...row, metadata: null });
          }
          return next;
        });
      }

      if (failed > 0) {
        setError(`Cleared ${success} row${success === 1 ? "" : "s"} with ${failed} failure${failed === 1 ? "" : "s"}.`);
      } else {
        setNotice(`Cleared metadata on ${success} row${success === 1 ? "" : "s"}.`);
      }
    } catch (clearError: any) {
      setError(clearError?.message ?? "Failed to clear selected metadata.");
    } finally {
      setBulkClearBusy(false);
    }
  }, [buildProof, normalizedHost, normalizedStreamId, rows, selectedRelativePaths]);

  const importSelectionToPackageBulk = useCallback(() => {
    if (selectedRelativePaths.length === 0) {
      setError("Select at least one Video row.");
      return;
    }
    if (!normalizedHost) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
      setError("Stream ID is required and must match letters/digits/_/-.");
      return;
    }
    const selectedRows = rows.filter((row) => selectedRelativePathSet.has(row.relativePath));
    if (selectedRows.length === 0) {
      setError("Select at least one Video row.");
      return;
    }

    const playlistIds = Array.from(
      new Set(
        selectedRows.map((row) => {
          const draft = drafts[row.relativePath] ?? draftFromRow(row);
          return draft.playlistId.trim() || "__root__";
        })
      )
    ).filter((playlistId) => PLAYLIST_ID_RE.test(playlistId));

    if (playlistIds.length === 0) {
      setError("Selected rows do not contain valid playlist scopes.");
      return;
    }

    const detail: VideoPackageBulkImportDetail = {
      hostPubkey: normalizedHost,
      streamId: normalizedStreamId,
      playlistIds,
      relativePaths: [],
      titlePrefix: normalizedStreamId
    };
    window.dispatchEvent(new CustomEvent(Video_PACKAGE_IMPORT_EVENT, { detail }));
    setError(null);
    setNotice(
      `Sent ${playlistIds.length} playlist scope${playlistIds.length === 1 ? "" : "s"} to Video package pricing.`
    );
  }, [drafts, normalizedHost, normalizedStreamId, rows, selectedRelativePathSet, selectedRelativePaths.length]);

  const importSelectionFilesToPackageBulk = useCallback(() => {
    if (selectedRelativePaths.length === 0) {
      setError("Select at least one Video row.");
      return;
    }
    if (!normalizedHost) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
      setError("Stream ID is required and must match letters/digits/_/-.");
      return;
    }
    const selectedRows = rows.filter((row) => selectedRelativePathSet.has(row.relativePath));
    if (selectedRows.length === 0) {
      setError("Select at least one Video row.");
      return;
    }

    const relativePaths = Array.from(
      new Set(selectedRows.map((row) => row.relativePath.trim()).filter((relativePath) => isValidRelativePath(relativePath)))
    );
    if (relativePaths.length === 0) {
      setError("Selected rows do not contain valid relative file paths.");
      return;
    }

    const detail: VideoPackageBulkImportDetail = {
      hostPubkey: normalizedHost,
      streamId: normalizedStreamId,
      playlistIds: [],
      relativePaths,
      titlePrefix: normalizedStreamId
    };
    window.dispatchEvent(new CustomEvent(Video_PACKAGE_IMPORT_EVENT, { detail }));
    setError(null);
    setNotice(`Sent ${relativePaths.length} file scope${relativePaths.length === 1 ? "" : "s"} to Video package pricing.`);
  }, [normalizedHost, normalizedStreamId, rows, selectedRelativePathSet, selectedRelativePaths.length]);

  const saveRow = useCallback(
    async (row: VideoCatalogListRow) => {
      setError(null);
      setNotice(null);
      if (!normalizedHost) {
        setError("Host pubkey must be a valid npub or 64-hex pubkey.");
        return;
      }
      if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
        setError("Stream ID is required and must match letters/digits/_/-.");
        return;
      }
      const draft = drafts[row.relativePath] ?? draftFromRow(row);
      if (!draft.title.trim()) {
        setError("Title is required.");
        return;
      }
      let orderIndex: number | undefined;
      try {
        orderIndex = parseOrderIndexText(draft.orderIndexText);
      } catch (parseError: any) {
        setError(parseError?.message ?? "Order must be a whole number.");
        return;
      }
      const missingCoverageRows = getPrivatePricingGapsForRelativePaths([row.relativePath]);
      if (missingCoverageRows.length > 0) {
        importRowsToPackageBulk(missingCoverageRows, {
          includePlaylists: true,
          includeFiles: true,
          noticePrefix: "Blocked save for private publish."
        });
        setError(`Blocked save for "${row.fileName}": private + published rows require active package coverage.`);
        return;
      }

      setSaveBusyPath(row.relativePath);
      try {
        const proof = await buildProof();
        const result = await upsertVideoCatalogEntryClient({
          hostPubkey: normalizedHost,
          streamId: normalizedStreamId,
          relativePath: row.relativePath,
          operatorProofEvent: proof,
          title: draft.title.trim(),
          description: draft.description.trim() || undefined,
          playlistId: draft.playlistId.trim() || undefined,
          orderIndex,
          visibility: draft.visibility,
          processingState: draft.processingState,
          processingError: draft.processingError.trim() || undefined,
          thumbnailUrl: draft.thumbnailUrl.trim() || undefined,
          tags: parseTagsText(draft.tagsText),
          published: draft.published
        });
        setRows((prev) =>
          prev.map((entry) =>
            entry.relativePath === row.relativePath
              ? {
                  ...entry,
                  metadata: result.entry
                }
              : entry
          )
        );
        setNotice(`Saved "${result.entry.title}".`);
      } catch (saveError: any) {
        setError(saveError?.message ?? "Failed to save Video entry.");
      } finally {
        setSaveBusyPath(null);
      }
    },
    [buildProof, drafts, getPrivatePricingGapsForRelativePaths, importRowsToPackageBulk, normalizedHost, normalizedStreamId]
  );

  const removeMetadata = useCallback(
    async (row: VideoCatalogListRow) => {
      if (!row.metadata) return;
      if (!normalizedHost || !normalizedStreamId || normalizedStreamId === "__invalid__") return;
      const confirmed = window.confirm(`Delete metadata for "${row.metadata.title}"? This will not delete the media file.`);
      if (!confirmed) return;
      setError(null);
      setNotice(null);
      setDeleteBusyPath(row.relativePath);
      try {
        const proof = await buildProof();
        await deleteVideoCatalogEntryClient({
          hostPubkey: normalizedHost,
          streamId: normalizedStreamId,
          relativePath: row.relativePath,
          operatorProofEvent: proof
        });
        setRows((prev) =>
          prev.map((entry) => (entry.relativePath === row.relativePath ? { ...entry, metadata: null } : entry))
        );
        setDrafts((prev) => ({
          ...prev,
          [row.relativePath]: draftFromRow({ ...row, metadata: null })
        }));
        setNotice("Metadata removed.");
      } catch (deleteError: any) {
        setError(deleteError?.message ?? "Failed to delete metadata.");
      } finally {
        setDeleteBusyPath(null);
      }
    },
    [buildProof, normalizedHost, normalizedStreamId]
  );

  const ingestRows = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!normalizedHost) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
      setError("Stream ID is required and must match letters/digits/_/-.");
      return;
    }

    setIngestBusy(true);
    try {
      const proof = await buildProof();
      const result = await ingestVideoCatalogEntriesClient({
        hostPubkey: normalizedHost,
        streamId: normalizedStreamId,
        operatorProofEvent: proof,
        visibility: ingestVisibility,
        processingState: ingestProcessingState,
        published: ingestPublished,
        onlyMissing: ingestOnlyMissing
      });
      await loadRows();
      setNotice(
        `Ingest complete: ${result.createdCount} created, ${result.updatedCount} updated, ${result.skippedCount} skipped (${result.totalFiles} files scanned).`
      );
    } catch (ingestError: any) {
      setError(ingestError?.message ?? "Failed to ingest Video files.");
    } finally {
      setIngestBusy(false);
    }
  }, [
    buildProof,
    ingestOnlyMissing,
    ingestPublished,
    ingestProcessingState,
    ingestVisibility,
    loadRows,
    normalizedHost,
    normalizedStreamId
  ]);

  const refreshAnalytics = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!normalizedHost) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
      setError("Stream ID is required and must match letters/digits/_/-.");
      return;
    }

    setAnalyticsLoading(true);
    try {
      const proof = await buildProof();
      const result = await listVideoAnalyticsSummaryClient({
        hostPubkey: normalizedHost,
        streamId: normalizedStreamId,
        operatorProofEvent: proof,
        limit: 2000
      });
      setAnalyticsByPath(
        Object.fromEntries(result.rows.map((row) => [row.relativePath, row]))
      );
      setNotice(`Loaded analytics for ${result.count} Video entr${result.count === 1 ? "y" : "ies"}.`);
    } catch (analyticsError: any) {
      setError(analyticsError?.message ?? "Failed to refresh Video analytics.");
    } finally {
      setAnalyticsLoading(false);
    }
  }, [buildProof, normalizedHost, normalizedStreamId]);

  const processRows = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!normalizedHost) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
      setError("Stream ID is required and must match letters/digits/_/-.");
      return;
    }

    setProcessBusy(true);
    try {
      const proof = await buildProof();
      const result = await processVideoCatalogEntriesClient({
        hostPubkey: normalizedHost,
        streamId: normalizedStreamId,
        operatorProofEvent: proof,
        limit: 500
      });
      await loadRows();
      setNotice(
        `Processing complete: ${result.processed} processed (${result.ready} ready, ${result.failed} failed, ${result.skipped} skipped).`
      );
    } catch (processError: any) {
      setError(processError?.message ?? "Failed to process queued Video entries.");
    } finally {
      setProcessBusy(false);
    }
  }, [buildProof, loadRows, normalizedHost, normalizedStreamId]);

  const processHostRows = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!normalizedHost) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }

    setProcessBusy(true);
    try {
      const proof = await buildProof();
      const result = await processVideoCatalogHostEntriesClient({
        hostPubkey: normalizedHost,
        operatorProofEvent: proof,
        limit: 2000,
        maxStreams: 300
      });
      await loadRows();
      setNotice(
        `Host queue processed: ${result.processed} entries across ${result.streamCount} stream${
          result.streamCount === 1 ? "" : "s"
        } (${result.ready} ready, ${result.failed} failed, ${result.skipped} skipped).`
      );
    } catch (processError: any) {
      setError(processError?.message ?? "Failed to process host Video queue.");
    } finally {
      setProcessBusy(false);
    }
  }, [buildProof, loadRows, normalizedHost]);

  const uploadSelectedFile = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!normalizedHost) {
      setError("Host pubkey must be a valid npub or 64-hex pubkey.");
      return;
    }
    if (!normalizedStreamId || normalizedStreamId === "__invalid__") {
      setError("Stream ID is required and must match letters/digits/_/-.");
      return;
    }
    if (!uploadFile) {
      setError("Select a Video file to upload.");
      return;
    }

    setUploadBusy(true);
    setUploadProgress({ uploadedBytes: 0, totalBytes: uploadFile.size });
    try {
      const proof = await buildProof();
      const result = await uploadVideoCatalogFileClient({
        hostPubkey: normalizedHost,
        streamId: normalizedStreamId,
        operatorProofEvent: proof,
        file: uploadFile,
        playlistId: uploadPlaylistId.trim() || undefined,
        title: uploadTitle.trim() || undefined,
        description: uploadDescription.trim() || undefined,
        visibility: ingestVisibility,
        processingState: ingestProcessingState,
        published: ingestPublished,
        onProgress: (uploadedBytes, totalBytes) => {
          setUploadProgress({ uploadedBytes, totalBytes });
        }
      });
      setUploadFile(null);
      setUploadPlaylistId("");
      setUploadTitle("");
      setUploadDescription("");
      await loadRows();
      setNotice(`Uploaded "${result.fileName}" (${formatBytesCompact(result.fileSizeBytes)}).`);
    } catch (uploadError: any) {
      setError(uploadError?.message ?? "Failed to upload Video file.");
    } finally {
      setUploadProgress(null);
      setUploadBusy(false);
    }
  }, [
    buildProof,
    ingestPublished,
    ingestProcessingState,
    ingestVisibility,
    loadRows,
    normalizedHost,
    normalizedStreamId,
    uploadDescription,
    uploadFile,
    uploadPlaylistId,
    uploadTitle
  ]);

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-200">Video Library Curation</h2>
          <div className="text-xs text-neutral-500">
            Publish metadata, playlist grouping, visibility, and release state for recorded Video files.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void ingestRows()}
            disabled={isLoading || ingestBusy || processBusy}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/20 hover:bg-blue-500/30 text-xs text-blue-100 disabled:opacity-50"
          >
            {ingestBusy ? "Ingesting…" : "Ingest Missing Files"}
          </button>
          <button
            type="button"
            onClick={() => void processRows()}
            disabled={isLoading || ingestBusy || processBusy}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-xs text-amber-100 disabled:opacity-50"
          >
            {processBusy ? "Processing…" : "Process Queue"}
          </button>
          <button
            type="button"
            onClick={() => void processHostRows()}
            disabled={isLoading || ingestBusy || processBusy}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-xs text-amber-100 disabled:opacity-50"
          >
            {processBusy ? "Processing…" : "Process Host Queue"}
          </button>
          <button
            type="button"
            onClick={() => void loadRows()}
            disabled={isLoading || ingestBusy || processBusy}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs disabled:opacity-50"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            Refresh Files
          </button>
          <button
            type="button"
            onClick={() => void refreshAnalytics()}
            disabled={analyticsLoading || isLoading || ingestBusy || processBusy}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs disabled:opacity-50"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            {analyticsLoading ? "Refreshing analytics…" : "Refresh Analytics"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <div className="text-xs text-neutral-500">Host pubkey (hex or npub)</div>
          <input
            value={hostInput}
            onChange={(event) => setHostInput(event.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
            placeholder="npub..."
          />
        </label>
        <label className="space-y-1.5">
          <div className="text-xs text-neutral-500">Stream ID</div>
          <input
            value={streamIdInput}
            onChange={(event) => setStreamIdInput(event.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
            placeholder="channel-id"
          />
        </label>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
        <div className="text-xs font-semibold text-neutral-200">Upload New Video File</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            type="file"
            accept=".mp4,.m4s,.mkv,.ts,.webm,.mov"
            onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-2 text-xs file:mr-2 file:rounded-md file:border-0 file:bg-neutral-800 file:px-2 file:py-1 file:text-xs"
          />
          <input
            value={uploadPlaylistId}
            onChange={(event) => setUploadPlaylistId(event.target.value)}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm font-mono"
            placeholder="playlist-id (optional)"
          />
          <input
            value={uploadTitle}
            onChange={(event) => setUploadTitle(event.target.value)}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm"
            placeholder="title override (optional)"
          />
          <button
            type="button"
            onClick={() => void uploadSelectedFile()}
            disabled={uploadBusy || !uploadFile || isLoading}
            className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/20 hover:bg-emerald-500/30 text-xs text-emerald-100 disabled:opacity-50"
          >
            {uploadBusy ? "Uploading…" : "Upload File"}
          </button>
        </div>
        <textarea
          value={uploadDescription}
          onChange={(event) => setUploadDescription(event.target.value)}
          className="w-full min-h-[56px] bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-2 text-sm"
          placeholder="description override (optional)"
        />
        {uploadFile ? (
          <div className="text-[11px] text-neutral-500">
            Selected: {uploadFile.name} · {formatBytesCompact(uploadFile.size)}
          </div>
        ) : null}
        {uploadProgress ? (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-neutral-900 overflow-hidden border border-neutral-800">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-150"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, (uploadProgress.uploadedBytes / Math.max(1, uploadProgress.totalBytes)) * 100)
                  )}%`
                }}
              />
            </div>
            <div className="text-[11px] text-neutral-500">
              Uploading {formatBytesCompact(uploadProgress.uploadedBytes)} / {formatBytesCompact(uploadProgress.totalBytes)}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
        <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
          Visibility
          <select
            value={ingestVisibility}
            onChange={(event) => setIngestVisibility(event.target.value as VideoCatalogVisibility)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xs"
          >
            <option value="public">public</option>
            <option value="unlisted">unlisted</option>
            <option value="private">private</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
          Processing
          <select
            value={ingestProcessingState}
            onChange={(event) => setIngestProcessingState(event.target.value as VideoProcessingState)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xs"
          >
            <option value="ready">ready</option>
            <option value="queued">queued</option>
            <option value="processing">processing</option>
            <option value="failed">failed</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={ingestPublished}
            onChange={(event) => setIngestPublished(event.target.checked)}
            className="accent-blue-500"
          />
          Publish ingested entries
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={ingestOnlyMissing}
            onChange={(event) => setIngestOnlyMissing(event.target.checked)}
            className="accent-blue-500"
          />
          Only missing catalog rows
        </label>
      </div>

      {error ? <div className="text-xs text-red-300">{error}</div> : null}
      {notice ? <div className="text-xs text-emerald-300">{notice}</div> : null}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-3 text-xs text-neutral-500">
          No Video files loaded yet. Select host + stream and press <span className="text-neutral-300">Refresh Files</span>.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm"
                placeholder="Search title, path, playlist, tags"
              />
              <select
                value={playlistFilterInput}
                onChange={(event) => setPlaylistFilterInput(event.target.value)}
                className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm"
              >
                <option value="__all__">All playlists</option>
                {playlistFilterOptions.map((playlistId) => (
                  <option key={playlistId} value={playlistId}>
                    {playlistId}
                  </option>
                ))}
              </select>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as VideoListSort)}
                className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm"
              >
                <option value="modified_desc">Newest files first</option>
                <option value="modified_asc">Oldest files first</option>
                <option value="title_asc">Title A → Z</option>
              </select>
              <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={showOnlyUnpublished}
                  onChange={(event) => setShowOnlyUnpublished(event.target.checked)}
                  className="accent-blue-500"
                />
                Unpublished only
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 px-2.5 py-2">
              <div className="text-[11px] text-neutral-500">
                Release status:{" "}
                <span className="text-neutral-300">{releaseSummary.publishedEntries}</span> published ·{" "}
                <span className="text-neutral-300">{releaseSummary.privatePublishedEntries}</span> private published ·{" "}
                <span className="text-emerald-300">{releaseSummary.privatePublishedCoveredEntries}</span> priced ·{" "}
                <span className={releaseSummary.privatePublishedMissingEntries > 0 ? "text-amber-300" : "text-neutral-300"}>
                  {releaseSummary.privatePublishedMissingEntries}
                </span>{" "}
                missing package
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
                  <input
                    type="checkbox"
                    checked={showOnlyMissingPrivatePricing}
                    onChange={(event) => setShowOnlyMissingPrivatePricing(event.target.checked)}
                    className="accent-blue-500"
                  />
                  Missing pricing only
                </label>
                <button
                  type="button"
                  onClick={selectMissingPrivatePricing}
                  className="px-2.5 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-xs text-amber-200"
                >
                  Select missing
                </button>
                <button
                  type="button"
                  onClick={queueMissingPrivatePlaylistsToPricing}
                  className="px-2.5 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/20 hover:bg-blue-500/30 text-xs text-blue-200"
                >
                  Queue missing playlists
                </button>
                <button
                  type="button"
                  onClick={queueMissingPrivateFilesToPricing}
                  className="px-2.5 py-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/20 hover:bg-indigo-500/30 text-xs text-indigo-200"
                >
                  Queue missing files
                </button>
              </div>
            </div>
            {packageLoadError ? <div className="text-xs text-amber-300">{packageLoadError}</div> : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-neutral-500">
                {selectedRelativePaths.length} selected · {filteredRows.length} filtered · {rows.length} total
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs"
                >
                  Select visible
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setPublishedForSelection(true)}
                  className="px-2.5 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/20 hover:bg-emerald-500/30 text-xs text-emerald-200"
                >
                  Mark published
                </button>
                <button
                  type="button"
                  onClick={() => setPublishedForSelection(false)}
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs"
                >
                  Mark draft
                </button>
                <button
                  type="button"
                  onClick={() => publishSelectionWithVisibility("public")}
                  className="px-2.5 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/20 hover:bg-emerald-500/30 text-xs text-emerald-200"
                >
                  Publish public
                </button>
                <button
                  type="button"
                  onClick={() => publishSelectionWithVisibility("private")}
                  className="px-2.5 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-xs text-amber-200"
                >
                  Publish private
                </button>
                <button
                  type="button"
                  onClick={() => {
                    publishSelectionWithVisibility("private");
                    importSelectionToPackageBulk();
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/20 hover:bg-blue-500/30 text-xs text-blue-200"
                >
                  Private + queue pricing
                </button>
                <button
                  type="button"
                  onClick={autoOrderSelection}
                  className="px-2.5 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/20 hover:bg-blue-500/30 text-xs text-blue-200"
                >
                  Auto-order
                </button>
                <select
                  value={bulkVisibilityInput}
                  onChange={(event) => setBulkVisibilityInput(event.target.value as VideoCatalogVisibility)}
                  className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-xs"
                >
                  <option value="public">public</option>
                  <option value="unlisted">unlisted</option>
                  <option value="private">private</option>
                </select>
                <button
                  type="button"
                  onClick={() => setVisibilityForSelection(bulkVisibilityInput)}
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs"
                >
                  Apply visibility
                </button>
                <input
                  value={bulkPlaylistIdInput}
                  onChange={(event) => setBulkPlaylistIdInput(event.target.value)}
                  className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-xs font-mono min-w-[140px]"
                  placeholder="playlist-id"
                />
                <button
                  type="button"
                  onClick={() => setPlaylistForSelection(bulkPlaylistIdInput)}
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs"
                >
                  Apply playlist
                </button>
                <button
                  type="button"
                  onClick={() => setPlaylistForSelection(null)}
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs"
                >
                  Clear playlist
                </button>
                <button
                  type="button"
                  onClick={() => void saveSelection()}
                  disabled={bulkSaveBusy}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/20 hover:bg-blue-500/30 text-xs text-blue-200 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {bulkSaveBusy ? "Saving selected…" : "Save selected"}
                </button>
                <button
                  type="button"
                  onClick={archiveSelection}
                  className="px-2.5 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-xs text-amber-200"
                >
                  Archive selected
                </button>
                <button
                  type="button"
                  onClick={importSelectionToPackageBulk}
                  className="px-2.5 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/20 hover:bg-blue-500/30 text-xs text-blue-200"
                >
                  Use for pricing
                </button>
                <button
                  type="button"
                  onClick={importSelectionFilesToPackageBulk}
                  className="px-2.5 py-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/20 hover:bg-indigo-500/30 text-xs text-indigo-200"
                >
                  Price selected files
                </button>
                <button
                  type="button"
                  onClick={() => void clearMetadataForSelection()}
                  disabled={bulkClearBusy}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-700/40 bg-red-950/20 hover:bg-red-950/30 text-xs text-red-200 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {bulkClearBusy ? "Clearing…" : "Clear metadata"}
                </button>
              </div>
            </div>
          </div>
          {visibleRows.map((row) => {
            const draft = drafts[row.relativePath] ?? draftFromRow(row);
            const analytics = analyticsByPath[row.relativePath];
            const hasPricingCoverage = releaseCoverageByPath[row.relativePath]?.hasActiveCoverage === true;
            const isPrivatePublished = draft.published && draft.visibility === "private";
            const missingPrivatePricing = isPrivatePublished && !hasPricingCoverage;
            const saveBusy = saveBusyPath === row.relativePath;
            const deleteBusy = deleteBusyPath === row.relativePath;
            return (
              <div key={row.relativePath} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-neutral-200 truncate">{draft.title || row.fileName}</div>
                    <div className="text-[11px] text-neutral-500 font-mono truncate">
                      {row.relativePath} · {formatBytesCompact(row.fileSizeBytes)}
                    </div>
                    {analytics ? (
                      <div className="text-[11px] text-neutral-500 mt-1">
                        {analytics.heartbeatCount.toLocaleString()} beats · {analytics.uniqueViewerCount.toLocaleString()} uniques · {formatDurationCompact(analytics.totalWatchSec)} watch
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="inline-flex items-center gap-1 text-[11px] text-neutral-400">
                      <input
                        type="checkbox"
                        checked={selectedRelativePathSet.has(row.relativePath)}
                        onChange={() => toggleRowSelection(row.relativePath)}
                        className="accent-blue-500"
                      />
                      select
                    </label>
                    <div className="text-[10px] uppercase tracking-wide rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-300">
                      {draft.published ? "published" : "draft"}
                    </div>
                    <div
                      className={`text-[10px] uppercase tracking-wide rounded border px-2 py-0.5 ${
                        (row.metadata?.processingState ?? "ready") === "failed"
                          ? "border-red-500/40 bg-red-500/10 text-red-200"
                          : (row.metadata?.processingState ?? "ready") === "processing"
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                            : (row.metadata?.processingState ?? "ready") === "queued"
                              ? "border-blue-500/40 bg-blue-500/10 text-blue-200"
                              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      }`}
                    >
                      {draft.processingState}
                    </div>
                    <div
                      className={`text-[10px] uppercase tracking-wide rounded border px-2 py-0.5 ${
                        missingPrivatePricing
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                          : isPrivatePublished
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                            : "border-neutral-700 bg-neutral-900 text-neutral-400"
                      }`}
                      title={
                        isPrivatePublished
                          ? hasPricingCoverage
                            ? "This private published file has active package coverage."
                            : "This private published file has no active package coverage."
                          : "Pricing coverage is only required for private published files."
                      }
                    >
                      {isPrivatePublished ? (hasPricingCoverage ? "priced" : "unpriced") : "n/a"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    value={draft.title}
                    onChange={(event) => updateDraft(row.relativePath, { title: event.target.value })}
                    className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm"
                    placeholder="Video title"
                  />
                  <input
                    value={draft.playlistId}
                    onChange={(event) => updateDraft(row.relativePath, { playlistId: event.target.value })}
                    className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm font-mono"
                    placeholder="playlist-id (optional)"
                  />
                  <input
                    value={draft.orderIndexText}
                    onChange={(event) => updateDraft(row.relativePath, { orderIndexText: event.target.value })}
                    className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm font-mono"
                    placeholder="order (0,1,2...)"
                  />
                </div>

                <textarea
                  value={draft.description}
                  onChange={(event) => updateDraft(row.relativePath, { description: event.target.value })}
                  className="w-full min-h-[72px] bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-2 text-sm"
                  placeholder="Description (optional)"
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <select
                    value={draft.visibility}
                    onChange={(event) => updateDraft(row.relativePath, { visibility: event.target.value as VideoCatalogVisibility })}
                    className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm"
                  >
                    <option value="public">public</option>
                    <option value="unlisted">unlisted</option>
                    <option value="private">private</option>
                  </select>
                  <input
                    value={draft.thumbnailUrl}
                    onChange={(event) => updateDraft(row.relativePath, { thumbnailUrl: event.target.value })}
                    className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm"
                    placeholder="Thumbnail URL (optional)"
                  />
                  <select
                    value={draft.processingState}
                    onChange={(event) =>
                      updateDraft(row.relativePath, {
                        processingState: event.target.value as VideoProcessingState
                      })
                    }
                    className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm"
                  >
                    <option value="ready">ready</option>
                    <option value="queued">queued</option>
                    <option value="processing">processing</option>
                    <option value="failed">failed</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    value={draft.processingError}
                    onChange={(event) => updateDraft(row.relativePath, { processingError: event.target.value })}
                    className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm"
                    placeholder="processing error (optional)"
                  />
                  <input
                    value={draft.tagsText}
                    onChange={(event) => updateDraft(row.relativePath, { tagsText: event.target.value })}
                    className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm"
                    placeholder="tags, comma-separated"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={draft.published}
                      onChange={(event) => updateDraft(row.relativePath, { published: event.target.checked })}
                      className="accent-blue-500"
                    />
                    Published on profile/watch listings
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveRow(row)}
                      disabled={saveBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 text-xs disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saveBusy ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeMetadata(row)}
                      disabled={deleteBusy || !row.metadata}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-500/30 bg-red-950/40 text-red-200 hover:bg-red-950/60 text-xs disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {deleteBusy ? "Removing…" : "Clear"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
