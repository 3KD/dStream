import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { makeOriginStreamId } from "./origin";
import { parseStreamAnnounceEvent, type NostrEvent } from "@dstream/protocol";
import { validateEvent, verifyEvent } from "nostr-tools";

const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const ACCESS_TOKEN_MAX_FUTURE_SEC = 60 * 60;
const VIEWER_PROOF_MAX_AGE_SEC = 10 * 60;
const POLICY_TTL_SEC = 36 * 60 * 60;
const POLICY_ENDED_TTL_SEC = 5 * 60;
const ORIGIN_SEGMENT_RE = /^([a-f0-9]{64}--[A-Za-z0-9][A-Za-z0-9_-]{0,127})(?:__r[A-Za-z0-9_-]+)?$/;
const HEX64_RE = /^[a-f0-9]{64}$/;
const RENDITION_SUFFIX_RE = /^__r[A-Za-z0-9_-]+$/;

interface PlaybackPolicy {
  streamPubkey: string;
  streamId: string;
  originStreamId: string;
  viewerAllowPubkeys: string[];
  privateStream: boolean;
  vodArchiveEnabled: boolean;
  vodVisibility: "public" | "private";
  status: "live" | "ended";
  createdAt: number;
  updatedAtSec: number;
}

interface AccessTokenPayload {
  o: string;
  v: string;
  p: 0 | 1;
  iat: number;
  exp: number;
  n: string;
}

interface SignedEvent extends NostrEvent {
  id: string;
  sig: string;
}

const playbackPolicies = new Map<string, PlaybackPolicy>();
let cachedTokenSecret: Buffer | null = null;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function getTokenSecret(): Buffer {
  if (cachedTokenSecret) return cachedTokenSecret;
  const configured = (process.env.DSTREAM_PLAYBACK_ACCESS_SECRET ?? "").trim();
  cachedTokenSecret = configured ? Buffer.from(configured, "utf8") : randomBytes(32);
  return cachedTokenSecret;
}

function isSignedEvent(input: NostrEvent): input is SignedEvent {
  return typeof input.id === "string" && input.id.length > 0 && typeof input.sig === "string" && input.sig.length > 0;
}

function isValidSignedEvent(input: NostrEvent): input is SignedEvent {
  if (!isSignedEvent(input)) return false;
  return validateEvent(input as any) && verifyEvent(input as any);
}

function normalizePubkey(input: string | null | undefined): string | null {
  const value = (input ?? "").trim().toLowerCase();
  if (!HEX64_RE.test(value)) return null;
  return value;
}

function prunePlaybackPolicies(): void {
  const now = nowSec();
  for (const [originStreamId, policy] of playbackPolicies.entries()) {
    const age = now - policy.updatedAtSec;
    if (policy.status === "ended") {
      if (age > POLICY_ENDED_TTL_SEC) playbackPolicies.delete(originStreamId);
      continue;
    }
    if (age > POLICY_TTL_SEC) playbackPolicies.delete(originStreamId);
  }
}

function findTagValue(tags: string[][], name: string): string | null {
  for (const tag of tags) {
    if (tag[0] !== name) continue;
    const value = (tag[1] ?? "").trim();
    if (!value) continue;
    return value;
  }
  return null;
}

function signTokenPayload(payloadEncoded: string): string {
  return createHmac("sha256", getTokenSecret()).update(payloadEncoded).digest("base64url");
}

function safeSignatureEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

function encodeTokenPayload(payload: AccessTokenPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

function decodeTokenPayload(input: string): AccessTokenPayload | null {
  try {
    const raw = Buffer.from(input, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<AccessTokenPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.o !== "string" || !parsed.o) return null;
    if (typeof parsed.v !== "string") return null;
    if (parsed.p !== 0 && parsed.p !== 1) return null;
    if (typeof parsed.iat !== "number" || !Number.isInteger(parsed.iat)) return null;
    if (typeof parsed.exp !== "number" || !Number.isInteger(parsed.exp)) return null;
    if (typeof parsed.n !== "string" || !parsed.n) return null;
    return parsed as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function parseOriginStreamIdFromPath(pathSegments: string[]): string | null {
  const first = pathSegments[0];
  if (!first) return null;
  let decoded = first.trim();
  if (!decoded) return null;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep raw path segment
  }
  const match = decoded.match(ORIGIN_SEGMENT_RE);
  if (!match) return null;
  return match[1] ?? null;
}

function stripRenditionSuffix(originStreamId: string): string {
  const separatorIndex = originStreamId.lastIndexOf("__r");
  if (separatorIndex <= 66) return originStreamId;
  const suffix = originStreamId.slice(separatorIndex);
  if (!RENDITION_SUFFIX_RE.test(suffix)) return originStreamId;
  return originStreamId.slice(0, separatorIndex);
}

export function getPlaybackPolicy(originStreamId: string): PlaybackPolicy | null {
  prunePlaybackPolicies();
  return playbackPolicies.get(originStreamId) ?? null;
}

export function registerPlaybackPolicyFromAnnounceEvent(
  announceEvent: unknown
): { ok: true; policy: PlaybackPolicy } | { ok: false; status: number; error: string } {
  if (!announceEvent || typeof announceEvent !== "object") {
    return { ok: false, status: 400, error: "announceEvent is required." };
  }

  const event = announceEvent as NostrEvent;
  if (!isValidSignedEvent(event)) {
    return { ok: false, status: 400, error: "announceEvent must be a valid signed Nostr event." };
  }

  const parsed = parseStreamAnnounceEvent(event);
  if (!parsed) {
    return { ok: false, status: 400, error: "announceEvent is not a valid stream announce." };
  }

  const originStreamId = makeOriginStreamId(parsed.pubkey, parsed.streamId);
  if (!originStreamId) {
    return { ok: false, status: 400, error: "announceEvent stream identity is invalid." };
  }

  prunePlaybackPolicies();
  const previous = playbackPolicies.get(originStreamId);
  if (previous && parsed.createdAt < previous.createdAt) {
    return { ok: true, policy: previous };
  }

  const policy: PlaybackPolicy = {
    streamPubkey: parsed.pubkey.toLowerCase(),
    streamId: parsed.streamId,
    originStreamId,
    viewerAllowPubkeys: parsed.viewerAllowPubkeys.map((value) => value.toLowerCase()),
    privateStream: parsed.viewerAllowPubkeys.length > 0,
    vodArchiveEnabled: parsed.vodArchiveEnabled === true,
    vodVisibility: parsed.vodVisibility === "private" ? "private" : "public",
    status: parsed.status,
    createdAt: parsed.createdAt,
    updatedAtSec: nowSec()
  };

  playbackPolicies.set(originStreamId, policy);
  return { ok: true, policy };
}

export function issuePlaybackAccessToken(params: {
  originStreamId: string;
  viewerPubkey?: string | null;
  privateStream: boolean;
  ttlSec?: number;
}): { token: string; expiresAtSec: number } {
  const issuedAt = nowSec();
  const ttlSec = Math.max(30, Math.min(params.ttlSec ?? ACCESS_TOKEN_TTL_SEC, ACCESS_TOKEN_MAX_FUTURE_SEC));
  const expiresAtSec = issuedAt + ttlSec;
  const payload: AccessTokenPayload = {
    o: params.originStreamId,
    v: normalizePubkey(params.viewerPubkey) ?? "",
    p: params.privateStream ? 1 : 0,
    iat: issuedAt,
    exp: expiresAtSec,
    n: randomBytes(10).toString("base64url")
  };

  const payloadEncoded = encodeTokenPayload(payload);
  const signature = signTokenPayload(payloadEncoded);
  return {
    token: `${payloadEncoded}.${signature}`,
    expiresAtSec
  };
}

export function verifyPlaybackAccessToken(
  token: string | null,
  originStreamId: string
): { ok: true; payload: AccessTokenPayload } | { ok: false; error: string } {
  const raw = (token ?? "").trim();
  if (!raw) return { ok: false, error: "missing access token" };

  const [payloadEncoded, signature] = raw.split(".");
  if (!payloadEncoded || !signature) return { ok: false, error: "malformed access token" };
  const expectedSignature = signTokenPayload(payloadEncoded);
  if (!safeSignatureEquals(signature, expectedSignature)) {
    return { ok: false, error: "invalid access token signature" };
  }

  const payload = decodeTokenPayload(payloadEncoded);
  if (!payload) return { ok: false, error: "invalid access token payload" };
  if (payload.o !== originStreamId) return { ok: false, error: "token scope does not match stream" };

  const now = nowSec();
  if (payload.exp <= now) return { ok: false, error: "access token expired" };
  if (payload.iat > now + 30) return { ok: false, error: "access token issued in the future" };

  return { ok: true, payload };
}

export function verifyViewerProofEvent(
  viewerProofEvent: unknown,
  options: { originStreamId: string }
): { ok: true; viewerPubkey: string } | { ok: false; status: number; error: string } {
  if (!viewerProofEvent || typeof viewerProofEvent !== "object") {
    return { ok: false, status: 401, error: "viewerProofEvent is required for private stream access." };
  }
  const event = viewerProofEvent as NostrEvent;
  if (!isValidSignedEvent(event)) {
    return { ok: false, status: 401, error: "viewerProofEvent must be a valid signed Nostr event." };
  }

  const scope = findTagValue(event.tags ?? [], "dstream");
  if (scope !== "watch_access") {
    return { ok: false, status: 401, error: "viewerProofEvent scope is invalid." };
  }

  const streamTag = findTagValue(event.tags ?? [], "stream");
  if (streamTag !== options.originStreamId) {
    return { ok: false, status: 401, error: "viewerProofEvent stream scope mismatch." };
  }

  const expRaw = findTagValue(event.tags ?? [], "exp");
  const expSec = expRaw && /^\d+$/.test(expRaw) ? Number(expRaw) : 0;
  const now = nowSec();
  if (!Number.isInteger(expSec) || expSec <= now) {
    return { ok: false, status: 401, error: "viewerProofEvent is expired." };
  }
  if (expSec > now + ACCESS_TOKEN_MAX_FUTURE_SEC) {
    return { ok: false, status: 401, error: "viewerProofEvent expiry is too far in the future." };
  }
  if (event.created_at > now + 30 || now - event.created_at > VIEWER_PROOF_MAX_AGE_SEC) {
    return { ok: false, status: 401, error: "viewerProofEvent timestamp is stale." };
  }

  const viewerPubkey = normalizePubkey(event.pubkey);
  if (!viewerPubkey) {
    return { ok: false, status: 401, error: "viewerProofEvent pubkey is invalid." };
  }

  return { ok: true, viewerPubkey };
}

function isViewerAllowed(policy: PlaybackPolicy, viewerPubkey: string): boolean {
  if (!policy.privateStream) return true;
  if (viewerPubkey === policy.streamPubkey) return true;
  return policy.viewerAllowPubkeys.includes(viewerPubkey);
}

export function authorizePlaybackProxyRequest(
  pathSegments: string[],
  accessToken: string | null
): { ok: true } | { ok: false; status: number; error: string } {
  const originStreamId = parseOriginStreamIdFromPath(pathSegments);
  if (!originStreamId) return { ok: true };

  let resolvedOriginStreamId = originStreamId;
  let policy = getPlaybackPolicy(resolvedOriginStreamId);
  if (!policy) {
    const strippedOriginStreamId = stripRenditionSuffix(originStreamId);
    if (strippedOriginStreamId !== originStreamId) {
      const strippedPolicy = getPlaybackPolicy(strippedOriginStreamId);
      if (strippedPolicy) {
        resolvedOriginStreamId = strippedOriginStreamId;
        policy = strippedPolicy;
      }
    }
  }
  if (!policy || !policy.privateStream) return { ok: true };

  const verified = verifyPlaybackAccessToken(accessToken, resolvedOriginStreamId);
  if (!verified.ok) {
    return { ok: false, status: 403, error: `Playback access denied: ${verified.error}.` };
  }

  const viewerPubkey = normalizePubkey(verified.payload.v);
  if (!viewerPubkey) {
    return { ok: false, status: 403, error: "Playback access denied: viewer identity missing in access token." };
  }

  if (!isViewerAllowed(policy, viewerPubkey)) {
    return { ok: false, status: 403, error: "Playback access denied: viewer is not allowlisted for this stream." };
  }

  return { ok: true };
}

export function authorizeVodProxyRequest(
  originStreamId: string,
  accessToken: string | null
): { ok: true } | { ok: false; status: number; error: string } {
  const normalizedOriginStreamId = stripRenditionSuffix((originStreamId ?? "").trim());
  if (!normalizedOriginStreamId) {
    return { ok: false, status: 400, error: "VOD access denied: invalid stream id." };
  }

  const verified = verifyPlaybackAccessToken(accessToken, normalizedOriginStreamId);
  if (!verified.ok) {
    return { ok: false, status: 403, error: `VOD access denied: ${verified.error}.` };
  }

  const policy = getPlaybackPolicy(normalizedOriginStreamId);
  if (!policy) return { ok: true };
  if (!policy.vodArchiveEnabled) {
    return { ok: false, status: 403, error: "VOD access denied: archive is disabled for this stream." };
  }

  if (policy.vodVisibility !== "private") return { ok: true };

  const viewerPubkey = normalizePubkey(verified.payload.v);
  if (!viewerPubkey) {
    return { ok: false, status: 403, error: "VOD access denied: viewer identity missing in access token." };
  }

  if (!isViewerAllowed(policy, viewerPubkey)) {
    return { ok: false, status: 403, error: "VOD access denied: viewer is not allowlisted for private archive." };
  }

  return { ok: true };
}
