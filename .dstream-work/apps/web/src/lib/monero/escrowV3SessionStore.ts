import crypto from "node:crypto";

export type EscrowV3Phase =
  | "collecting_prepare"
  | "make_ready"
  | "collecting_exchange"
  | "exchange_ready"
  | "exchanged"
  | "signed"
  | "submitted";

export type EscrowV3SessionState = {
  id: string;
  streamPubkey: string;
  streamId: string;
  coordinatorPubkey: string;
  participantPubkeys: string[];
  threshold: number;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  phase: EscrowV3Phase;
  coordinatorPrepareInfo: string;
  participantPrepareInfos: Record<string, string>;
  coordinatorExchangeInfo: string | null;
  participantExchangeInfos: Record<string, string>;
  exchangeRound: number;
  walletAddress: string | null;
  importedOutputs: number;
  signedTxDataHex: string | null;
  signedTxids: string[];
  submittedTxids: string[];
};

const sessions = new Map<string, EscrowV3SessionState>();

function nowMs(): number {
  return Date.now();
}

function parseTtlSec(raw: string | undefined): number {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return 3600;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 3600;
  const ttl = Math.trunc(parsed);
  return ttl > 0 ? ttl : 3600;
}

function pruneExpired(): void {
  const now = nowMs();
  for (const [id, session] of sessions) {
    if (session.expiresAtMs <= now) sessions.delete(id);
  }
}

function makeSessionId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createEscrowV3Session(input: {
  streamPubkey: string;
  streamId: string;
  coordinatorPubkey: string;
  participantPubkeys: string[];
  threshold: number;
  coordinatorPrepareInfo: string;
}): EscrowV3SessionState {
  pruneExpired();
  const createdAtMs = nowMs();
  const ttlSec = parseTtlSec(process.env.DSTREAM_XMR_ESCROW_SESSION_TTL_SEC);
  const id = makeSessionId();
  const session: EscrowV3SessionState = {
    id,
    streamPubkey: input.streamPubkey,
    streamId: input.streamId,
    coordinatorPubkey: input.coordinatorPubkey,
    participantPubkeys: [...input.participantPubkeys],
    threshold: input.threshold,
    createdAtMs,
    updatedAtMs: createdAtMs,
    expiresAtMs: createdAtMs + ttlSec * 1000,
    phase: "collecting_prepare",
    coordinatorPrepareInfo: input.coordinatorPrepareInfo,
    participantPrepareInfos: {},
    coordinatorExchangeInfo: null,
    participantExchangeInfos: {},
    exchangeRound: 0,
    walletAddress: null,
    importedOutputs: 0,
    signedTxDataHex: null,
    signedTxids: [],
    submittedTxids: []
  };
  sessions.set(id, session);
  return session;
}

export function getEscrowV3Session(sessionId: string): EscrowV3SessionState | null {
  pruneExpired();
  return sessions.get(sessionId) ?? null;
}

export function touchEscrowV3Session(session: EscrowV3SessionState): void {
  const ttlSec = parseTtlSec(process.env.DSTREAM_XMR_ESCROW_SESSION_TTL_SEC);
  const now = nowMs();
  session.updatedAtMs = now;
  session.expiresAtMs = now + ttlSec * 1000;
}

export function hasAllPrepareInfos(session: EscrowV3SessionState): boolean {
  return session.participantPubkeys.every((pubkey) => {
    const value = session.participantPrepareInfos[pubkey];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function hasAllExchangeInfos(session: EscrowV3SessionState): boolean {
  return session.participantPubkeys.every((pubkey) => {
    const value = session.participantExchangeInfos[pubkey];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function listPendingPreparePubkeys(session: EscrowV3SessionState): string[] {
  return session.participantPubkeys.filter((pubkey) => {
    const value = session.participantPrepareInfos[pubkey];
    return !(typeof value === "string" && value.trim().length > 0);
  });
}

export function listPendingExchangePubkeys(session: EscrowV3SessionState): string[] {
  return session.participantPubkeys.filter((pubkey) => {
    const value = session.participantExchangeInfos[pubkey];
    return !(typeof value === "string" && value.trim().length > 0);
  });
}

export function toEscrowV3SessionResponse(session: EscrowV3SessionState): any {
  const pendingPrepare = listPendingPreparePubkeys(session);
  const pendingExchange = listPendingExchangePubkeys(session);
  return {
    ok: true,
    sessionId: session.id,
    streamPubkey: session.streamPubkey,
    streamId: session.streamId,
    coordinatorPubkey: session.coordinatorPubkey,
    participantPubkeys: [...session.participantPubkeys],
    threshold: session.threshold,
    createdAtMs: session.createdAtMs,
    updatedAtMs: session.updatedAtMs,
    expiresAtMs: session.expiresAtMs,
    phase: session.phase,
    prepare: {
      coordinatorMultisigInfo: session.coordinatorPrepareInfo,
      participantCount: session.participantPubkeys.length,
      joinedPubkeys: session.participantPubkeys.filter((pubkey) => !pendingPrepare.includes(pubkey)),
      pendingPubkeys: pendingPrepare,
      ready: pendingPrepare.length === 0
    },
    exchange: {
      round: session.exchangeRound,
      coordinatorMultisigInfo: session.coordinatorExchangeInfo,
      joinedPubkeys: session.participantPubkeys.filter((pubkey) => !pendingExchange.includes(pubkey)),
      pendingPubkeys: pendingExchange,
      ready: pendingExchange.length === 0
    },
    walletAddress: session.walletAddress,
    importedOutputs: session.importedOutputs,
    signedTxids: [...session.signedTxids],
    submittedTxids: [...session.submittedTxids]
  };
}
