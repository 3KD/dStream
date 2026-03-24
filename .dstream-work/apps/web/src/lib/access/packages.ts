import { createHash, randomUUID } from "node:crypto";
import { STREAM_PAYMENT_ASSETS, type StreamPaymentAsset } from "@dstream/protocol";
import { grantAccessEntitlement, listAccessEntitlements } from "./store";
import type { AccessEntitlement, AccessEntitlementSource } from "./types";
import { readTextFileWithBackup, writeJsonFileAtomic } from "../storage/jsonFileStore";

const STORE_PATH =
  (process.env.DSTREAM_VOD_PACKAGE_STORE_PATH ?? "/var/lib/dstream/vod-packages.json").trim() ||
  "/var/lib/dstream/vod-packages.json";
const MAX_PACKAGES = 10000;
const MAX_PURCHASES = 100000;
const STREAM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PLAYLIST_ID_RE = /^(?:__root__|[A-Za-z0-9][A-Za-z0-9._-]{0,79})$/;

export type VodAccessPackageStatus = "active" | "disabled";
export type VodAccessPackageVisibility = "public" | "unlisted";

export interface VodAccessPackage {
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
  status: VodAccessPackageStatus;
  visibility: VodAccessPackageVisibility;
  metadata: Record<string, unknown>;
  createdAtSec: number;
  updatedAtSec: number;
}

export type VodPackagePurchaseStatus = "granted" | "existing";

export interface VodPackagePurchaseRecord {
  id: string;
  packageId: string;
  hostPubkey: string;
  viewerPubkey: string;
  source: AccessEntitlementSource;
  sourceRef: string;
  status: VodPackagePurchaseStatus;
  entitlementId: string;
  resourceId: string;
  createdAtSec: number;
  expiresAtSec?: number;
  settlementRef?: string;
  metadata: Record<string, unknown>;
}

export interface VodPackagePurchaseStats {
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

let loaded = false;
let packagesCache: VodAccessPackage[] = [];
let purchasesCache: VodPackagePurchaseRecord[] = [];

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizePubkeyHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function sanitizeShortText(input: unknown, maxLen = 240): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  return value.slice(0, maxLen);
}

function sanitizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  try {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parsePositiveInt(input: unknown): number | null {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) return null;
  return Math.trunc(value);
}

function parseStatus(input: unknown): VodAccessPackageStatus {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  return value === "disabled" ? "disabled" : "active";
}

function parseVisibility(input: unknown): VodAccessPackageVisibility {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  return value === "unlisted" ? "unlisted" : "public";
}

function normalizeStreamId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!STREAM_ID_RE.test(value)) return null;
  return value;
}

function normalizePlaylistId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value) return undefined;
  if (!PLAYLIST_ID_RE.test(value)) return undefined;
  return value;
}

function normalizeRelativePath(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim().replace(/\\/g, "/");
  if (!value) return undefined;
  const segments = value.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;
  const safeSegments: string[] = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed === "." || trimmed === "..") return undefined;
    if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\u0000")) return undefined;
    safeSegments.push(trimmed);
  }
  return safeSegments.join("/");
}

function normalizePaymentAsset(input: unknown): StreamPaymentAsset | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return STREAM_PAYMENT_ASSETS.includes(value as StreamPaymentAsset) ? (value as StreamPaymentAsset) : null;
}

function normalizeAmount(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  const match = value.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = (match[1] ?? "0").replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (whole === "0" && !fraction) return null;
  return fraction ? `${whole}.${fraction}` : whole;
}

function normalizeSource(input: unknown): AccessEntitlementSource {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value === "purchase_verified" || value === "purchase_unverified") return value;
  return "purchase_unverified";
}

function parseStoredPackage(input: unknown): VodAccessPackage | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<VodAccessPackage>;
  if (typeof row.id !== "string" || !row.id) return null;
  const hostPubkey = normalizePubkeyHex(row.hostPubkey);
  const streamId = normalizeStreamId(row.streamId);
  const title = sanitizeShortText(row.title, 120);
  const paymentAsset = normalizePaymentAsset(row.paymentAsset);
  const paymentAmount = normalizeAmount(row.paymentAmount);
  const durationHours = parsePositiveInt(row.durationHours);
  const resourceId = sanitizeShortText(row.resourceId, 400);
  if (!hostPubkey || !streamId || !title || !paymentAsset || !paymentAmount || !durationHours || !resourceId) return null;
  const createdAtSec = parsePositiveInt(row.createdAtSec);
  const updatedAtSec = parsePositiveInt(row.updatedAtSec);
  if (!createdAtSec || !updatedAtSec) return null;
  return {
    id: row.id,
    hostPubkey,
    streamId,
    playlistId: normalizePlaylistId(row.playlistId),
    relativePath: normalizeRelativePath((row as { relativePath?: unknown }).relativePath),
    resourceId,
    title,
    description: sanitizeShortText(row.description, 500) ?? undefined,
    paymentAsset,
    paymentAmount,
    paymentRailId: sanitizeShortText(row.paymentRailId, 80) ?? undefined,
    durationHours,
    status: parseStatus(row.status),
    visibility: parseVisibility(row.visibility),
    metadata: sanitizeMetadata(row.metadata),
    createdAtSec,
    updatedAtSec
  };
}

function parseStoredPurchase(input: unknown): VodPackagePurchaseRecord | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<VodPackagePurchaseRecord>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.packageId !== "string" || !row.packageId) return null;
  const hostPubkey = normalizePubkeyHex(row.hostPubkey);
  const viewerPubkey = normalizePubkeyHex(row.viewerPubkey);
  const sourceRef = sanitizeShortText(row.sourceRef, 240);
  const entitlementId = sanitizeShortText(row.entitlementId, 120);
  const resourceId = sanitizeShortText(row.resourceId, 400);
  const createdAtSec = parsePositiveInt(row.createdAtSec);
  if (!hostPubkey || !viewerPubkey || !sourceRef || !entitlementId || !resourceId || !createdAtSec) return null;
  return {
    id: row.id,
    packageId: row.packageId,
    hostPubkey,
    viewerPubkey,
    source: normalizeSource(row.source),
    sourceRef,
    status: row.status === "existing" ? "existing" : "granted",
    entitlementId,
    resourceId,
    createdAtSec,
    expiresAtSec: parsePositiveInt(row.expiresAtSec) ?? undefined,
    settlementRef: sanitizeShortText(row.settlementRef, 240) ?? undefined,
    metadata: sanitizeMetadata(row.metadata)
  };
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = readTextFileWithBackup(STORE_PATH);
    if (!raw) throw new Error("no store");
    const parsed = JSON.parse(raw) as { packages?: unknown[]; purchases?: unknown[] } | null;
    const packageRows = Array.isArray(parsed?.packages) ? parsed!.packages! : [];
    const purchaseRows = Array.isArray(parsed?.purchases) ? parsed!.purchases! : [];
    packagesCache = packageRows.map(parseStoredPackage).filter((row): row is VodAccessPackage => !!row);
    purchasesCache = purchaseRows.map(parseStoredPurchase).filter((row): row is VodPackagePurchaseRecord => !!row);
  } catch {
    packagesCache = [];
    purchasesCache = [];
  }
}

function persist(): void {
  try {
    writeJsonFileAtomic(STORE_PATH, {
      version: 1,
      updatedAtSec: nowSec(),
      packages: packagesCache,
      purchases: purchasesCache
    });
  } catch {
    // ignore persistence failures
  }
}

function includeAction(candidate: string[], required: string): boolean {
  if (candidate.includes("*")) return true;
  return candidate.includes(required);
}

export function buildVodPackageResourceId(hostPubkey: string, streamId: string, playlistId?: string): string {
  const playlist = normalizePlaylistId(playlistId);
  if (playlist) return `stream:${hostPubkey}:${streamId}:vod:${playlist}:*`;
  return `stream:${hostPubkey}:${streamId}:vod:*`;
}

export function buildVodFileResourceId(hostPubkey: string, streamId: string, relativePath: string): string {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) throw new Error("relativePath is invalid.");
  const encodedPath = Buffer.from(normalizedPath, "utf8").toString("base64url");
  return `stream:${hostPubkey}:${streamId}:vod:file:${encodedPath}`;
}

export function inferPlaylistIdFromRelativePath(relativePath: string): string {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) return "__root__";
  const firstSegment = normalizedPath.split("/")[0] ?? "";
  if (!firstSegment) return "__root__";
  return normalizePlaylistId(firstSegment) ?? "__root__";
}

export function buildVodAccessResourceCandidates(input: {
  hostPubkey: string;
  streamId: string;
  relativePath?: string;
  playlistId?: string;
}): string[] {
  const hostPubkey = normalizePubkeyHex(input.hostPubkey);
  const streamId = normalizeStreamId(input.streamId);
  if (!hostPubkey || !streamId) return [];

  const normalizedPath = normalizeRelativePath(input.relativePath);
  const explicitPlaylistId = normalizePlaylistId(input.playlistId);
  const candidates: string[] = [];

  if (normalizedPath) {
    candidates.push(buildVodFileResourceId(hostPubkey, streamId, normalizedPath));
    candidates.push(buildVodPackageResourceId(hostPubkey, streamId, inferPlaylistIdFromRelativePath(normalizedPath)));
  }
  if (explicitPlaylistId) candidates.push(buildVodPackageResourceId(hostPubkey, streamId, explicitPlaylistId));
  candidates.push(buildVodPackageResourceId(hostPubkey, streamId));

  const deduped = new Set<string>();
  for (const resourceId of candidates) {
    if (resourceId.trim()) deduped.add(resourceId);
  }
  return Array.from(deduped);
}

function buildSourceRefFromInput(input: {
  packageId: string;
  sourceRef?: string;
  settlementRef?: string;
  viewerPubkey: string;
  metadata?: Record<string, unknown>;
}): string {
  const direct = sanitizeShortText(input.sourceRef, 220);
  if (direct) return direct;
  const settlement = sanitizeShortText(input.settlementRef, 220);
  if (settlement) return `settlement:${settlement}`;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        packageId: input.packageId,
        viewerPubkey: input.viewerPubkey,
        metadata: sanitizeMetadata(input.metadata)
      })
    )
    .digest("hex")
    .slice(0, 16);
  return `purchase:${input.packageId}:${fingerprint}`;
}

export function getVodAccessPackageById(packageId: string): VodAccessPackage | null {
  ensureLoaded();
  const normalizedId = sanitizeShortText(packageId, 120);
  if (!normalizedId) return null;
  const row = packagesCache.find((entry) => entry.id === normalizedId);
  return row ? { ...row } : null;
}

export function listVodAccessPackages(options: {
  hostPubkey: string;
  streamId?: string;
  includeDisabled?: boolean;
  includeUnlisted?: boolean;
  limit?: number;
}): VodAccessPackage[] {
  ensureLoaded();
  const hostPubkey = normalizePubkeyHex(options.hostPubkey);
  if (!hostPubkey) return [];
  const streamId = options.streamId ? normalizeStreamId(options.streamId) : undefined;
  const includeDisabled = !!options.includeDisabled;
  const includeUnlisted = !!options.includeUnlisted;
  const limit = Math.max(1, Math.min(options.limit ?? 200, MAX_PACKAGES));

  return packagesCache
    .filter((row) => {
      if (row.hostPubkey !== hostPubkey) return false;
      if (streamId && row.streamId !== streamId) return false;
      if (!includeDisabled && row.status !== "active") return false;
      if (!includeUnlisted && row.visibility === "unlisted") return false;
      return true;
    })
    .sort((a, b) => b.updatedAtSec - a.updatedAtSec)
    .slice(0, limit)
    .map((row) => ({ ...row }));
}

export function upsertVodAccessPackage(input: {
  packageId?: string;
  hostPubkey: string;
  streamId: string;
  playlistId?: string;
  relativePath?: string;
  title: string;
  description?: string;
  paymentAsset: StreamPaymentAsset;
  paymentAmount: string;
  paymentRailId?: string;
  durationHours: number;
  status?: VodAccessPackageStatus;
  visibility?: VodAccessPackageVisibility;
  metadata?: Record<string, unknown>;
}): VodAccessPackage {
  ensureLoaded();
  const timestamp = nowSec();
  const hostPubkey = normalizePubkeyHex(input.hostPubkey);
  const streamId = normalizeStreamId(input.streamId);
  const playlistId = normalizePlaylistId(input.playlistId);
  const relativePath = normalizeRelativePath(input.relativePath);
  const title = sanitizeShortText(input.title, 120);
  const description = sanitizeShortText(input.description, 500) ?? undefined;
  const paymentAsset = normalizePaymentAsset(input.paymentAsset);
  const paymentAmount = normalizeAmount(input.paymentAmount);
  const paymentRailId = sanitizeShortText(input.paymentRailId, 80) ?? undefined;
  const durationHours = parsePositiveInt(input.durationHours);
  const status = parseStatus(input.status);
  const visibility = parseVisibility(input.visibility);
  if (!hostPubkey) throw new Error("hostPubkey must be a 64-char hex pubkey.");
  if (!streamId) throw new Error("streamId is invalid.");
  if (!title) throw new Error("title is required.");
  if (!paymentAsset) throw new Error("paymentAsset is invalid.");
  if (!paymentAmount) throw new Error("paymentAmount must be a positive decimal string.");
  if (!durationHours) throw new Error("durationHours must be a positive integer.");
  if (playlistId && relativePath) throw new Error("Only one package scope is allowed: playlistId or relativePath.");

  const resourceId = relativePath
    ? buildVodFileResourceId(hostPubkey, streamId, relativePath)
    : buildVodPackageResourceId(hostPubkey, streamId, playlistId);
  const packageId = sanitizeShortText(input.packageId, 120);
  if (packageId) {
    const existing = packagesCache.find((entry) => entry.id === packageId);
    if (!existing) throw new Error("VOD package not found.");
    if (existing.hostPubkey !== hostPubkey) throw new Error("Cannot update package for a different host.");
    existing.streamId = streamId;
    existing.playlistId = playlistId;
    existing.relativePath = relativePath;
    existing.resourceId = resourceId;
    existing.title = title;
    existing.description = description;
    existing.paymentAsset = paymentAsset;
    existing.paymentAmount = paymentAmount;
    existing.paymentRailId = paymentRailId;
    existing.durationHours = durationHours;
    existing.status = status;
    existing.visibility = visibility;
    existing.metadata = { ...existing.metadata, ...sanitizeMetadata(input.metadata) };
    existing.updatedAtSec = timestamp;
    persist();
    return { ...existing };
  }

  const created: VodAccessPackage = {
    id: randomUUID(),
    hostPubkey,
    streamId,
    playlistId,
    relativePath,
    resourceId,
    title,
    description,
    paymentAsset,
    paymentAmount,
    paymentRailId,
    durationHours,
    status,
    visibility,
    metadata: sanitizeMetadata(input.metadata),
    createdAtSec: timestamp,
    updatedAtSec: timestamp
  };

  packagesCache.push(created);
  packagesCache = packagesCache
    .sort((a, b) => b.updatedAtSec - a.updatedAtSec)
    .slice(0, MAX_PACKAGES);
  persist();
  return { ...created };
}

export function disableVodAccessPackage(input: { packageId: string; hostPubkey?: string }): VodAccessPackage {
  ensureLoaded();
  const packageId = sanitizeShortText(input.packageId, 120);
  if (!packageId) throw new Error("packageId is required.");
  const hostPubkey = input.hostPubkey ? normalizePubkeyHex(input.hostPubkey) : null;
  const existing = packagesCache.find((entry) => entry.id === packageId);
  if (!existing) throw new Error("VOD package not found.");
  if (hostPubkey && existing.hostPubkey !== hostPubkey) throw new Error("Package host mismatch.");
  existing.status = "disabled";
  existing.updatedAtSec = nowSec();
  persist();
  return { ...existing };
}

export function grantVodPackagePurchaseAccess(input: {
  packageId: string;
  viewerPubkey: string;
  source?: AccessEntitlementSource;
  sourceRef?: string;
  settlementRef?: string;
  startsAtSec?: number;
  metadata?: Record<string, unknown>;
}): { package: VodAccessPackage; entitlement: AccessEntitlement; purchase: VodPackagePurchaseRecord; granted: boolean } {
  ensureLoaded();
  const pkg = getVodAccessPackageById(input.packageId);
  if (!pkg) throw new Error("VOD package not found.");
  if (pkg.status !== "active") throw new Error("VOD package is disabled.");
  const viewerPubkey = normalizePubkeyHex(input.viewerPubkey);
  if (!viewerPubkey) throw new Error("viewerPubkey must be a 64-char hex pubkey.");

  const source = normalizeSource(input.source);
  const sourceRef = buildSourceRefFromInput({
    packageId: pkg.id,
    sourceRef: input.sourceRef,
    settlementRef: input.settlementRef,
    viewerPubkey,
    metadata: input.metadata
  });
  const startsAtSec = parsePositiveInt(input.startsAtSec) ?? nowSec();
  const expiresAtSec = startsAtSec + pkg.durationHours * 60 * 60;
  const activeMatch = listAccessEntitlements({
    hostPubkey: pkg.hostPubkey,
    subjectPubkey: viewerPubkey,
    resourceId: pkg.resourceId,
    status: "active",
    limit: 2000
  }).find((row) => row.source === source && row.sourceRef === sourceRef && includeAction(row.actions, "watch_vod"));

  const entitlement =
    activeMatch ??
    grantAccessEntitlement({
      hostPubkey: pkg.hostPubkey,
      subjectPubkey: viewerPubkey,
      resourceId: pkg.resourceId,
      actions: ["watch_vod"],
      source,
      sourceRef,
      startsAtSec,
      expiresAtSec,
      metadata: {
        packageId: pkg.id,
        streamId: pkg.streamId,
        playlistId: pkg.playlistId ?? null,
        relativePath: pkg.relativePath ?? null,
        paymentAsset: pkg.paymentAsset,
        paymentAmount: pkg.paymentAmount,
        ...sanitizeMetadata(input.metadata)
      }
    });

  const purchase: VodPackagePurchaseRecord = {
    id: randomUUID(),
    packageId: pkg.id,
    hostPubkey: pkg.hostPubkey,
    viewerPubkey,
    source,
    sourceRef,
    status: activeMatch ? "existing" : "granted",
    entitlementId: entitlement.id,
    resourceId: pkg.resourceId,
    createdAtSec: nowSec(),
    expiresAtSec: entitlement.expiresAtSec,
    settlementRef: sanitizeShortText(input.settlementRef, 240) ?? undefined,
    metadata: sanitizeMetadata(input.metadata)
  };
  purchasesCache.push(purchase);
  purchasesCache = purchasesCache
    .sort((a, b) => b.createdAtSec - a.createdAtSec)
    .slice(0, MAX_PURCHASES);
  persist();

  return {
    package: pkg,
    entitlement,
    purchase: { ...purchase },
    granted: !activeMatch
  };
}

export function listVodPackagePurchases(options: {
  hostPubkey: string;
  viewerPubkey?: string;
  packageId?: string;
  limit?: number;
}): VodPackagePurchaseRecord[] {
  ensureLoaded();
  const hostPubkey = normalizePubkeyHex(options.hostPubkey);
  if (!hostPubkey) return [];
  const viewerPubkey = options.viewerPubkey ? normalizePubkeyHex(options.viewerPubkey) : null;
  const packageId = sanitizeShortText(options.packageId, 120);
  const limit = Math.max(1, Math.min(options.limit ?? 200, MAX_PURCHASES));
  return purchasesCache
    .filter((row) => {
      if (row.hostPubkey !== hostPubkey) return false;
      if (viewerPubkey && row.viewerPubkey !== viewerPubkey) return false;
      if (packageId && row.packageId !== packageId) return false;
      return true;
    })
    .sort((a, b) => b.createdAtSec - a.createdAtSec)
    .slice(0, limit)
    .map((row) => ({ ...row }));
}

export function listVodPackagePurchaseStats(options: {
  hostPubkey: string;
  packageIds?: string[];
  limit?: number;
}): Record<string, VodPackagePurchaseStats> {
  ensureLoaded();
  const hostPubkey = normalizePubkeyHex(options.hostPubkey);
  if (!hostPubkey) return {};
  const packageIdSet =
    Array.isArray(options.packageIds) && options.packageIds.length > 0
      ? new Set(
          options.packageIds
            .map((value) => sanitizeShortText(value, 120))
            .filter((value): value is string => !!value)
        )
      : null;
  const limit = Math.max(1, Math.min(options.limit ?? 5000, MAX_PURCHASES));
  const summaries = new Map<
    string,
    {
      row: VodPackagePurchaseStats;
      viewers: Set<string>;
    }
  >();

  for (const purchase of purchasesCache.filter((row) => row.hostPubkey === hostPubkey).sort((a, b) => b.createdAtSec - a.createdAtSec).slice(0, limit)) {
    if (packageIdSet && !packageIdSet.has(purchase.packageId)) continue;
    let summary = summaries.get(purchase.packageId);
    if (!summary) {
      summary = {
        row: {
          packageId: purchase.packageId,
          totalPurchases: 0,
          grantedPurchases: 0,
          existingPurchases: 0,
          verifiedPurchases: 0,
          unverifiedPurchases: 0,
          operatorOverridePurchases: 0,
          unverifiedFallbackPurchases: 0,
          uniqueViewerCount: 0,
          latestPurchaseAtSec: undefined,
          latestGrantedAtSec: undefined
        },
        viewers: new Set<string>()
      };
      summaries.set(purchase.packageId, summary);
    }

    const stats = summary.row;
    stats.totalPurchases += 1;
    if (purchase.status === "granted") {
      stats.grantedPurchases += 1;
      stats.latestGrantedAtSec = Math.max(stats.latestGrantedAtSec ?? 0, purchase.createdAtSec);
    } else {
      stats.existingPurchases += 1;
    }
    if (purchase.source === "purchase_verified") stats.verifiedPurchases += 1;
    if (purchase.source === "purchase_unverified") stats.unverifiedPurchases += 1;
    if (purchase.metadata?.operatorOverride === true) stats.operatorOverridePurchases += 1;
    if (purchase.metadata?.unverifiedFallback === true) stats.unverifiedFallbackPurchases += 1;
    stats.latestPurchaseAtSec = Math.max(stats.latestPurchaseAtSec ?? 0, purchase.createdAtSec);
    summary.viewers.add(purchase.viewerPubkey);
  }

  const out: Record<string, VodPackagePurchaseStats> = {};
  for (const [packageId, summary] of summaries.entries()) {
    summary.row.uniqueViewerCount = summary.viewers.size;
    out[packageId] = summary.row;
  }
  return out;
}
