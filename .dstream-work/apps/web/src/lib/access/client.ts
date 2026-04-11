import type { NostrEvent, StreamPaymentAsset } from "@dstream/protocol";
import type {
  AccessAction,
  AccessAuditRecord,
  AccessDenyRule,
  AccessEntitlement,
  AccessEntitlementSource
} from "./types";
import type { VideoCheckoutVerificationMode } from "./videoCheckout";
import type { VideoPurchasePolicy } from "./videoPackagePolicy";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function asErrorMessage(input: unknown, fallback: string): string {
  if (!input || typeof input !== "object") return fallback;
  const value = (input as { error?: unknown }).error;
  return typeof value === "string" && value.trim() ? value : fallback;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export type AccessEntitlementStatusFilter = "active" | "revoked" | "expired" | "all";

interface AccessApiOk {
  ok: true;
}

interface AccessApiError {
  ok: false;
  error?: string;
}

type AccessApiResult<T> = (AccessApiOk & T) | AccessApiError;

export interface VideoPlaylistCatalogRow {
  id: string;
  fileCount: number;
  latestModifiedAtMs: number;
}

export type VideoCatalogVisibility = "public" | "unlisted" | "private";
export type VideoProcessingState = "ready" | "queued" | "processing" | "failed";

export interface VideoCatalogEntry {
  id: string;
  originStreamId: string;
  hostPubkey: string;
  streamId: string;
  relativePath: string;
  title: string;
  description?: string;
  playlistId?: string;
  orderIndex?: number;
  visibility: VideoCatalogVisibility;
  processingState: VideoProcessingState;
  processingError?: string;
  processingUpdatedAtSec?: number;
  thumbnailUrl?: string;
  tags: string[];
  publishedAtSec?: number;
  createdAtSec: number;
  updatedAtSec: number;
}

export interface VideoCatalogListRow {
  relativePath: string;
  fileName: string;
  fileSizeBytes: number;
  fileModifiedAtMs: number;
  fileUrl: string;
  metadata: VideoCatalogEntry | null;
}

export interface VideoAnalyticsSummaryRow {
  originStreamId: string;
  hostPubkey: string;
  streamId: string;
  relativePath: string;
  title?: string;
  playlistId?: string;
  firstSeenAtSec: number;
  lastSeenAtSec: number;
  heartbeatCount: number;
  totalWatchSec: number;
  uniqueViewerCount: number;
  lastCurrentTimeSec?: number;
  lastPlaybackMode?: "live" | "video";
  updatedAtSec: number;
}

export type VideoAccessPackageStatus = "active" | "disabled";
export type VideoAccessPackageVisibility = "public" | "unlisted";

export interface VideoAccessPackage {
  id: string;
  hostPubkey: string;
  streamId: string;
  playlistId?: string;
  relativePath?: string;
  resourceId: string;
  title: string;
  description?: string;
  paymentAsset: StreamPaymentAsset;
  paymentAmount: string;
  paymentRailId?: string;
  durationHours: number;
  status: VideoAccessPackageStatus;
  visibility: VideoAccessPackageVisibility;
  metadata: Record<string, unknown>;
  createdAtSec: number;
  updatedAtSec: number;
}

export interface VideoPackagePurchaseStats {
  packageId: string;
  totalPurchases: number;
  grantedPurchases: number;
  existingPurchases: number;
  verifiedPurchases: number;
  unverifiedPurchases: number;
  operatorOverridePurchases: number;
  unverifiedFallbackPurchases: number;
  uniqueViewerCount: number;
  latestPurchaseAtSec?: number;
  latestGrantedAtSec?: number;
}

export interface VideoPackageViewerUnlock {
  entitlementId: string;
  packageId?: string;
  resourceId: string;
  status: "active" | "revoked" | "expired";
  source: AccessEntitlementSource;
  sourceRef?: string;
  startsAtSec: number;
  expiresAtSec?: number;
  updatedAtSec: number;
}

export async function listVideoPlaylistCatalogClient(input: {
  hostPubkey: string;
  streamId: string;
  operatorProofEvent: NostrEvent;
}): Promise<{
  playlists: VideoPlaylistCatalogRow[];
  fileCount: number;
  originStreamId: string;
  actorPubkey: string | null;
}> {
  const response = await fetch(
    `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(input.streamId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operatorProofEvent: input.operatorProofEvent
      }),
      cache: "no-store"
    }
  );

  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    playlists?: VideoPlaylistCatalogRow[];
    fileCount?: number;
    originStreamId?: string;
    actorPubkey?: string | null;
  }> | null;

  if (!response.ok || !body?.ok || !Array.isArray(body.playlists) || typeof body.originStreamId !== "string") {
    throw new Error(asErrorMessage(body, "Failed to load Video catalog."));
  }

  return {
    playlists: body.playlists,
    fileCount: typeof body.fileCount === "number" ? body.fileCount : body.playlists.length,
    originStreamId: body.originStreamId,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null
  };
}

export async function listVideoCatalogEntriesClient(input: {
  hostPubkey: string;
  streamId: string;
  operatorProofEvent?: NostrEvent;
  adminRows?: boolean;
  includePrivate?: boolean;
  includeUnlisted?: boolean;
  includeUnpublished?: boolean;
  curatedOnly?: boolean;
  playlistId?: string;
}): Promise<{
  rows: VideoCatalogListRow[];
  count: number;
  originStreamId: string;
  actorPubkey: string | null;
  isAdmin: boolean;
}> {
  const response = await fetch(
    `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(input.streamId)}/entries/list`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operatorProofEvent: input.operatorProofEvent,
        adminRows: input.adminRows,
        includePrivate: input.includePrivate,
        includeUnlisted: input.includeUnlisted,
        includeUnpublished: input.includeUnpublished,
        curatedOnly: input.curatedOnly,
        playlistId: input.playlistId
      }),
      cache: "no-store"
    }
  );

  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    rows?: VideoCatalogListRow[];
    count?: number;
    originStreamId?: string;
    actorPubkey?: string | null;
    isAdmin?: boolean;
  }> | null;

  if (!response.ok || !body?.ok || !Array.isArray(body.rows) || typeof body.originStreamId !== "string") {
    throw new Error(asErrorMessage(body, "Failed to load Video catalog entries."));
  }

  return {
    rows: body.rows,
    count: typeof body.count === "number" ? body.count : body.rows.length,
    originStreamId: body.originStreamId,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null,
    isAdmin: body.isAdmin === true
  };
}

export async function upsertVideoCatalogEntryClient(input: {
  hostPubkey: string;
  streamId: string;
  relativePath: string;
  operatorProofEvent: NostrEvent;
  title?: string;
  description?: string;
  playlistId?: string;
  orderIndex?: number;
  visibility?: VideoCatalogVisibility;
  processingState?: VideoProcessingState;
  processingError?: string;
  thumbnailUrl?: string;
  tags?: string[];
  published?: boolean;
  publishedAtSec?: number;
}): Promise<{ entry: VideoCatalogEntry; actorPubkey: string | null; originStreamId: string }> {
  const response = await fetch(
    `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(input.streamId)}/entries/upsert`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operatorProofEvent: input.operatorProofEvent,
        relativePath: input.relativePath,
        title: input.title,
        description: input.description,
        playlistId: input.playlistId,
        orderIndex: input.orderIndex,
        visibility: input.visibility,
        processingState: input.processingState,
        processingError: input.processingError,
        thumbnailUrl: input.thumbnailUrl,
        tags: input.tags,
        published: input.published,
        publishedAtSec: input.publishedAtSec
      }),
      cache: "no-store"
    }
  );
  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    entry?: VideoCatalogEntry;
    actorPubkey?: string | null;
    originStreamId?: string;
  }> | null;

  if (!response.ok || !body?.ok || !body.entry || typeof body.originStreamId !== "string") {
    throw new Error(asErrorMessage(body, "Failed to save Video catalog entry."));
  }
  return {
    entry: body.entry,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null,
    originStreamId: body.originStreamId
  };
}

export async function deleteVideoCatalogEntryClient(input: {
  hostPubkey: string;
  streamId: string;
  relativePath: string;
  operatorProofEvent: NostrEvent;
}): Promise<{ relativePath: string; actorPubkey: string | null; originStreamId: string }> {
  const response = await fetch(
    `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(input.streamId)}/entries/delete`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operatorProofEvent: input.operatorProofEvent,
        relativePath: input.relativePath
      }),
      cache: "no-store"
    }
  );
  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    relativePath?: string;
    actorPubkey?: string | null;
    originStreamId?: string;
  }> | null;

  if (!response.ok || !body?.ok || typeof body.relativePath !== "string" || typeof body.originStreamId !== "string") {
    throw new Error(asErrorMessage(body, "Failed to delete Video catalog entry."));
  }
  return {
    relativePath: body.relativePath,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null,
    originStreamId: body.originStreamId
  };
}

export async function ingestVideoCatalogEntriesClient(input: {
  hostPubkey: string;
  streamId: string;
  operatorProofEvent: NostrEvent;
  visibility?: VideoCatalogVisibility;
  processingState?: VideoProcessingState;
  published?: boolean;
  onlyMissing?: boolean;
}): Promise<{
  hostPubkey: string;
  streamId: string;
  originStreamId: string;
  actorPubkey: string | null;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  totalFiles: number;
}> {
  const response = await fetch(
    `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(input.streamId)}/entries/ingest`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operatorProofEvent: input.operatorProofEvent,
        visibility: input.visibility,
        processingState: input.processingState,
        published: input.published,
        onlyMissing: input.onlyMissing
      }),
      cache: "no-store"
    }
  );
  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    hostPubkey?: string;
    streamId?: string;
    originStreamId?: string;
    actorPubkey?: string | null;
    createdCount?: number;
    updatedCount?: number;
    skippedCount?: number;
    totalFiles?: number;
  }> | null;

  if (
    !response.ok ||
    !body?.ok ||
    typeof body.hostPubkey !== "string" ||
    typeof body.streamId !== "string" ||
    typeof body.originStreamId !== "string"
  ) {
    throw new Error(asErrorMessage(body, "Failed to ingest Video catalog entries."));
  }

  return {
    hostPubkey: body.hostPubkey,
    streamId: body.streamId,
    originStreamId: body.originStreamId,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null,
    createdCount: typeof body.createdCount === "number" ? body.createdCount : 0,
    updatedCount: typeof body.updatedCount === "number" ? body.updatedCount : 0,
    skippedCount: typeof body.skippedCount === "number" ? body.skippedCount : 0,
    totalFiles: typeof body.totalFiles === "number" ? body.totalFiles : 0
  };
}

export async function processVideoCatalogEntriesClient(input: {
  hostPubkey: string;
  streamId: string;
  operatorProofEvent: NostrEvent;
  limit?: number;
}): Promise<{
  hostPubkey: string;
  streamId: string;
  originStreamId: string;
  actorPubkey: string | null;
  scanned: number;
  processed: number;
  ready: number;
  failed: number;
  skipped: number;
  errors: Array<{ relativePath: string; error: string }>;
}> {
  const response = await fetch(
    `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(input.streamId)}/entries/process`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operatorProofEvent: input.operatorProofEvent,
        limit: input.limit
      }),
      cache: "no-store"
    }
  );
  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    hostPubkey?: string;
    streamId?: string;
    originStreamId?: string;
    actorPubkey?: string | null;
    scanned?: number;
    processed?: number;
    ready?: number;
    failed?: number;
    skipped?: number;
    errors?: Array<{ relativePath: string; error: string }>;
  }> | null;

  if (
    !response.ok ||
    !body?.ok ||
    typeof body.hostPubkey !== "string" ||
    typeof body.streamId !== "string" ||
    typeof body.originStreamId !== "string"
  ) {
    throw new Error(asErrorMessage(body, "Failed to process Video entries."));
  }

  return {
    hostPubkey: body.hostPubkey,
    streamId: body.streamId,
    originStreamId: body.originStreamId,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null,
    scanned: typeof body.scanned === "number" ? body.scanned : 0,
    processed: typeof body.processed === "number" ? body.processed : 0,
    ready: typeof body.ready === "number" ? body.ready : 0,
    failed: typeof body.failed === "number" ? body.failed : 0,
    skipped: typeof body.skipped === "number" ? body.skipped : 0,
    errors: Array.isArray(body.errors) ? body.errors : []
  };
}

export async function processVideoCatalogHostEntriesClient(input: {
  hostPubkey: string;
  operatorProofEvent: NostrEvent;
  limit?: number;
  maxStreams?: number;
}): Promise<{
  hostPubkey: string;
  actorPubkey: string | null;
  scanned: number;
  processed: number;
  ready: number;
  failed: number;
  skipped: number;
  streamCount: number;
  streams: Array<{
    originStreamId: string;
    scanned: number;
    processed: number;
    ready: number;
    failed: number;
    skipped: number;
    errors: Array<{ relativePath: string; error: string }>;
  }>;
  errors: Array<{ relativePath: string; error: string }>;
}> {
  const response = await fetch(`/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/entries/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operatorProofEvent: input.operatorProofEvent,
      limit: input.limit,
      maxStreams: input.maxStreams
    }),
    cache: "no-store"
  });
  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    hostPubkey?: string;
    actorPubkey?: string | null;
    scanned?: number;
    processed?: number;
    ready?: number;
    failed?: number;
    skipped?: number;
    streamCount?: number;
    streams?: Array<{
      originStreamId: string;
      scanned: number;
      processed: number;
      ready: number;
      failed: number;
      skipped: number;
      errors: Array<{ relativePath: string; error: string }>;
    }>;
    errors?: Array<{ relativePath: string; error: string }>;
  }> | null;
  if (!response.ok || !body?.ok || typeof body.hostPubkey !== "string") {
    throw new Error(asErrorMessage(body, "Failed to process host Video queue."));
  }
  return {
    hostPubkey: body.hostPubkey,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null,
    scanned: typeof body.scanned === "number" ? body.scanned : 0,
    processed: typeof body.processed === "number" ? body.processed : 0,
    ready: typeof body.ready === "number" ? body.ready : 0,
    failed: typeof body.failed === "number" ? body.failed : 0,
    skipped: typeof body.skipped === "number" ? body.skipped : 0,
    streamCount: typeof body.streamCount === "number" ? body.streamCount : 0,
    streams: Array.isArray(body.streams) ? body.streams : [],
    errors: Array.isArray(body.errors) ? body.errors : []
  };
}

export async function listVideoAnalyticsSummaryClient(input: {
  hostPubkey: string;
  streamId: string;
  operatorProofEvent: NostrEvent;
  playlistId?: string;
  relativePath?: string;
  limit?: number;
}): Promise<{
  hostPubkey: string;
  streamId: string;
  originStreamId: string;
  actorPubkey: string | null;
  rows: VideoAnalyticsSummaryRow[];
  count: number;
}> {
  const response = await fetch(
    `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(input.streamId)}/entries/analytics/list`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operatorProofEvent: input.operatorProofEvent,
        playlistId: input.playlistId,
        relativePath: input.relativePath,
        limit: input.limit
      }),
      cache: "no-store"
    }
  );
  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    hostPubkey?: string;
    streamId?: string;
    originStreamId?: string;
    actorPubkey?: string | null;
    rows?: VideoAnalyticsSummaryRow[];
    count?: number;
  }> | null;
  if (
    !response.ok ||
    !body?.ok ||
    typeof body.hostPubkey !== "string" ||
    typeof body.streamId !== "string" ||
    typeof body.originStreamId !== "string" ||
    !Array.isArray(body.rows)
  ) {
    throw new Error(asErrorMessage(body, "Failed to load Video analytics summary."));
  }
  return {
    hostPubkey: body.hostPubkey,
    streamId: body.streamId,
    originStreamId: body.originStreamId,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null,
    rows: body.rows,
    count: typeof body.count === "number" ? body.count : body.rows.length
  };
}

export async function recordVideoAnalyticsHeartbeatClient(input: {
  originStreamId: string;
  relativePath: string;
  viewerId?: string | null;
  viewerProofEvent?: NostrEvent;
  elapsedSec?: number;
  currentTimeSec?: number;
  playbackMode?: "live" | "video";
}): Promise<{
  row: VideoAnalyticsSummaryRow;
}> {
  const response = await fetch("/api/video/analytics/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      originStreamId: input.originStreamId,
      relativePath: input.relativePath,
      viewerId: input.viewerId ?? undefined,
      viewerProofEvent: input.viewerProofEvent,
      elapsedSec: input.elapsedSec,
      currentTimeSec: input.currentTimeSec,
      playbackMode: input.playbackMode
    }),
    cache: "no-store"
  });
  const body = (await parseJsonResponse(response)) as AccessApiResult<{ row?: VideoAnalyticsSummaryRow }> | null;
  if (!response.ok || !body?.ok || !body.row) {
    throw new Error(asErrorMessage(body, "Failed to record Video analytics heartbeat."));
  }
  return { row: body.row };
}

export async function uploadVideoCatalogFileClient(input: {
  hostPubkey: string;
  streamId: string;
  operatorProofEvent: NostrEvent;
  file: File;
  playlistId?: string;
  title?: string;
  description?: string;
  visibility?: VideoCatalogVisibility;
  processingState?: VideoProcessingState;
  published?: boolean;
  thumbnailUrl?: string;
  tags?: string[];
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}): Promise<{
  hostPubkey: string;
  streamId: string;
  originStreamId: string;
  relativePath: string;
  fileName: string;
  fileSizeBytes: number;
  actorPubkey: string | null;
  entry: VideoCatalogEntry;
}> {
  const sessionStartResponse = await fetch(
    `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(input.streamId)}/entries/upload-session/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operatorProofEvent: input.operatorProofEvent,
        fileName: input.file.name,
        fileSizeBytes: input.file.size,
        playlistId: input.playlistId,
        title: input.title,
        description: input.description,
        visibility: input.visibility,
        processingState: input.processingState,
        published: input.published,
        thumbnailUrl: input.thumbnailUrl,
        tags: input.tags
      }),
      cache: "no-store"
    }
  );
  const sessionStartBody = (await parseJsonResponse(sessionStartResponse)) as AccessApiResult<{
    hostPubkey?: string;
    streamId?: string;
    originStreamId?: string;
    uploadId?: string;
    uploadToken?: string;
    chunkSizeBytes?: number;
    actorPubkey?: string | null;
  }> | null;
  if (
    !sessionStartResponse.ok ||
    !sessionStartBody?.ok ||
    typeof sessionStartBody.uploadId !== "string" ||
    typeof sessionStartBody.uploadToken !== "string" ||
    typeof sessionStartBody.originStreamId !== "string"
  ) {
    throw new Error(asErrorMessage(sessionStartBody, "Failed to start Video upload session."));
  }

  const uploadId = sessionStartBody.uploadId;
  const uploadToken = sessionStartBody.uploadToken;
  const chunkSizeBytes = Math.max(256 * 1024, Math.min(Number(sessionStartBody.chunkSizeBytes) || 4 * 1024 * 1024, 16 * 1024 * 1024));

  let uploadedBytes = 0;
  try {
    while (uploadedBytes < input.file.size) {
      const chunkBlob = input.file.slice(uploadedBytes, uploadedBytes + chunkSizeBytes);
      const chunkBuffer = await chunkBlob.arrayBuffer();
      const chunkResponse = await fetch(
        `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(
          input.streamId
        )}/entries/upload-session/${encodeURIComponent(uploadId)}/chunk?offset=${uploadedBytes}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-dstream-upload-token": uploadToken
          },
          body: chunkBuffer,
          cache: "no-store"
        }
      );
      const chunkBody = (await parseJsonResponse(chunkResponse)) as AccessApiResult<{
        receivedBytes?: number;
        expectedOffset?: number;
      }> | null;
      const expectedOffset =
        chunkBody &&
        typeof chunkBody === "object" &&
        "expectedOffset" in chunkBody &&
        typeof (chunkBody as { expectedOffset?: unknown }).expectedOffset === "number"
          ? (chunkBody as { expectedOffset: number }).expectedOffset
          : null;
      if (!chunkResponse.ok || !chunkBody?.ok || typeof chunkBody.receivedBytes !== "number") {
        if (chunkResponse.status === 409 && expectedOffset !== null) {
          uploadedBytes = expectedOffset;
          input.onProgress?.(uploadedBytes, input.file.size);
          continue;
        }
        throw new Error(asErrorMessage(chunkBody, "Failed to upload Video chunk."));
      }
      uploadedBytes = chunkBody.receivedBytes;
      input.onProgress?.(uploadedBytes, input.file.size);
    }

    const completeResponse = await fetch(
      `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(
        input.streamId
      )}/entries/upload-session/${encodeURIComponent(uploadId)}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadToken }),
        cache: "no-store"
      }
    );
    const completeBody = (await parseJsonResponse(completeResponse)) as AccessApiResult<{
      hostPubkey?: string;
      streamId?: string;
      originStreamId?: string;
      relativePath?: string;
      fileName?: string;
      fileSizeBytes?: number;
      entry?: VideoCatalogEntry;
    }> | null;
    if (
      !completeResponse.ok ||
      !completeBody?.ok ||
      typeof completeBody.hostPubkey !== "string" ||
      typeof completeBody.streamId !== "string" ||
      typeof completeBody.originStreamId !== "string" ||
      typeof completeBody.relativePath !== "string" ||
      typeof completeBody.fileName !== "string" ||
      typeof completeBody.fileSizeBytes !== "number" ||
      !completeBody.entry
    ) {
      throw new Error(asErrorMessage(completeBody, "Failed to complete Video upload session."));
    }
    input.onProgress?.(input.file.size, input.file.size);
    return {
      hostPubkey: completeBody.hostPubkey,
      streamId: completeBody.streamId,
      originStreamId: completeBody.originStreamId,
      relativePath: completeBody.relativePath,
      fileName: completeBody.fileName,
      fileSizeBytes: completeBody.fileSizeBytes,
      actorPubkey: typeof sessionStartBody.actorPubkey === "string" ? sessionStartBody.actorPubkey : null,
      entry: completeBody.entry
    };
  } catch (error) {
    try {
      await fetch(
        `/api/video/catalog/${encodeURIComponent(input.hostPubkey)}/${encodeURIComponent(
          input.streamId
        )}/entries/upload-session/${encodeURIComponent(uploadId)}/abort`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uploadToken }),
          cache: "no-store"
        }
      );
    } catch {
      // ignore
    }
    throw error;
  }
}

export async function buildAccessAdminProof(
  signEvent: ((event: Omit<NostrEvent, "id" | "sig">) => Promise<NostrEvent>) | undefined,
  pubkey: string | null | undefined,
  hostPubkey: string,
  ttlSec = 600
): Promise<NostrEvent | null> {
  return buildAccessProof(signEvent, pubkey, {
    scope: "access_admin",
    hostPubkey,
    ttlSec
  });
}

export async function buildAccessViewerProof(
  signEvent: ((event: Omit<NostrEvent, "id" | "sig">) => Promise<NostrEvent>) | undefined,
  pubkey: string | null | undefined,
  hostPubkey: string,
  ttlSec = 900
): Promise<NostrEvent | null> {
  return buildAccessProof(signEvent, pubkey, {
    scope: "access_viewer",
    hostPubkey,
    ttlSec
  });
}

export async function buildAccessProof(
  signEvent: ((event: Omit<NostrEvent, "id" | "sig">) => Promise<NostrEvent>) | undefined,
  pubkey: string | null | undefined,
  input: {
    scope: string;
    hostPubkey?: string;
    packageId?: string;
    ttlSec?: number;
  }
): Promise<NostrEvent | null> {
  if (!signEvent || !pubkey) return null;
  const expiresAtSec = nowSec() + Math.max(60, Math.min(input.ttlSec ?? 600, 3600));
  const tags: string[][] = [
    ["dstream", input.scope],
    ["exp", String(expiresAtSec)]
  ];
  if (input.hostPubkey) tags.push(["host", input.hostPubkey]);
  if (input.packageId) tags.push(["pkg", input.packageId]);
  const unsigned: Omit<NostrEvent, "id" | "sig"> = {
    kind: 27235,
    pubkey,
    created_at: nowSec(),
    tags,
    content: ""
  };
  try {
    return await signEvent(unsigned);
  } catch {
    return null;
  }
}

export async function buildAccessPurchaseProof(
  signEvent: ((event: Omit<NostrEvent, "id" | "sig">) => Promise<NostrEvent>) | undefined,
  pubkey: string | null | undefined,
  input: { hostPubkey: string; packageId: string; ttlSec?: number }
): Promise<NostrEvent | null> {
  return buildAccessProof(signEvent, pubkey, {
    scope: "access_purchase",
    hostPubkey: input.hostPubkey,
    packageId: input.packageId,
    ttlSec: input.ttlSec ?? 600
  });
}

export async function listVideoAccessPackagesClient(input: {
  hostPubkey: string;
  streamId?: string;
  includeDisabled?: boolean;
  includeUnlisted?: boolean;
  includePurchaseStats?: boolean;
  purchaseStatsLimit?: number;
  limit?: number;
  operatorProofEvent?: NostrEvent;
}): Promise<{ packages: VideoAccessPackage[]; count: number; actorPubkey: string | null; purchaseStatsByPackageId: Record<string, VideoPackagePurchaseStats> }> {
  const response = await fetch("/api/access/video-packages/list", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostPubkey: input.hostPubkey,
      streamId: input.streamId,
      includeDisabled: input.includeDisabled,
      includeUnlisted: input.includeUnlisted,
      includePurchaseStats: input.includePurchaseStats,
      purchaseStatsLimit: input.purchaseStatsLimit,
      limit: input.limit,
      operatorProofEvent: input.operatorProofEvent
    }),
    cache: "no-store"
  });
  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    packages?: VideoAccessPackage[];
    count?: number;
    actorPubkey?: string | null;
    purchaseStatsByPackageId?: Record<string, VideoPackagePurchaseStats>;
  }> | null;
  if (!response.ok || !body?.ok || !Array.isArray(body.packages)) {
    throw new Error(asErrorMessage(body, "Failed to load Video packages."));
  }
  return {
    packages: body.packages,
    count: typeof body.count === "number" ? body.count : body.packages.length,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null,
    purchaseStatsByPackageId:
      body.purchaseStatsByPackageId && typeof body.purchaseStatsByPackageId === "object"
        ? body.purchaseStatsByPackageId
        : {}
  };
}

export async function listVideoPackageViewerStatusClient(input: {
  hostPubkey: string;
  viewerProofEvent: NostrEvent;
  streamId?: string;
  status?: AccessEntitlementStatusFilter;
  limit?: number;
}): Promise<{
  hostPubkey: string;
  streamId: string | null;
  viewerPubkey: string;
  unlocks: VideoPackageViewerUnlock[];
  byPackageId: Record<string, VideoPackageViewerUnlock>;
  count: number;
}> {
  const response = await fetch("/api/access/video-packages/viewer-status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostPubkey: input.hostPubkey,
      streamId: input.streamId,
      viewerProofEvent: input.viewerProofEvent,
      status: input.status ?? "active",
      limit: input.limit
    }),
    cache: "no-store"
  });

  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    hostPubkey?: string;
    streamId?: string | null;
    viewerPubkey?: string;
    unlocks?: VideoPackageViewerUnlock[];
    byPackageId?: Record<string, Omit<VideoPackageViewerUnlock, "packageId">>;
    count?: number;
  }> | null;

  if (
    !response.ok ||
    !body?.ok ||
    typeof body.hostPubkey !== "string" ||
    typeof body.viewerPubkey !== "string" ||
    !Array.isArray(body.unlocks) ||
    !body.byPackageId ||
    typeof body.byPackageId !== "object"
  ) {
    throw new Error(asErrorMessage(body, "Failed to load viewer Video package status."));
  }

  const byPackageId: Record<string, VideoPackageViewerUnlock> = {};
  for (const [packageId, value] of Object.entries(body.byPackageId)) {
    if (!value || typeof value !== "object") continue;
    byPackageId[packageId] = {
      ...(value as Omit<VideoPackageViewerUnlock, "packageId">),
      packageId
    };
  }

  return {
    hostPubkey: body.hostPubkey,
    streamId: typeof body.streamId === "string" ? body.streamId : null,
    viewerPubkey: body.viewerPubkey,
    unlocks: body.unlocks,
    byPackageId,
    count: typeof body.count === "number" ? body.count : body.unlocks.length
  };
}

export async function upsertVideoAccessPackageClient(input: {
  hostPubkey: string;
  streamId: string;
  title: string;
  paymentAsset: StreamPaymentAsset;
  paymentAmount: string;
  durationHours: number;
  packageId?: string;
  playlistId?: string;
  relativePath?: string;
  description?: string;
  paymentRailId?: string;
  status?: VideoAccessPackageStatus;
  visibility?: VideoAccessPackageVisibility;
  metadata?: Record<string, unknown>;
  operatorProofEvent: NostrEvent;
}): Promise<{ package: VideoAccessPackage; actorPubkey: string | null }> {
  const response = await fetch("/api/access/video-packages/upsert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostPubkey: input.hostPubkey,
      streamId: input.streamId,
      title: input.title,
      paymentAsset: input.paymentAsset,
      paymentAmount: input.paymentAmount,
      durationHours: input.durationHours,
      packageId: input.packageId,
      playlistId: input.playlistId,
      relativePath: input.relativePath,
      description: input.description,
      paymentRailId: input.paymentRailId,
      status: input.status,
      visibility: input.visibility,
      metadata: input.metadata ?? {},
      operatorProofEvent: input.operatorProofEvent
    }),
    cache: "no-store"
  });
  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    package?: VideoAccessPackage;
    actorPubkey?: string | null;
  }> | null;
  if (!response.ok || !body?.ok || !body.package) {
    throw new Error(asErrorMessage(body, "Failed to save Video package."));
  }
  return {
    package: body.package,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null
  };
}

export async function disableVideoAccessPackageClient(input: {
  hostPubkey: string;
  packageId: string;
  operatorProofEvent: NostrEvent;
}): Promise<{ package: VideoAccessPackage; actorPubkey: string | null }> {
  const response = await fetch("/api/access/video-packages/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostPubkey: input.hostPubkey,
      packageId: input.packageId,
      operatorProofEvent: input.operatorProofEvent
    }),
    cache: "no-store"
  });
  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    package?: VideoAccessPackage;
    actorPubkey?: string | null;
  }> | null;
  if (!response.ok || !body?.ok || !body.package) {
    throw new Error(asErrorMessage(body, "Failed to disable Video package."));
  }
  return {
    package: body.package,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null
  };
}

export async function purchaseVideoAccessPackageClient(input: {
  packageId: string;
  buyerProofEvent: NostrEvent;
  sourceRef?: string;
  settlementRef?: string;
  stakeSessionToken?: string;
  operatorProofEvent?: NostrEvent;
  verifiedByOperator?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<{
  package: VideoAccessPackage;
  entitlement: AccessEntitlement;
  purchase: {
    id: string;
    source: AccessEntitlementSource;
    sourceRef: string;
    status: "granted" | "existing";
    expiresAtSec?: number;
  };
  checkout?: {
    purchasePolicy: VideoPurchasePolicy;
    verificationMode: VideoCheckoutVerificationMode;
  };
  granted: boolean;
  actorPubkey: string | null;
}> {
  const response = await fetch("/api/access/video-packages/purchase", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      packageId: input.packageId,
      buyerProofEvent: input.buyerProofEvent,
      sourceRef: input.sourceRef,
      settlementRef: input.settlementRef,
      stakeSessionToken: input.stakeSessionToken,
      operatorProofEvent: input.operatorProofEvent,
      verifiedByOperator: input.verifiedByOperator,
      metadata: input.metadata ?? {}
    }),
    cache: "no-store"
  });
  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    package?: VideoAccessPackage;
    entitlement?: AccessEntitlement;
    purchase?: {
      id: string;
      source: AccessEntitlementSource;
      sourceRef: string;
      status: "granted" | "existing";
      expiresAtSec?: number;
    };
    checkout?: {
      purchasePolicy?: VideoPurchasePolicy;
      verificationMode?: VideoCheckoutVerificationMode;
    };
    granted?: boolean;
    actorPubkey?: string | null;
  }> | null;

  if (!response.ok || !body?.ok || !body.package || !body.entitlement || !body.purchase) {
    throw new Error(asErrorMessage(body, "Failed to grant package access."));
  }

  return {
    package: body.package,
    entitlement: body.entitlement,
    purchase: body.purchase,
    checkout:
      body.checkout &&
      typeof body.checkout.purchasePolicy === "string" &&
      typeof body.checkout.verificationMode === "string"
        ? {
            purchasePolicy: body.checkout.purchasePolicy,
            verificationMode: body.checkout.verificationMode
          }
        : undefined,
    granted: body.granted !== false,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null
  };
}

export async function listAccessEntitlementsClient(input: {
  hostPubkey: string;
  operatorProofEvent: NostrEvent;
  subjectPubkey?: string;
  resourceId?: string;
  status?: AccessEntitlementStatusFilter;
  limit?: number;
}): Promise<{ entitlements: AccessEntitlement[]; count: number; actorPubkey: string | null }> {
  const response = await fetch("/api/access/entitlements/list", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostPubkey: input.hostPubkey,
      operatorProofEvent: input.operatorProofEvent,
      subjectPubkey: input.subjectPubkey,
      resourceId: input.resourceId,
      status: input.status ?? "active",
      limit: input.limit
    }),
    cache: "no-store"
  });

  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    entitlements?: AccessEntitlement[];
    count?: number;
    actorPubkey?: string | null;
  }> | null;

  if (!response.ok || !body?.ok || !Array.isArray(body.entitlements)) {
    throw new Error(asErrorMessage(body, "Failed to load entitlements."));
  }

  return {
    entitlements: body.entitlements,
    count: typeof body.count === "number" ? body.count : body.entitlements.length,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null
  };
}

export async function grantAccessEntitlementClient(input: {
  hostPubkey: string;
  subjectPubkey: string;
  resourceId: string;
  actions: AccessAction[];
  source?: AccessEntitlementSource;
  sourceRef?: string;
  startsAtSec?: number;
  expiresAtSec?: number;
  metadata?: Record<string, unknown>;
  operatorProofEvent: NostrEvent;
}): Promise<{ entitlement: AccessEntitlement; actorPubkey: string | null }> {
  const response = await fetch("/api/access/entitlements/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostPubkey: input.hostPubkey,
      subjectPubkey: input.subjectPubkey,
      resourceId: input.resourceId,
      actions: input.actions,
      source: input.source ?? "manual_grant",
      sourceRef: input.sourceRef ?? undefined,
      startsAtSec: input.startsAtSec,
      expiresAtSec: input.expiresAtSec,
      metadata: input.metadata ?? {},
      operatorProofEvent: input.operatorProofEvent
    }),
    cache: "no-store"
  });

  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    entitlement?: AccessEntitlement;
    actorPubkey?: string | null;
  }> | null;

  if (!response.ok || !body?.ok || !body.entitlement) {
    throw new Error(asErrorMessage(body, "Failed to grant entitlement."));
  }

  return {
    entitlement: body.entitlement,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null
  };
}

export async function revokeAccessEntitlementClient(input: {
  entitlementId: string;
  hostPubkey: string;
  revokeReason?: string;
  operatorProofEvent: NostrEvent;
}): Promise<{ entitlement: AccessEntitlement; actorPubkey: string | null }> {
  const response = await fetch("/api/access/entitlements/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      entitlementId: input.entitlementId,
      hostPubkey: input.hostPubkey,
      revokeReason: input.revokeReason,
      operatorProofEvent: input.operatorProofEvent
    }),
    cache: "no-store"
  });

  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    entitlement?: AccessEntitlement;
    actorPubkey?: string | null;
  }> | null;

  if (!response.ok || !body?.ok || !body.entitlement) {
    throw new Error(asErrorMessage(body, "Failed to revoke entitlement."));
  }

  return {
    entitlement: body.entitlement,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null
  };
}

export async function listAccessDenyRulesClient(input: {
  hostPubkey: string;
  operatorProofEvent: NostrEvent;
  subjectPubkey?: string;
  resourceId?: string;
  limit?: number;
}): Promise<{ denyRules: AccessDenyRule[]; count: number; actorPubkey: string | null }> {
  const response = await fetch("/api/access/denies/list", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostPubkey: input.hostPubkey,
      operatorProofEvent: input.operatorProofEvent,
      subjectPubkey: input.subjectPubkey,
      resourceId: input.resourceId,
      limit: input.limit
    }),
    cache: "no-store"
  });

  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    denyRules?: AccessDenyRule[];
    count?: number;
    actorPubkey?: string | null;
  }> | null;

  if (!response.ok || !body?.ok || !Array.isArray(body.denyRules)) {
    throw new Error(asErrorMessage(body, "Failed to load deny rules."));
  }

  return {
    denyRules: body.denyRules,
    count: typeof body.count === "number" ? body.count : body.denyRules.length,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null
  };
}

export async function upsertAccessDenyRuleClient(input: {
  hostPubkey: string;
  subjectPubkey: string;
  resourceId: string;
  actions: AccessAction[];
  reason?: string;
  startsAtSec?: number;
  expiresAtSec?: number;
  operatorProofEvent: NostrEvent;
}): Promise<{ denyRule: AccessDenyRule; actorPubkey: string | null }> {
  const response = await fetch("/api/access/denies/upsert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostPubkey: input.hostPubkey,
      subjectPubkey: input.subjectPubkey,
      resourceId: input.resourceId,
      actions: input.actions,
      reason: input.reason,
      startsAtSec: input.startsAtSec,
      expiresAtSec: input.expiresAtSec,
      operatorProofEvent: input.operatorProofEvent
    }),
    cache: "no-store"
  });

  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    denyRule?: AccessDenyRule;
    actorPubkey?: string | null;
  }> | null;

  if (!response.ok || !body?.ok || !body.denyRule) {
    throw new Error(asErrorMessage(body, "Failed to upsert deny rule."));
  }

  return {
    denyRule: body.denyRule,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null
  };
}

export async function listAccessAuditClient(input: {
  hostPubkey: string;
  operatorProofEvent: NostrEvent;
  subjectPubkey?: string;
  resourceId?: string;
  limit?: number;
}): Promise<{ audit: AccessAuditRecord[]; count: number; actorPubkey: string | null }> {
  const response = await fetch("/api/access/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostPubkey: input.hostPubkey,
      operatorProofEvent: input.operatorProofEvent,
      subjectPubkey: input.subjectPubkey,
      resourceId: input.resourceId,
      limit: input.limit
    }),
    cache: "no-store"
  });

  const body = (await parseJsonResponse(response)) as AccessApiResult<{
    audit?: AccessAuditRecord[];
    count?: number;
    actorPubkey?: string | null;
  }> | null;

  if (!response.ok || !body?.ok || !Array.isArray(body.audit)) {
    throw new Error(asErrorMessage(body, "Failed to load access audit records."));
  }

  return {
    audit: body.audit,
    count: typeof body.count === "number" ? body.count : body.audit.length,
    actorPubkey: typeof body.actorPubkey === "string" ? body.actorPubkey : null
  };
}
