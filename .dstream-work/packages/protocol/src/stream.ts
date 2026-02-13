import type {
  NostrEvent,
  StreamAnnounce,
  StreamCaptionTrack,
  StreamHostMode,
  StreamRendition,
  StreamStatus
} from "./types";
import { NOSTR_KINDS } from "./types";
import { assertStreamIdentity, getAllTagValues, getFirstTagValue, sortTopicTags } from "./nostr";
import { isHex64 } from "./validate";

function parsePositiveInt(input: string | undefined): number | undefined {
  if (!input) return undefined;
  if (!/^\d+$/.test(input)) return undefined;
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function normalizeHostMode(input: string | undefined): StreamHostMode | undefined {
  if (!input) return undefined;
  const value = input.trim().toLowerCase();
  if (value === "p2p_economy" || value === "host_only") return value;
  return undefined;
}

function normalizeCaptionTrack(input: StreamCaptionTrack): StreamCaptionTrack | null {
  const lang = (input.lang ?? "").trim().toLowerCase();
  const label = (input.label ?? "").trim();
  const url = (input.url ?? "").trim();
  if (!lang || !label || !url) return null;
  return {
    lang,
    label,
    url,
    isDefault: !!input.isDefault
  };
}

function normalizeRendition(input: StreamRendition): StreamRendition | null {
  const id = (input.id ?? "").trim();
  const url = (input.url ?? "").trim();
  if (!id || !url) return null;
  const bandwidth = parsePositiveInt(String(input.bandwidth ?? ""));
  const width = parsePositiveInt(String(input.width ?? ""));
  const height = parsePositiveInt(String(input.height ?? ""));
  const codecs = (input.codecs ?? "").trim() || undefined;
  return {
    id,
    url,
    bandwidth,
    width,
    height,
    codecs
  };
}

function parseCaptionTag(tag: string[]): StreamCaptionTrack | null {
  if (tag[0] !== "caption") return null;
  const lang = (tag[1] ?? "").trim().toLowerCase();
  const label = (tag[2] ?? "").trim();
  const url = (tag[3] ?? "").trim();
  if (!lang || !label || !url) return null;
  const defaultRaw = (tag[4] ?? "").trim().toLowerCase();
  return {
    lang,
    label,
    url,
    isDefault: defaultRaw === "1" || defaultRaw === "true" || defaultRaw === "yes"
  };
}

function parseRenditionTag(tag: string[]): StreamRendition | null {
  if (tag[0] !== "rendition") return null;
  const id = (tag[1] ?? "").trim();
  const url = (tag[2] ?? "").trim();
  if (!id || !url) return null;
  return {
    id,
    url,
    bandwidth: parsePositiveInt(tag[3]),
    width: parsePositiveInt(tag[4]),
    height: parsePositiveInt(tag[5]),
    codecs: (tag[6] ?? "").trim() || undefined
  };
}

export interface BuildStreamAnnounceInput {
  pubkey: string;
  createdAt: number;
  streamId: string;
  title: string;
  status: StreamStatus;
  summary?: string;
  image?: string;
  streaming?: string;
  xmr?: string;
  hostMode?: StreamHostMode;
  rebroadcastThreshold?: number;
  manifestSignerPubkey?: string;
  stakeAmountAtomic?: string;
  stakeNote?: string;
  captions?: StreamCaptionTrack[];
  renditions?: StreamRendition[];
  topics?: string[];
}

export function buildStreamAnnounceEvent(input: BuildStreamAnnounceInput): Omit<NostrEvent, "id" | "sig"> {
  assertStreamIdentity(input.pubkey, input.streamId);

  const tags: string[][] = [
    ["d", input.streamId],
    ["title", input.title],
    ["status", input.status]
  ];

  if (input.summary) tags.push(["summary", input.summary]);
  if (input.image) tags.push(["image", input.image]);
  if (input.streaming) tags.push(["streaming", input.streaming]);
  if (input.xmr) tags.push(["xmr", input.xmr]);
  if (input.hostMode) tags.push(["host_mode", input.hostMode]);
  if (typeof input.rebroadcastThreshold === "number") {
    const normalized = parsePositiveInt(String(input.rebroadcastThreshold));
    if (normalized) tags.push(["rebroadcast_threshold", String(normalized)]);
  }
  if (input.manifestSignerPubkey) tags.push(["manifest", input.manifestSignerPubkey]);
  if (input.stakeAmountAtomic) tags.push(["stake", input.stakeAmountAtomic]);
  if (input.stakeNote) tags.push(["stake_note", input.stakeNote]);

  const captions = (input.captions ?? []).map(normalizeCaptionTrack).filter((value): value is StreamCaptionTrack => !!value);
  for (const caption of captions) {
    tags.push(["caption", caption.lang, caption.label, caption.url, caption.isDefault ? "1" : "0"]);
  }

  const renditions = (input.renditions ?? []).map(normalizeRendition).filter((value): value is StreamRendition => !!value);
  for (const rendition of renditions) {
    tags.push([
      "rendition",
      rendition.id,
      rendition.url,
      rendition.bandwidth ? String(rendition.bandwidth) : "",
      rendition.width ? String(rendition.width) : "",
      rendition.height ? String(rendition.height) : "",
      rendition.codecs ?? ""
    ]);
  }

  for (const topic of sortTopicTags(input.topics ?? [])) {
    tags.push(["t", topic]);
  }

  return {
    kind: NOSTR_KINDS.STREAM_ANNOUNCE,
    pubkey: input.pubkey,
    created_at: input.createdAt,
    tags,
    content: ""
  };
}

export function parseStreamAnnounceEvent(event: NostrEvent): StreamAnnounce | null {
  if (!event || event.kind !== NOSTR_KINDS.STREAM_ANNOUNCE) return null;
  if (!event.pubkey || !event.tags) return null;

  const streamId = getFirstTagValue(event.tags, "d");
  const title = getFirstTagValue(event.tags, "title") ?? streamId ?? "";
  const statusRaw = getFirstTagValue(event.tags, "status");

  if (!streamId) return null;
  if (statusRaw !== "live" && statusRaw !== "ended") return null;

  try {
    assertStreamIdentity(event.pubkey, streamId);
  } catch {
    return null;
  }

  const manifestSigner = getFirstTagValue(event.tags, "manifest");
  const manifestSignerPubkey = manifestSigner && isHex64(manifestSigner) ? manifestSigner.toLowerCase() : undefined;
  const hostMode = normalizeHostMode(getFirstTagValue(event.tags, "host_mode"));
  const rebroadcastThreshold = parsePositiveInt(getFirstTagValue(event.tags, "rebroadcast_threshold"));

  const stakeAmountAtomicRaw = getFirstTagValue(event.tags, "stake");
  const stakeAmountAtomic = stakeAmountAtomicRaw && /^\d+$/.test(stakeAmountAtomicRaw) ? stakeAmountAtomicRaw : undefined;
  const captions = event.tags.map(parseCaptionTag).filter((value): value is StreamCaptionTrack => !!value);
  const renditions = event.tags.map(parseRenditionTag).filter((value): value is StreamRendition => !!value);

  return {
    pubkey: event.pubkey,
    streamId,
    title,
    status: statusRaw,
    summary: getFirstTagValue(event.tags, "summary"),
    image: getFirstTagValue(event.tags, "image"),
    streaming: getFirstTagValue(event.tags, "streaming"),
    xmr: getFirstTagValue(event.tags, "xmr"),
    hostMode,
    rebroadcastThreshold,
    manifestSignerPubkey,
    stakeAmountAtomic,
    stakeNote: getFirstTagValue(event.tags, "stake_note"),
    captions,
    renditions,
    topics: sortTopicTags(getAllTagValues(event.tags, "t")),
    createdAt: event.created_at,
    raw: event
  };
}
