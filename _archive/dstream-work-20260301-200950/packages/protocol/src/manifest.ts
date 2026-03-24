import type { ManifestInitSegment, ManifestSegment, NostrEvent, StreamManifestRoot } from "./types";
import { NOSTR_KINDS } from "./types";
import { assertStreamIdentity, getFirstTagValue, makeATag } from "./nostr";
import { isHex64 } from "./validate";

export interface BuildStreamManifestRootInput {
  pubkey: string; // manifest signer pubkey
  createdAt: number;
  streamPubkey: string;
  streamId: string;
  renditionId: string;
  epochStartMs: number;
  epochDurationMs: number;
  segments: ManifestSegment[];
  init?: ManifestInitSegment;
}

function makeDTag(input: { streamPubkey: string; streamId: string; renditionId: string; epochStartMs: number }): string {
  return `${input.streamPubkey}:${input.streamId}:${input.renditionId}:${input.epochStartMs}`;
}

function isValidSegment(seg: any): seg is ManifestSegment {
  if (!seg || typeof seg !== "object") return false;
  if (typeof seg.uri !== "string" || seg.uri.trim().length === 0) return false;
  if (typeof seg.sha256 !== "string" || !isHex64(seg.sha256)) return false;
  if (seg.byteLength !== undefined && !(typeof seg.byteLength === "number" && Number.isFinite(seg.byteLength) && seg.byteLength >= 0)) {
    return false;
  }
  return true;
}

function isValidInit(seg: any): seg is ManifestInitSegment {
  if (!seg || typeof seg !== "object") return false;
  if (typeof seg.uri !== "string" || seg.uri.trim().length === 0) return false;
  if (typeof seg.sha256 !== "string" || !isHex64(seg.sha256)) return false;
  if (seg.byteLength !== undefined && !(typeof seg.byteLength === "number" && Number.isFinite(seg.byteLength) && seg.byteLength >= 0)) {
    return false;
  }
  return true;
}

export function buildStreamManifestRootEvent(input: BuildStreamManifestRootInput): Omit<NostrEvent, "id" | "sig"> {
  if (!isHex64(input.pubkey)) throw new Error("pubkey must be 64-hex");
  assertStreamIdentity(input.streamPubkey, input.streamId);

  const tags: string[][] = [
    ["d", makeDTag(input)],
    ["a", makeATag(input.streamPubkey, input.streamId)],
    ["r", input.renditionId],
    ["epoch", String(input.epochStartMs), String(input.epochDurationMs)]
  ];

  const content = JSON.stringify({
    v: 1,
    streamPubkey: input.streamPubkey,
    streamId: input.streamId,
    renditionId: input.renditionId,
    epochStartMs: input.epochStartMs,
    epochDurationMs: input.epochDurationMs,
    segments: input.segments,
    init: input.init
  });

  return {
    kind: NOSTR_KINDS.MANIFEST_ROOT,
    pubkey: input.pubkey,
    created_at: input.createdAt,
    tags,
    content
  };
}

export function parseStreamManifestRootEvent(event: NostrEvent): StreamManifestRoot | null {
  if (!event || event.kind !== NOSTR_KINDS.MANIFEST_ROOT) return null;
  if (!event.pubkey || !event.tags) return null;

  const a = getFirstTagValue(event.tags, "a");
  const renditionTag = getFirstTagValue(event.tags, "r");
  const epochTag = event.tags.find((t) => t[0] === "epoch");
  if (!a || !renditionTag || !epochTag) return null;
  const epochStartMs = Number(epochTag[1]);
  const epochDurationMs = Number(epochTag[2]);
  if (!Number.isFinite(epochStartMs) || !Number.isFinite(epochDurationMs)) return null;

  let obj: any;
  try {
    obj = JSON.parse(event.content || "{}");
  } catch {
    return null;
  }

  if (!obj || typeof obj !== "object" || obj.v !== 1) return null;
  if (typeof obj.streamPubkey !== "string" || !isHex64(obj.streamPubkey)) return null;
  if (typeof obj.streamId !== "string" || obj.streamId.trim().length === 0) return null;
  if (typeof obj.renditionId !== "string" || obj.renditionId.trim().length === 0) return null;
  if (typeof obj.epochStartMs !== "number" || typeof obj.epochDurationMs !== "number") return null;
  if (!Array.isArray(obj.segments) || obj.segments.length === 0) return null;

  try {
    assertStreamIdentity(obj.streamPubkey, obj.streamId);
  } catch {
    return null;
  }

  const expectedA = makeATag(obj.streamPubkey, obj.streamId);
  if (a !== expectedA) return null;
  if (renditionTag !== obj.renditionId) return null;
  if (epochStartMs !== obj.epochStartMs) return null;
  if (epochDurationMs !== obj.epochDurationMs) return null;

  const segments: ManifestSegment[] = obj.segments.filter(isValidSegment);
  if (segments.length !== obj.segments.length) return null;

  const init = obj.init !== undefined ? (isValidInit(obj.init) ? (obj.init as ManifestInitSegment) : null) : undefined;
  if (init === null) return null;

  return {
    pubkey: event.pubkey,
    streamPubkey: obj.streamPubkey.toLowerCase(),
    streamId: obj.streamId,
    renditionId: obj.renditionId,
    epochStartMs,
    epochDurationMs,
    segments,
    init,
    createdAt: event.created_at,
    raw: event
  };
}
