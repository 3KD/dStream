import { randomUUID } from "node:crypto";
import type {
  AccessAuditRecord,
  AccessDenyRule,
  AccessEntitlement,
  AccessEntitlementSource,
  AccessEntitlementStatus
} from "./types";
import { readTextFileWithBackup, writeJsonFileAtomic } from "../storage/jsonFileStore";

const STORE_PATH =
  (process.env.DSTREAM_ACCESS_STORE_PATH ?? "/var/lib/dstream/access.json").trim() || "/var/lib/dstream/access.json";
const MAX_ENTITLEMENTS = 20000;
const MAX_DENIES = 20000;
const MAX_AUDIT = 50000;

let loaded = false;
let entitlementsCache: AccessEntitlement[] = [];
let denyRulesCache: AccessDenyRule[] = [];
let auditCache: AccessAuditRecord[] = [];

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

function sanitizeActions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const unique = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  const raw = Number(value);
  if (!Number.isInteger(raw)) return undefined;
  if (raw <= 0) return undefined;
  return raw;
}

function parseEntitlementStatus(input: unknown): AccessEntitlementStatus {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value === "revoked" || value === "expired" || value === "active") return value;
  return "active";
}

function parseEntitlementSource(input: unknown): AccessEntitlementSource {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  switch (value) {
    case "owner_grant":
    case "vip_waiver":
    case "guild_waiver":
    case "purchase_verified":
    case "purchase_unverified":
    case "manual_grant":
    case "migration":
      return value;
    default:
      return "manual_grant";
  }
}

function parseStoredEntitlement(input: unknown): AccessEntitlement | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<AccessEntitlement>;
  if (typeof row.id !== "string" || !row.id) return null;
  const hostPubkey = normalizePubkeyHex(row.hostPubkey);
  const subjectPubkey = normalizePubkeyHex(row.subjectPubkey);
  if (!hostPubkey || !subjectPubkey) return null;
  const resourceId = sanitizeShortText(row.resourceId, 400);
  if (!resourceId) return null;
  const actions = sanitizeActions(row.actions);
  if (actions.length === 0) return null;
  const startsAtSec = parseOptionalPositiveInt(row.startsAtSec);
  const createdAtSec = parseOptionalPositiveInt(row.createdAtSec);
  const updatedAtSec = parseOptionalPositiveInt(row.updatedAtSec);
  if (!startsAtSec || !createdAtSec || !updatedAtSec) return null;
  return {
    id: row.id,
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions,
    source: parseEntitlementSource(row.source),
    sourceRef: sanitizeShortText(row.sourceRef, 400) ?? undefined,
    status: parseEntitlementStatus(row.status),
    startsAtSec,
    expiresAtSec: parseOptionalPositiveInt(row.expiresAtSec),
    revokedAtSec: parseOptionalPositiveInt(row.revokedAtSec),
    revokeReason: sanitizeShortText(row.revokeReason, 500) ?? undefined,
    metadata: sanitizeMetadata(row.metadata),
    createdAtSec,
    updatedAtSec
  };
}

function parseStoredDenyRule(input: unknown): AccessDenyRule | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<AccessDenyRule>;
  if (typeof row.id !== "string" || !row.id) return null;
  const hostPubkey = normalizePubkeyHex(row.hostPubkey);
  const subjectPubkey = normalizePubkeyHex(row.subjectPubkey);
  if (!hostPubkey || !subjectPubkey) return null;
  const resourceId = sanitizeShortText(row.resourceId, 400);
  if (!resourceId) return null;
  const actions = sanitizeActions(row.actions);
  if (actions.length === 0) return null;
  const startsAtSec = parseOptionalPositiveInt(row.startsAtSec);
  const createdAtSec = parseOptionalPositiveInt(row.createdAtSec);
  const updatedAtSec = parseOptionalPositiveInt(row.updatedAtSec);
  if (!startsAtSec || !createdAtSec || !updatedAtSec) return null;
  return {
    id: row.id,
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions,
    reason: sanitizeShortText(row.reason, 500) ?? undefined,
    startsAtSec,
    expiresAtSec: parseOptionalPositiveInt(row.expiresAtSec),
    createdAtSec,
    updatedAtSec
  };
}

function parseStoredAudit(input: unknown): AccessAuditRecord | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<AccessAuditRecord>;
  if (typeof row.id !== "string" || !row.id) return null;
  const hostPubkey = normalizePubkeyHex(row.hostPubkey);
  if (!hostPubkey) return null;
  const action = typeof row.action === "string" ? row.action.trim().toLowerCase() : "";
  if (!action) return null;
  const resourceId = sanitizeShortText(row.resourceId, 400);
  const atSec = parseOptionalPositiveInt(row.atSec);
  if (!resourceId || !atSec) return null;
  return {
    id: row.id,
    atSec,
    hostPubkey,
    subjectPubkey: normalizePubkeyHex(row.subjectPubkey) ?? undefined,
    resourceId,
    action: action as any,
    allowed: !!row.allowed,
    reasonCode: sanitizeShortText(row.reasonCode, 160) ?? "unknown",
    entitlementId: sanitizeShortText(row.entitlementId, 120) ?? undefined,
    requestId: sanitizeShortText(row.requestId, 120) ?? undefined,
    metadata: sanitizeMetadata(row.metadata)
  };
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = readTextFileWithBackup(STORE_PATH);
    if (!raw) throw new Error("no store");
    const parsed = JSON.parse(raw) as { entitlements?: unknown[]; denyRules?: unknown[]; audit?: unknown[] } | null;
    const entitlements = Array.isArray(parsed?.entitlements) ? parsed!.entitlements! : [];
    const denyRules = Array.isArray(parsed?.denyRules) ? parsed!.denyRules! : [];
    const audit = Array.isArray(parsed?.audit) ? parsed!.audit! : [];
    entitlementsCache = entitlements.map(parseStoredEntitlement).filter((row): row is AccessEntitlement => !!row);
    denyRulesCache = denyRules.map(parseStoredDenyRule).filter((row): row is AccessDenyRule => !!row);
    auditCache = audit.map(parseStoredAudit).filter((row): row is AccessAuditRecord => !!row);
  } catch {
    entitlementsCache = [];
    denyRulesCache = [];
    auditCache = [];
  }
}

function persist(): void {
  try {
    writeJsonFileAtomic(STORE_PATH, {
      version: 1,
      updatedAtSec: nowSec(),
      entitlements: entitlementsCache,
      denyRules: denyRulesCache,
      audit: auditCache
    });
  } catch {
    // ignore persistence failures
  }
}

function deriveStatus(row: AccessEntitlement, now = nowSec()): AccessEntitlementStatus {
  if (row.status === "revoked" || row.revokedAtSec) return "revoked";
  if (row.expiresAtSec && row.expiresAtSec <= now) return "expired";
  return "active";
}

export function listAccessEntitlements(options?: {
  hostPubkey?: string;
  subjectPubkey?: string;
  resourceId?: string;
  status?: AccessEntitlementStatus | "all";
  limit?: number;
}): AccessEntitlement[] {
  ensureLoaded();
  const now = nowSec();
  const hostPubkey = normalizePubkeyHex(options?.hostPubkey ?? "") ?? null;
  const subjectPubkey = normalizePubkeyHex(options?.subjectPubkey ?? "") ?? null;
  const resourceId = sanitizeShortText(options?.resourceId, 400);
  const status = options?.status ?? "all";
  const limit = Math.max(1, Math.min(options?.limit ?? 200, MAX_ENTITLEMENTS));

  return entitlementsCache
    .map((row) => ({ ...row, status: deriveStatus(row, now) }))
    .filter((row) => {
      if (hostPubkey && row.hostPubkey !== hostPubkey) return false;
      if (subjectPubkey && row.subjectPubkey !== subjectPubkey) return false;
      if (resourceId && row.resourceId !== resourceId) return false;
      if (status !== "all" && row.status !== status) return false;
      return true;
    })
    .sort((a, b) => b.createdAtSec - a.createdAtSec)
    .slice(0, limit);
}

export function grantAccessEntitlement(input: {
  hostPubkey: string;
  subjectPubkey: string;
  resourceId: string;
  actions: string[];
  source?: AccessEntitlementSource;
  sourceRef?: string;
  startsAtSec?: number;
  expiresAtSec?: number;
  metadata?: Record<string, unknown>;
}): AccessEntitlement {
  ensureLoaded();
  const timestamp = nowSec();
  const hostPubkey = normalizePubkeyHex(input.hostPubkey);
  const subjectPubkey = normalizePubkeyHex(input.subjectPubkey);
  const resourceId = sanitizeShortText(input.resourceId, 400);
  const actions = sanitizeActions(input.actions);
  if (!hostPubkey) throw new Error("hostPubkey must be a 64-char hex pubkey.");
  if (!subjectPubkey) throw new Error("subjectPubkey must be a 64-char hex pubkey.");
  if (!resourceId) throw new Error("resourceId is required.");
  if (actions.length === 0) throw new Error("actions must include at least one action.");

  const source = parseEntitlementSource(input.source);
  const startsAtSec = input.startsAtSec && input.startsAtSec > 0 ? Math.trunc(input.startsAtSec) : timestamp;
  const expiresAtSec = input.expiresAtSec && input.expiresAtSec > 0 ? Math.trunc(input.expiresAtSec) : undefined;
  if (expiresAtSec && expiresAtSec <= startsAtSec) {
    throw new Error("expiresAtSec must be later than startsAtSec.");
  }

  const existing = entitlementsCache.find(
    (row) =>
      row.hostPubkey === hostPubkey &&
      row.subjectPubkey === subjectPubkey &&
      row.resourceId === resourceId &&
      row.status !== "revoked"
  );

  if (existing) {
    const merged = new Set<string>([...existing.actions, ...actions]);
    existing.actions = Array.from(merged);
    existing.source = source;
    existing.sourceRef = sanitizeShortText(input.sourceRef, 400) ?? existing.sourceRef;
    existing.startsAtSec = Math.min(existing.startsAtSec, startsAtSec);
    existing.expiresAtSec = expiresAtSec ?? existing.expiresAtSec;
    existing.metadata = { ...existing.metadata, ...sanitizeMetadata(input.metadata) };
    existing.status = deriveStatus(existing, timestamp);
    existing.updatedAtSec = timestamp;
    persist();
    return { ...existing };
  }

  const created: AccessEntitlement = {
    id: randomUUID(),
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions,
    source,
    sourceRef: sanitizeShortText(input.sourceRef, 400) ?? undefined,
    status: "active",
    startsAtSec,
    expiresAtSec,
    metadata: sanitizeMetadata(input.metadata),
    createdAtSec: timestamp,
    updatedAtSec: timestamp
  };

  entitlementsCache.push(created);
  entitlementsCache = entitlementsCache
    .sort((a, b) => b.createdAtSec - a.createdAtSec)
    .slice(0, MAX_ENTITLEMENTS);
  persist();
  return { ...created };
}

export function revokeAccessEntitlement(input: {
  entitlementId: string;
  revokeReason?: string;
}): AccessEntitlement {
  ensureLoaded();
  const entitlementId = sanitizeShortText(input.entitlementId, 120);
  if (!entitlementId) throw new Error("entitlementId is required.");

  const row = entitlementsCache.find((entry) => entry.id === entitlementId);
  if (!row) throw new Error("Entitlement not found.");

  const timestamp = nowSec();
  row.status = "revoked";
  row.revokedAtSec = timestamp;
  row.revokeReason = sanitizeShortText(input.revokeReason, 500) ?? row.revokeReason;
  row.updatedAtSec = timestamp;
  persist();
  return { ...row };
}

export function listAccessDenyRules(options?: {
  hostPubkey?: string;
  subjectPubkey?: string;
  resourceId?: string;
  limit?: number;
}): AccessDenyRule[] {
  ensureLoaded();
  const hostPubkey = normalizePubkeyHex(options?.hostPubkey ?? "") ?? null;
  const subjectPubkey = normalizePubkeyHex(options?.subjectPubkey ?? "") ?? null;
  const resourceId = sanitizeShortText(options?.resourceId, 400);
  const limit = Math.max(1, Math.min(options?.limit ?? 200, MAX_DENIES));
  const now = nowSec();

  return denyRulesCache
    .filter((row) => {
      if (hostPubkey && row.hostPubkey !== hostPubkey) return false;
      if (subjectPubkey && row.subjectPubkey !== subjectPubkey) return false;
      if (resourceId && row.resourceId !== resourceId) return false;
      if (row.startsAtSec > now) return false;
      if (row.expiresAtSec && row.expiresAtSec <= now) return false;
      return true;
    })
    .sort((a, b) => b.createdAtSec - a.createdAtSec)
    .slice(0, limit);
}

export function upsertAccessDenyRule(input: {
  hostPubkey: string;
  subjectPubkey: string;
  resourceId: string;
  actions: string[];
  reason?: string;
  startsAtSec?: number;
  expiresAtSec?: number;
}): AccessDenyRule {
  ensureLoaded();
  const timestamp = nowSec();
  const hostPubkey = normalizePubkeyHex(input.hostPubkey);
  const subjectPubkey = normalizePubkeyHex(input.subjectPubkey);
  const resourceId = sanitizeShortText(input.resourceId, 400);
  const actions = sanitizeActions(input.actions);
  if (!hostPubkey) throw new Error("hostPubkey must be a 64-char hex pubkey.");
  if (!subjectPubkey) throw new Error("subjectPubkey must be a 64-char hex pubkey.");
  if (!resourceId) throw new Error("resourceId is required.");
  if (actions.length === 0) throw new Error("actions must include at least one action.");

  const startsAtSec = input.startsAtSec && input.startsAtSec > 0 ? Math.trunc(input.startsAtSec) : timestamp;
  const expiresAtSec = input.expiresAtSec && input.expiresAtSec > 0 ? Math.trunc(input.expiresAtSec) : undefined;
  if (expiresAtSec && expiresAtSec <= startsAtSec) {
    throw new Error("expiresAtSec must be later than startsAtSec.");
  }

  const existing = denyRulesCache.find(
    (row) => row.hostPubkey === hostPubkey && row.subjectPubkey === subjectPubkey && row.resourceId === resourceId
  );
  if (existing) {
    existing.actions = actions;
    existing.reason = sanitizeShortText(input.reason, 500) ?? existing.reason;
    existing.startsAtSec = startsAtSec;
    existing.expiresAtSec = expiresAtSec;
    existing.updatedAtSec = timestamp;
    persist();
    return { ...existing };
  }

  const created: AccessDenyRule = {
    id: randomUUID(),
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions,
    reason: sanitizeShortText(input.reason, 500) ?? undefined,
    startsAtSec,
    expiresAtSec,
    createdAtSec: timestamp,
    updatedAtSec: timestamp
  };

  denyRulesCache.push(created);
  denyRulesCache = denyRulesCache
    .sort((a, b) => b.createdAtSec - a.createdAtSec)
    .slice(0, MAX_DENIES);
  persist();
  return { ...created };
}

export function appendAccessAuditRecord(input: {
  hostPubkey: string;
  subjectPubkey?: string;
  resourceId: string;
  action: string;
  allowed: boolean;
  reasonCode: string;
  entitlementId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}): AccessAuditRecord {
  ensureLoaded();
  const hostPubkey = normalizePubkeyHex(input.hostPubkey);
  const subjectPubkey = normalizePubkeyHex(input.subjectPubkey) ?? undefined;
  const resourceId = sanitizeShortText(input.resourceId, 400);
  const action = sanitizeShortText(input.action, 80);
  const reasonCode = sanitizeShortText(input.reasonCode, 160);
  if (!hostPubkey || !resourceId || !action || !reasonCode) {
    throw new Error("Invalid audit payload.");
  }
  const row: AccessAuditRecord = {
    id: randomUUID(),
    atSec: nowSec(),
    hostPubkey,
    subjectPubkey,
    resourceId,
    action: action as any,
    allowed: !!input.allowed,
    reasonCode,
    entitlementId: sanitizeShortText(input.entitlementId, 120) ?? undefined,
    requestId: sanitizeShortText(input.requestId, 120) ?? undefined,
    metadata: sanitizeMetadata(input.metadata)
  };
  auditCache.push(row);
  auditCache = auditCache.slice(-MAX_AUDIT);
  persist();
  return row;
}

export function listAccessAudit(options?: {
  hostPubkey?: string;
  subjectPubkey?: string;
  resourceId?: string;
  limit?: number;
}): AccessAuditRecord[] {
  ensureLoaded();
  const hostPubkey = normalizePubkeyHex(options?.hostPubkey ?? "") ?? null;
  const subjectPubkey = normalizePubkeyHex(options?.subjectPubkey ?? "") ?? null;
  const resourceId = sanitizeShortText(options?.resourceId, 400);
  const limit = Math.max(1, Math.min(options?.limit ?? 200, MAX_AUDIT));
  return auditCache
    .filter((row) => {
      if (hostPubkey && row.hostPubkey !== hostPubkey) return false;
      if (subjectPubkey && row.subjectPubkey !== subjectPubkey) return false;
      if (resourceId && row.resourceId !== resourceId) return false;
      return true;
    })
    .sort((a, b) => b.atSec - a.atSec)
    .slice(0, limit);
}
