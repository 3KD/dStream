import { grantAccessEntitlement, listAccessEntitlements, revokeAccessEntitlement } from "./store";
import { ACCESS_ACTIONS, type AccessAction, type AccessEntitlement } from "./types";

const DEFAULT_STAKE_GRANT_ACTIONS: AccessAction[] = ["watch_live", "watch_vod", "chat_send", "p2p_assist", "rebroadcast"];

function normalizePubkeyHex(input: string | null | undefined): string | null {
  const value = (input ?? "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function normalizeStreamId(input: string | null | undefined): string | null {
  const value = (input ?? "").trim();
  if (!value) return null;
  return value.slice(0, 160);
}

function normalizeAtomic(input: string | null | undefined): bigint {
  const value = (input ?? "").trim();
  if (!/^\d+$/.test(value)) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function parseAutoGrantEnabled(): boolean {
  const raw = (process.env.DSTREAM_XMR_STAKE_AUTO_GRANT ?? "").trim().toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
}

function parseAutoGrantActions(): string[] {
  const raw = (process.env.DSTREAM_XMR_STAKE_AUTO_GRANT_ACTIONS ?? "").trim().toLowerCase();
  if (!raw) return [...DEFAULT_STAKE_GRANT_ACTIONS];

  const parsed = new Set<string>();
  for (const part of raw.split(/[\s,]+/g)) {
    const token = part.trim();
    if (!token) continue;
    if (token === "*") {
      parsed.clear();
      parsed.add("*");
      break;
    }
    if (ACCESS_ACTIONS.includes(token as AccessAction)) {
      parsed.add(token);
    }
  }

  if (parsed.size === 0) return [...DEFAULT_STAKE_GRANT_ACTIONS];
  return Array.from(parsed);
}

function parseAutoGrantTtlSec(): number | undefined {
  const raw = (process.env.DSTREAM_XMR_STAKE_AUTO_GRANT_TTL_SEC ?? "").trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  const value = Math.trunc(parsed);
  return value > 0 ? value : undefined;
}

function normalizeTxRef(input: string | null | undefined): string {
  const value = (input ?? "").trim().toLowerCase();
  if (!value) return "unknown";
  return value.slice(0, 140);
}

function normalizeSessionRef(input: string | null | undefined): string {
  const value = (input ?? "").trim();
  if (!value) return "missing-session";
  return value.replace(/[\s:]+/g, "-").slice(0, 180);
}

function parseOptionalInt(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return Math.trunc(input);
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function includesAllActions(candidate: string[], required: string[]): boolean {
  if (required.includes("*")) return candidate.includes("*");
  if (candidate.includes("*")) return true;
  const actionSet = new Set(candidate);
  return required.every((action) => actionSet.has(action));
}

function deriveStartsAtSec(observedAtMs: number | null | undefined): number {
  if (typeof observedAtMs !== "number" || !Number.isFinite(observedAtMs) || observedAtMs <= 0) {
    return Math.floor(Date.now() / 1000);
  }
  return Math.max(1, Math.trunc(observedAtMs / 1000));
}

export interface StakeSettlementGrantInput {
  hostPubkey: string;
  viewerPubkey: string;
  streamId: string;
  sessionToken: string;
  confirmedAtomic: string;
  txid?: string | null;
  observedAtMs?: number | null;
  accountIndex?: number;
  addressIndex?: number;
}

export type StakeSettlementGrantResult = {
  granted: boolean;
  reason: "disabled" | "invalid_input" | "no_confirmed_settlement" | "existing" | "granted";
  entitlement: AccessEntitlement | null;
};

export function grantVerifiedStakeSettlementAccess(input: StakeSettlementGrantInput): StakeSettlementGrantResult {
  if (!parseAutoGrantEnabled()) {
    return {
      granted: false,
      reason: "disabled",
      entitlement: null
    };
  }

  const hostPubkey = normalizePubkeyHex(input.hostPubkey);
  const subjectPubkey = normalizePubkeyHex(input.viewerPubkey);
  const streamId = normalizeStreamId(input.streamId);
  if (!hostPubkey || !subjectPubkey || !streamId) {
    return {
      granted: false,
      reason: "invalid_input",
      entitlement: null
    };
  }

  const confirmedAtomic = normalizeAtomic(input.confirmedAtomic);
  if (confirmedAtomic <= 0n) {
    return {
      granted: false,
      reason: "no_confirmed_settlement",
      entitlement: null
    };
  }

  const resourceId = `stream:${hostPubkey}:${streamId}:*`;
  const actions = parseAutoGrantActions();
  const sourceRef = `xmr_stake_session:${normalizeSessionRef(input.sessionToken)}:${normalizeTxRef(input.txid)}`;

  const existing = listAccessEntitlements({
    hostPubkey,
    subjectPubkey,
    resourceId,
    status: "active",
    limit: 200
  }).find((row) => row.source === "purchase_verified" && row.sourceRef === sourceRef && includesAllActions(row.actions, actions));

  if (existing) {
    return {
      granted: false,
      reason: "existing",
      entitlement: existing
    };
  }

  const startsAtSec = deriveStartsAtSec(input.observedAtMs);
  const ttlSec = parseAutoGrantTtlSec();
  const expiresAtSec = ttlSec ? startsAtSec + ttlSec : undefined;

  const entitlement = grantAccessEntitlement({
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions,
    source: "purchase_verified",
    sourceRef,
    startsAtSec,
    expiresAtSec,
    metadata: {
      railId: "xmr",
      asset: "xmr",
      settlementType: "stake_session",
      sessionToken: normalizeSessionRef(input.sessionToken),
      streamId,
      txid: input.txid?.trim() || null,
      confirmedAtomic: confirmedAtomic.toString(),
      accountIndex: typeof input.accountIndex === "number" ? Math.trunc(input.accountIndex) : null,
      addressIndex: typeof input.addressIndex === "number" ? Math.trunc(input.addressIndex) : null
    }
  });

  return {
    granted: true,
    reason: "granted",
    entitlement
  };
}

function isStakeSessionEntitlement(row: AccessEntitlement): boolean {
  return row.source === "purchase_verified" && row.metadata?.settlementType === "stake_session";
}

function revokeRows(rows: AccessEntitlement[], reason: string): AccessEntitlement[] {
  const revoked: AccessEntitlement[] = [];
  for (const row of rows) {
    try {
      revoked.push(
        revokeAccessEntitlement({
          entitlementId: row.id,
          revokeReason: reason
        })
      );
    } catch {
      // ignore revoke races
    }
  }
  return revoked;
}

export interface StakeSettlementRevokeBySessionInput {
  hostPubkey: string;
  viewerPubkey: string;
  streamId: string;
  sessionToken: string;
  reason?: string;
}

export type StakeSettlementRevokeResult = {
  revokedCount: number;
  entitlementIds: string[];
};

export function revokeVerifiedStakeSettlementAccessBySession(input: StakeSettlementRevokeBySessionInput): StakeSettlementRevokeResult {
  const hostPubkey = normalizePubkeyHex(input.hostPubkey);
  const subjectPubkey = normalizePubkeyHex(input.viewerPubkey);
  const streamId = normalizeStreamId(input.streamId);
  if (!hostPubkey || !subjectPubkey || !streamId) {
    return { revokedCount: 0, entitlementIds: [] };
  }

  const sessionRef = normalizeSessionRef(input.sessionToken);
  const sourceRefPrefix = `xmr_stake_session:${sessionRef}:`;
  const resourcePrefix = `stream:${hostPubkey}:${streamId}:`;

  const rows = listAccessEntitlements({
    hostPubkey,
    subjectPubkey,
    status: "active",
    limit: 4000
  }).filter((row) => {
    if (!isStakeSessionEntitlement(row)) return false;
    if (!row.resourceId.startsWith(resourcePrefix)) return false;
    if (typeof row.sourceRef === "string" && row.sourceRef.startsWith(sourceRefPrefix)) return true;
    return row.metadata?.sessionToken === sessionRef;
  });

  const revoked = revokeRows(rows, input.reason?.trim() || "stake_settlement_refunded");
  return {
    revokedCount: revoked.length,
    entitlementIds: revoked.map((row) => row.id)
  };
}

export interface StakeSettlementRevokeByAddressInput {
  hostPubkey: string;
  streamId: string;
  accountIndex: number;
  addressIndex: number;
  reason?: string;
}

export function revokeVerifiedStakeSettlementAccessByAddress(
  input: StakeSettlementRevokeByAddressInput
): StakeSettlementRevokeResult {
  const hostPubkey = normalizePubkeyHex(input.hostPubkey);
  const streamId = normalizeStreamId(input.streamId);
  const accountIndex = Math.trunc(input.accountIndex);
  const addressIndex = Math.trunc(input.addressIndex);
  if (!hostPubkey || !streamId || accountIndex < 0 || addressIndex < 0) {
    return { revokedCount: 0, entitlementIds: [] };
  }

  const resourcePrefix = `stream:${hostPubkey}:${streamId}:`;
  const rows = listAccessEntitlements({
    hostPubkey,
    status: "active",
    limit: 20000
  }).filter((row) => {
    if (!isStakeSessionEntitlement(row)) return false;
    if (!row.resourceId.startsWith(resourcePrefix)) return false;
    const rowAccountIndex = parseOptionalInt(row.metadata?.accountIndex);
    const rowAddressIndex = parseOptionalInt(row.metadata?.addressIndex);
    if (rowAccountIndex === null || rowAddressIndex === null) return false;
    return rowAccountIndex === accountIndex && rowAddressIndex === addressIndex;
  });

  const revoked = revokeRows(rows, input.reason?.trim() || "stake_settlement_slashed");
  return {
    revokedCount: revoked.length,
    entitlementIds: revoked.map((row) => row.id)
  };
}
