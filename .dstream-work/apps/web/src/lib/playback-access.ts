import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { statSync } from "node:fs";
import { makeOriginStreamId } from "./origin";
import { parseStreamAnnounceEvent, type NostrEvent } from "@dstream/protocol";
import { validateEvent, verifyEvent } from "nostr-tools";
import { evaluateAccess } from "./access/evaluator";
import { buildVideoAccessResourceCandidates } from "./access/packages";
import { readTextFileWithBackup, updateJsonFileAtomic } from "./storage/jsonFileStore";

const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const LIVE_ACCESS_TOKEN_TTL_SEC = 36 * 60 * 60;
const ACCESS_TOKEN_MAX_TTL_SEC = LIVE_ACCESS_TOKEN_TTL_SEC;
const VIEWER_PROOF_MAX_FUTURE_SEC = 60 * 60;
const VIEWER_PROOF_MAX_AGE_SEC = 10 * 60;
const POLICY_TTL_SEC = 36 * 60 * 60;
const POLICY_ENDED_TTL_SEC = 5 * 60;
const DEFAULT_POLICY_STORE_PATH = "/var/lib/dstream/playback-policies.json";
const ORIGIN_SEGMENT_RE = /^([a-f0-9]{64}--[A-Za-z0-9][A-Za-z0-9_-]{0,127})(?:__r[A-Za-z0-9_-]+)?$/;
const HEX64_RE = /^[a-f0-9]{64}$/;
const RENDITION_SUFFIX_RE = /^__r[A-Za-z0-9_-]+$/;

interface PlaybackPolicy {
  streamPubkey: string;
  streamId: string;
  originStreamId: string;
  viewerAllowPubkeys: string[];
  privateStream: boolean;
  videoArchiveEnabled: boolean;
  videoVisibility: "public" | "private";
  status: "live" | "ended";
  createdAt: number;
  updatedAtSec: number;
}

interface PlaybackPolicyStore {
  version: 1;
  updatedAtSec: number;
  policies: PlaybackPolicy[];
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
let policyStoreLoaded = false;
let policyStoreMtimeMs = -1;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function getTokenSecret(): Buffer {
  if (cachedTokenSecret) return cachedTokenSecret;
  const configured = (process.env.DSTREAM_PLAYBACK_ACCESS_SECRET ?? process.env.DSTREAM_ACCESS_TOKEN_SECRET ?? "").trim();
  cachedTokenSecret = configured ? Buffer.from(configured, "utf8") : randomBytes(32);
  return cachedTokenSecret;
}

function getPolicyStorePath(): string {
  return (process.env.DSTREAM_PLAYBACK_POLICY_STORE_PATH ?? DEFAULT_POLICY_STORE_PATH).trim() || DEFAULT_POLICY_STORE_PATH;
}

function parseStoredPolicy(input: unknown): PlaybackPolicy | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<PlaybackPolicy>;
  const streamPubkey = normalizePubkey(row.streamPubkey);
  const streamId = typeof row.streamId === "string" ? row.streamId.trim() : "";
  const originStreamId = streamPubkey && streamId ? makeOriginStreamId(streamPubkey, streamId) : null;
  if (!streamPubkey || !streamId || !originStreamId || row.originStreamId !== originStreamId) return null;
  if (row.status !== "live" && row.status !== "ended") return null;
  if (row.videoVisibility !== "public" && row.videoVisibility !== "private") return null;
  if (!Number.isInteger(row.createdAt) || !Number.isInteger(row.updatedAtSec)) return null;
  const viewerAllowPubkeys = Array.isArray(row.viewerAllowPubkeys)
    ? Array.from(new Set(row.viewerAllowPubkeys.map((value) => normalizePubkey(value)).filter((value): value is string => !!value)))
    : [];
  return {
    streamPubkey,
    streamId,
    originStreamId,
    viewerAllowPubkeys,
    privateStream: row.privateStream === true,
    videoArchiveEnabled: row.videoArchiveEnabled === true,
    videoVisibility: row.videoVisibility,
    status: row.status,
    createdAt: row.createdAt as number,
    updatedAtSec: row.updatedAtSec as number
  };
}

function refreshPlaybackPoliciesFromDisk(): void {
  const storePath = getPolicyStorePath();
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(storePath).mtimeMs;
  } catch {
    policyStoreLoaded = true;
    return;
  }
  if (policyStoreLoaded && mtimeMs === policyStoreMtimeMs) return;

  try {
    const raw = readTextFileWithBackup(storePath);
    const parsed = raw ? (JSON.parse(raw) as { policies?: unknown[] } | null) : null;
    const nextPolicies = Array.isArray(parsed?.policies)
      ? parsed!.policies!.map(parseStoredPolicy).filter((policy): policy is PlaybackPolicy => !!policy)
      : [];
    playbackPolicies.clear();
    for (const policy of nextPolicies) playbackPolicies.set(policy.originStreamId, policy);
    policyStoreMtimeMs = mtimeMs;
  } catch {
    // Keep the last known in-memory policies if the durable store is temporarily unreadable.
  } finally {
    policyStoreLoaded = true;
  }
}

function isPlaybackPolicyExpired(policy: PlaybackPolicy, atSec: number): boolean {
  const age = atSec - policy.updatedAtSec;
  return policy.status === "ended" ? age > POLICY_ENDED_TTL_SEC : age > POLICY_TTL_SEC;
}

function shouldReplaceStoredPolicy(current: PlaybackPolicy | undefined, candidate: PlaybackPolicy): boolean {
  if (!current) return true;
  if (candidate.createdAt !== current.createdAt) return candidate.createdAt > current.createdAt;
  return candidate.updatedAtSec >= current.updatedAtSec;
}

function persistPlaybackPolicies(): boolean {
  try {
    const storePath = getPolicyStorePath();
    const atSec = nowSec();
    const localPolicies = Array.from(playbackPolicies.values());
    const persisted = updateJsonFileAtomic<PlaybackPolicyStore>(
      storePath,
      { version: 1, updatedAtSec: atSec, policies: [] },
      (current) => {
        const merged = new Map<string, PlaybackPolicy>();
        const currentPolicies = Array.isArray(current?.policies) ? current.policies : [];
        for (const rawPolicy of currentPolicies) {
          const policy = parseStoredPolicy(rawPolicy);
          if (!policy || isPlaybackPolicyExpired(policy, atSec)) continue;
          merged.set(policy.originStreamId, policy);
        }
        for (const policy of localPolicies) {
          if (isPlaybackPolicyExpired(policy, atSec)) continue;
          if (shouldReplaceStoredPolicy(merged.get(policy.originStreamId), policy)) {
            merged.set(policy.originStreamId, policy);
          }
        }
        return { version: 1, updatedAtSec: atSec, policies: Array.from(merged.values()) };
      }
    );
    playbackPolicies.clear();
    for (const rawPolicy of persisted.policies) {
      const policy = parseStoredPolicy(rawPolicy);
      if (policy) playbackPolicies.set(policy.originStreamId, policy);
    }
    policyStoreMtimeMs = -1;
    policyStoreLoaded = false;
    refreshPlaybackPoliciesFromDisk();
    return true;
  } catch {
    return false;
  }
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
  refreshPlaybackPoliciesFromDisk();
  const now = nowSec();
  let changed = false;
  for (const [originStreamId, policy] of playbackPolicies.entries()) {
    if (isPlaybackPolicyExpired(policy, now)) {
      playbackPolicies.delete(originStreamId);
      changed = true;
    }
  }
  if (changed) persistPlaybackPolicies();
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
    privateStream: parsed.streamVisibility === "private",
    videoArchiveEnabled: parsed.videoArchiveEnabled === true,
    videoVisibility: parsed.videoVisibility === "private" ? "private" : "public",
    status: parsed.status,
    createdAt: parsed.createdAt,
    updatedAtSec: nowSec()
  };

  playbackPolicies.set(originStreamId, policy);
  const persisted = persistPlaybackPolicies();
  if (policy.privateStream && !persisted) {
    return { ok: false, status: 503, error: "private playback policy could not be written to durable storage" };
  }
  return { ok: true, policy };
}

export function issuePlaybackAccessToken(params: {
  originStreamId: string;
  viewerPubkey?: string | null;
  privateStream: boolean;
  liveStream?: boolean;
  ttlSec?: number;
}): { token: string; expiresAtSec: number } {
  const issuedAt = nowSec();
  const defaultTtlSec = params.liveStream ? LIVE_ACCESS_TOKEN_TTL_SEC : ACCESS_TOKEN_TTL_SEC;
  const ttlSec = Math.max(30, Math.min(params.ttlSec ?? defaultTtlSec, ACCESS_TOKEN_MAX_TTL_SEC));
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

export function refreshPlaybackAccessToken(params: {
  token: string | null | undefined;
  announceEvent?: unknown;
  ttlSec?: number;
}):
  | {
      ok: true;
      token: string;
      expiresAtSec: number;
      originStreamId: string;
      privateStream: boolean;
      privateVideo: boolean;
      videoVisibility: "public" | "private";
      reasonCode: string;
      entitlementId: string | null;
    }
  | { ok: false; status: number; error: string } {
  const rawToken = (params.token ?? "").trim();
  if (!rawToken) {
    return { ok: false, status: 400, error: "token is required." };
  }

  const [payloadEncoded] = rawToken.split(".");
  const decoded = payloadEncoded ? decodeTokenPayload(payloadEncoded) : null;
  const originStreamId = (decoded?.o ?? "").trim();
  if (!originStreamId) {
    return { ok: false, status: 401, error: "malformed access token." };
  }

  const verified = verifyPlaybackAccessToken(rawToken, originStreamId);
  if (!verified.ok) {
    return { ok: false, status: 401, error: verified.error };
  }

  const registration = params.announceEvent ? registerPlaybackPolicyFromAnnounceEvent(params.announceEvent) : null;
  if (registration && !registration.ok) return registration;

  if (registration?.ok && registration.policy.originStreamId !== originStreamId) {
    return { ok: false, status: 400, error: "token scope does not match announceEvent." };
  }

  const policy = registration?.ok ? registration.policy : getPlaybackPolicy(originStreamId);
  if (!policy) {
    return {
      ok: false,
      status: 409,
      error: "playback policy unavailable for token scope. Provide announceEvent or reissue token."
    };
  }

  const subjectPubkey = normalizePubkey(verified.payload.v) ?? undefined;
  const resourceBase = `stream:${policy.streamPubkey}:${policy.streamId}`;
  const announceContext = buildAnnounceContext(policy);

  let liveDecision: ReturnType<typeof evaluateAccess> | null = null;
  if (policy.status === "live") {
    liveDecision = evaluateAccess({
      hostPubkey: policy.streamPubkey,
      subjectPubkey,
      resourceId: `${resourceBase}:live`,
      action: "watch_live",
      announce: announceContext,
      skipAudit: true
    });
    if (!liveDecision.allowed) {
      return { ok: false, status: 403, error: decisionToPlaybackError(liveDecision) };
    }
  }

  if (announceContext.privateVideo && !subjectPubkey) {
    const videoDecision = evaluateAccess({
      hostPubkey: policy.streamPubkey,
      resourceId: `${resourceBase}:video:*`,
      action: "watch_video",
      announce: announceContext,
      skipAudit: true
    });
    return { ok: false, status: 403, error: decisionToVideoError(videoDecision) };
  }

  const issued = issuePlaybackAccessToken({
    originStreamId: policy.originStreamId,
    viewerPubkey: subjectPubkey,
    privateStream: policy.privateStream,
    liveStream: policy.status === "live",
    ttlSec: params.ttlSec
  });

  return {
    ok: true,
    token: issued.token,
    expiresAtSec: issued.expiresAtSec,
    originStreamId: policy.originStreamId,
    privateStream: policy.privateStream,
    privateVideo: announceContext.privateVideo,
    videoVisibility: policy.videoVisibility,
    reasonCode: liveDecision?.reasonCode ?? "allow_public",
    entitlementId: liveDecision?.entitlementId ?? null
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
  if (expSec > now + VIEWER_PROOF_MAX_FUTURE_SEC) {
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

function decisionToPlaybackError(decision: ReturnType<typeof evaluateAccess>): string {
  switch (decision.reasonCode) {
    case "deny_identity_required":
      return "Playback access denied: identity is required.";
    case "deny_private_allowlist":
      return "Playback access denied: viewer is not allowlisted for this stream.";
    case "deny_explicit":
      return "Playback access denied: viewer is blocked by stream policy.";
    case "deny_no_matching_entitlement":
      return "Playback access denied: viewer does not have required entitlement.";
    default:
      return "Playback access denied.";
  }
}

function decisionToVideoError(decision: ReturnType<typeof evaluateAccess>): string {
  switch (decision.reasonCode) {
    case "deny_identity_required":
      return "Video access denied: identity is required.";
    case "deny_private_allowlist":
      return "Video access denied: viewer is not allowlisted for private archive.";
    case "deny_video_archive_disabled":
      return "Video access denied: archive is disabled for this stream.";
    case "deny_explicit":
      return "Video access denied: viewer is blocked by stream policy.";
    case "deny_no_matching_entitlement":
      return "Video access denied: viewer does not have required entitlement.";
    default:
      return "Video access denied.";
  }
}

function buildAnnounceContext(policy: PlaybackPolicy) {
  return {
    privateStream: policy.privateStream,
    privateVideo: policy.videoArchiveEnabled && policy.videoVisibility === "private",
    videoArchiveEnabled: policy.videoArchiveEnabled,
    videoVisibility: policy.videoVisibility,
    viewerAllowPubkeys: policy.viewerAllowPubkeys,
    feeWaiverVipPubkeys: []
  };
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
  if (!policy) return { ok: true };

  const resourceId = `stream:${policy.streamPubkey}:${policy.streamId}:live`;
  const announce = buildAnnounceContext(policy);

  if (!accessToken?.trim()) {
    const anonymousDecision = evaluateAccess({
      hostPubkey: policy.streamPubkey,
      resourceId,
      action: "watch_live",
      announce,
      skipAudit: true
    });
    if (!anonymousDecision.allowed) {
      return { ok: false, status: 403, error: decisionToPlaybackError(anonymousDecision) };
    }
    return { ok: true };
  }

  const verified = verifyPlaybackAccessToken(accessToken, resolvedOriginStreamId);
  if (!verified.ok) {
    return { ok: false, status: 403, error: `Playback access denied: ${verified.error}.` };
  }

  const decision = evaluateAccess({
    hostPubkey: policy.streamPubkey,
    subjectPubkey: normalizePubkey(verified.payload.v) ?? undefined,
    resourceId,
    action: "watch_live",
    announce,
    skipAudit: true
  });
  if (!decision.allowed) {
    return { ok: false, status: 403, error: decisionToPlaybackError(decision) };
  }

  return { ok: true };
}

export function authorizeVideoProxyRequest(
  originStreamId: string,
  accessToken: string | null,
  filePathSegments?: string[]
): { ok: true } | { ok: false; status: number; error: string } {
  const normalizedOriginStreamId = stripRenditionSuffix((originStreamId ?? "").trim());
  if (!normalizedOriginStreamId) {
    return { ok: false, status: 400, error: "Video access denied: invalid stream id." };
  }

  const policy = getPlaybackPolicy(normalizedOriginStreamId);
  if (!policy) return { ok: true };

  const safeSegments = (filePathSegments ?? [])
    .map((segment) => decodeURIComponent(String(segment ?? "")).trim())
    .filter((segment) => !!segment && segment !== "." && segment !== "..");
  const relativePath = safeSegments.join("/") || undefined;
  const resourceCandidates = buildVideoAccessResourceCandidates({
    hostPubkey: policy.streamPubkey,
    streamId: policy.streamId,
    relativePath
  });
  if (!accessToken?.trim()) {
    const anonymousDecisions = resourceCandidates.map((resourceId) =>
      evaluateAccess({
        hostPubkey: policy.streamPubkey,
        resourceId,
        action: "watch_video",
        announce: buildAnnounceContext(policy),
        skipAudit: true
      })
    );
    const anonymousHardDeny = anonymousDecisions.find(
      (decision) => decision.reasonCode === "deny_explicit" || decision.reasonCode === "deny_video_archive_disabled"
    );
    if (anonymousHardDeny) return { ok: false, status: 403, error: decisionToVideoError(anonymousHardDeny) };
    if (anonymousDecisions.some((decision) => decision.allowed)) return { ok: true };
    const anonymousLast =
      anonymousDecisions[anonymousDecisions.length - 1] ??
      ({ allowed: false, reasonCode: "deny_no_matching_entitlement" } as ReturnType<typeof evaluateAccess>);
    return { ok: false, status: 403, error: decisionToVideoError(anonymousLast) };
  }

  const verified = verifyPlaybackAccessToken(accessToken, normalizedOriginStreamId);
  if (!verified.ok) {
    return { ok: false, status: 403, error: `Video access denied: ${verified.error}.` };
  }
  const decisions = resourceCandidates.map((resourceId) =>
    evaluateAccess({
      hostPubkey: policy.streamPubkey,
      subjectPubkey: normalizePubkey(verified.payload.v) ?? undefined,
      resourceId,
      action: "watch_video",
      announce: buildAnnounceContext(policy),
      skipAudit: true
    })
  );
  const hardDeny = decisions.find((decision) => decision.reasonCode === "deny_explicit" || decision.reasonCode === "deny_video_archive_disabled");
  if (hardDeny) return { ok: false, status: 403, error: decisionToVideoError(hardDeny) };
  if (decisions.some((decision) => decision.allowed)) return { ok: true };
  const lastDecision = decisions[decisions.length - 1] ?? ({ allowed: false, reasonCode: "deny_no_matching_entitlement" } as ReturnType<typeof evaluateAccess>);
  return { ok: false, status: 403, error: decisionToVideoError(lastDecision) };
}
