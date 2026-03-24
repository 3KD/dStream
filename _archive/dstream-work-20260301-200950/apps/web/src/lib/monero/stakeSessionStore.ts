import type { StakeSessionV1 } from "./stakeSession";

export type StakeSessionRecord = {
  token: string;
  payload: StakeSessionV1;
  address: string;
  createdAtMs: number;
  lastObservedAtMs: number | null;
  settledAtMs: number | null;
};

const sessionsByToken = new Map<string, StakeSessionRecord>();
const activeTokenByViewerStream = new Map<string, string>();

function viewerStreamKey(opts: { viewerPubkey: string; streamPubkey: string; streamId: string }): string {
  return `${opts.viewerPubkey}:${opts.streamPubkey}:${opts.streamId}`;
}

function parseSettledRetentionSec(raw: string | undefined): number {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return 300;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 300;
  const value = Math.trunc(parsed);
  return value > 0 ? value : 300;
}

function pruneSettledSessions(nowMs = Date.now()): void {
  const retentionMs = parseSettledRetentionSec(process.env.DSTREAM_XMR_STAKE_SESSION_SETTLED_RETENTION_SEC) * 1000;
  for (const [token, record] of sessionsByToken) {
    if (!record.settledAtMs) continue;
    if (nowMs - record.settledAtMs < retentionMs) continue;
    sessionsByToken.delete(token);
  }

  for (const [key, token] of activeTokenByViewerStream) {
    const record = sessionsByToken.get(token);
    if (!record || record.settledAtMs) activeTokenByViewerStream.delete(key);
  }
}

export function registerStakeSession(record: {
  token: string;
  payload: StakeSessionV1;
  address: string;
}): StakeSessionRecord {
  const createdAtMs = Math.max(0, Math.trunc(record.payload.createdAtMs || Date.now()));
  const next: StakeSessionRecord = {
    token: record.token,
    payload: record.payload,
    address: record.address.trim(),
    createdAtMs,
    lastObservedAtMs: null,
    settledAtMs: null
  };

  sessionsByToken.set(record.token, next);
  activeTokenByViewerStream.set(
    viewerStreamKey({
      viewerPubkey: next.payload.viewerPubkey,
      streamPubkey: next.payload.streamPubkey,
      streamId: next.payload.streamId
    }),
    record.token
  );
  pruneSettledSessions();
  return next;
}

export function getStakeSessionRecord(token: string): StakeSessionRecord | null {
  pruneSettledSessions();
  return sessionsByToken.get(token) ?? null;
}

export function getActiveStakeSessionForViewerStream(opts: {
  viewerPubkey: string;
  streamPubkey: string;
  streamId: string;
}): StakeSessionRecord | null {
  pruneSettledSessions();
  const token = activeTokenByViewerStream.get(viewerStreamKey(opts));
  if (!token) return null;
  const record = sessionsByToken.get(token) ?? null;
  if (!record || record.settledAtMs) {
    activeTokenByViewerStream.delete(viewerStreamKey(opts));
    return null;
  }
  return record;
}

export function markStakeSessionObserved(token: string, observedAtMs = Date.now()): boolean {
  const record = sessionsByToken.get(token);
  if (!record) return false;
  const normalized = Math.max(0, Math.trunc(observedAtMs));
  if (record.lastObservedAtMs === null || normalized > record.lastObservedAtMs) {
    record.lastObservedAtMs = normalized;
  }
  return true;
}

export function markStakeSessionSettled(token: string, settledAtMs = Date.now()): boolean {
  const record = sessionsByToken.get(token);
  if (!record) return false;
  record.settledAtMs = Math.max(0, Math.trunc(settledAtMs));
  const key = viewerStreamKey({
    viewerPubkey: record.payload.viewerPubkey,
    streamPubkey: record.payload.streamPubkey,
    streamId: record.payload.streamId
  });
  if (activeTokenByViewerStream.get(key) === token) {
    activeTokenByViewerStream.delete(key);
  }
  return true;
}

export function markStakeSessionSettledByAddress(opts: {
  streamPubkey: string;
  streamId: string;
  accountIndex: number;
  addressIndex: number;
  settledAtMs?: number;
}): number {
  let count = 0;
  const settledAtMs = opts.settledAtMs ?? Date.now();
  for (const [token, record] of sessionsByToken) {
    if (record.payload.streamPubkey !== opts.streamPubkey) continue;
    if (record.payload.streamId !== opts.streamId) continue;
    if (record.payload.accountIndex !== Math.trunc(opts.accountIndex)) continue;
    if (record.payload.addressIndex !== Math.trunc(opts.addressIndex)) continue;
    if (markStakeSessionSettled(token, settledAtMs)) count += 1;
  }
  return count;
}

export function expireStakeSession(token: string): boolean {
  const record = sessionsByToken.get(token);
  if (!record) return false;
  sessionsByToken.delete(token);
  const key = viewerStreamKey({
    viewerPubkey: record.payload.viewerPubkey,
    streamPubkey: record.payload.streamPubkey,
    streamId: record.payload.streamId
  });
  if (activeTokenByViewerStream.get(key) === token) {
    activeTokenByViewerStream.delete(key);
  }
  return true;
}
