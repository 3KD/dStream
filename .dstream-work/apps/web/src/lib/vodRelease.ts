import type { VodAccessPackage } from "./access/client";
import type { AccessEntitlement } from "./access/types";

export interface VodReleaseEntryInput {
  relativePath: string;
  playlistId?: string;
  visibility: "public" | "unlisted" | "private";
  published: boolean;
}

export interface VodReleaseEntryCoverage {
  matchingPackageIds: string[];
  matchingActivePackageIds: string[];
  hasActiveCoverage: boolean;
}

export interface VodReleaseEntitlementCoverage {
  matchingEntitlementIds: string[];
  uniqueSubjectPubkeys: string[];
  hasActiveEntitlement: boolean;
  streamEntitlementCount: number;
  playlistEntitlementCount: number;
  fileEntitlementCount: number;
}

export interface VodReleaseSummary {
  totalEntries: number;
  publishedEntries: number;
  unpublishedEntries: number;
  privatePublishedEntries: number;
  privatePublishedCoveredEntries: number;
  privatePublishedMissingEntries: number;
  privatePublishedMissingRelativePaths: string[];
}

export function normalizeVodReleasePlaylistKey(playlistId?: string): string {
  const value = playlistId?.trim();
  if (!value || value === "__root__") return "__root__";
  return value;
}

export function inferVodReleasePlaylistKeyFromRelativePath(relativePath: string): string {
  const normalized = relativePath.trim().replace(/\\/g, "/");
  if (!normalized) return "__root__";
  const first = normalized.split("/").find((segment) => segment.trim().length > 0) ?? "";
  return normalizeVodReleasePlaylistKey(first);
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.trim().replace(/\\/g, "/");
}

function toBase64UrlUtf8(input: string): string {
  const maybeBuffer = (globalThis as { Buffer?: { from(input: string, encoding?: string): { toString(encoding: string): string } } }).Buffer;
  if (maybeBuffer?.from) {
    return maybeBuffer.from(input, "utf8").toString("base64url");
  }
  if (typeof btoa === "function" && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  throw new Error("Base64url encoding is unavailable in this runtime.");
}

function entitlementAllowsWatchVod(row: AccessEntitlement, nowSec: number): boolean {
  if (row.status !== "active") return false;
  if (row.startsAtSec > nowSec) return false;
  if (typeof row.expiresAtSec === "number" && row.expiresAtSec <= nowSec) return false;
  return row.actions.includes("watch_vod") || row.actions.includes("*");
}

function buildResourceIds(hostPubkey: string, streamId: string, entry: VodReleaseEntryInput): {
  streamResourceId: string;
  playlistResourceId: string;
  fileResourceId: string;
} {
  const normalizedRelativePath = normalizeRelativePath(entry.relativePath);
  const playlistKey = normalizeVodReleasePlaylistKey(entry.playlistId || inferVodReleasePlaylistKeyFromRelativePath(normalizedRelativePath));
  return {
    streamResourceId: `stream:${hostPubkey}:${streamId}:vod:*`,
    playlistResourceId: `stream:${hostPubkey}:${streamId}:vod:${playlistKey}:*`,
    fileResourceId: `stream:${hostPubkey}:${streamId}:vod:file:${toBase64UrlUtf8(normalizedRelativePath)}`
  };
}

function matchesPackageScope(vodPackage: VodAccessPackage, entry: VodReleaseEntryInput): boolean {
  const entryRelativePath = normalizeRelativePath(entry.relativePath);
  const entryPlaylistKey = normalizeVodReleasePlaylistKey(entry.playlistId || inferVodReleasePlaylistKeyFromRelativePath(entryRelativePath));
  const packageRelativePath = vodPackage.relativePath ? normalizeRelativePath(vodPackage.relativePath) : "";
  if (packageRelativePath) return packageRelativePath === entryRelativePath;
  if (vodPackage.playlistId) return normalizeVodReleasePlaylistKey(vodPackage.playlistId) === entryPlaylistKey;
  return true;
}

export function buildVodPricingCoverage(
  entries: VodReleaseEntryInput[],
  vodPackages: VodAccessPackage[]
): Record<string, VodReleaseEntryCoverage> {
  const coverage: Record<string, VodReleaseEntryCoverage> = {};
  for (const entry of entries) {
    const matching = vodPackages.filter((vodPackage) => matchesPackageScope(vodPackage, entry));
    const matchingActive = matching.filter((vodPackage) => vodPackage.status === "active");
    coverage[entry.relativePath] = {
      matchingPackageIds: matching.map((vodPackage) => vodPackage.id),
      matchingActivePackageIds: matchingActive.map((vodPackage) => vodPackage.id),
      hasActiveCoverage: matchingActive.length > 0
    };
  }
  return coverage;
}

export function summarizeVodRelease(
  entries: VodReleaseEntryInput[],
  coverageByRelativePath: Record<string, VodReleaseEntryCoverage>
): VodReleaseSummary {
  let publishedEntries = 0;
  let privatePublishedEntries = 0;
  let privatePublishedCoveredEntries = 0;
  const privatePublishedMissingRelativePaths: string[] = [];

  for (const entry of entries) {
    if (entry.published) publishedEntries += 1;
    const isPrivatePublished = entry.published && entry.visibility === "private";
    if (!isPrivatePublished) continue;
    privatePublishedEntries += 1;
    const coverage = coverageByRelativePath[entry.relativePath];
    if (coverage?.hasActiveCoverage) privatePublishedCoveredEntries += 1;
    else privatePublishedMissingRelativePaths.push(entry.relativePath);
  }

  return {
    totalEntries: entries.length,
    publishedEntries,
    unpublishedEntries: Math.max(0, entries.length - publishedEntries),
    privatePublishedEntries,
    privatePublishedCoveredEntries,
    privatePublishedMissingEntries: privatePublishedMissingRelativePaths.length,
    privatePublishedMissingRelativePaths
  };
}

export function buildVodEntitlementCoverage(
  entries: VodReleaseEntryInput[],
  entitlements: AccessEntitlement[],
  input: {
    hostPubkey: string;
    streamId: string;
    nowSec?: number;
  }
): Record<string, VodReleaseEntitlementCoverage> {
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  const indexed = new Map<string, AccessEntitlement[]>();
  for (const entitlement of entitlements) {
    if (!entitlementAllowsWatchVod(entitlement, now)) continue;
    const rows = indexed.get(entitlement.resourceId) ?? [];
    rows.push(entitlement);
    indexed.set(entitlement.resourceId, rows);
  }

  const coverage: Record<string, VodReleaseEntitlementCoverage> = {};
  for (const entry of entries) {
    const ids = buildResourceIds(input.hostPubkey, input.streamId, entry);
    const streamRows = indexed.get(ids.streamResourceId) ?? [];
    const playlistRows = indexed.get(ids.playlistResourceId) ?? [];
    const fileRows = indexed.get(ids.fileResourceId) ?? [];
    const combined = [...streamRows, ...playlistRows, ...fileRows];
    const uniqueEntitlementIds = Array.from(new Set(combined.map((row) => row.id)));
    const uniqueSubjectPubkeys = Array.from(new Set(combined.map((row) => row.subjectPubkey)));

    coverage[entry.relativePath] = {
      matchingEntitlementIds: uniqueEntitlementIds,
      uniqueSubjectPubkeys,
      hasActiveEntitlement: uniqueEntitlementIds.length > 0,
      streamEntitlementCount: streamRows.length,
      playlistEntitlementCount: playlistRows.length,
      fileEntitlementCount: fileRows.length
    };
  }
  return coverage;
}
