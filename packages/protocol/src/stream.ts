import type {
  NostrEvent,
  StreamAnnounce,
  StreamVodAccessScope,
  StreamCaptionTrack,
  StreamRendition,
  StreamStatus,
  StreamVodMode,
  StreamVodPolicy
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

function normalizeVodMode(input: string | undefined): StreamVodMode | undefined {
  if (!input) return undefined;
  if (input === "off" || input === "public" || input === "paid") return input;
  return undefined;
}

function normalizeVodCurrency(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const value = input.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,24}$/.test(value)) return undefined;
  return value;
}

function normalizeVodAccessScope(input: string | undefined): StreamVodAccessScope | undefined {
  if (!input) return undefined;
  if (input === "stream" || input === "playlist") return input;
  return undefined;
}

function normalizeVodPolicy(input: StreamVodPolicy | undefined): StreamVodPolicy | undefined {
  if (!input) return undefined;
  const mode = normalizeVodMode(input.mode);
  if (!mode) return undefined;
  const priceAtomic = (input.priceAtomic ?? "").trim();
  const currency = normalizeVodCurrency(input.currency);
  const accessSeconds = parsePositiveInt(input.accessSeconds ? String(input.accessSeconds) : "");
  const playlistId = (input.playlistId ?? "").trim() || undefined;
  const accessScope = normalizeVodAccessScope(input.accessScope);

  return {
    mode,
    priceAtomic: /^\d+$/.test(priceAtomic) ? priceAtomic : undefined,
    currency,
    accessSeconds,
    playlistId,
    accessScope
  };
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
  manifestSignerPubkey?: string;
  stakeAmountAtomic?: string;
  stakeNote?: string;
  vod?: StreamVodPolicy;
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
  if (input.manifestSignerPubkey) tags.push(["manifest", input.manifestSignerPubkey]);
  if (input.stakeAmountAtomic) tags.push(["stake", input.stakeAmountAtomic]);
  if (input.stakeNote) tags.push(["stake_note", input.stakeNote]);

  const vod = normalizeVodPolicy(input.vod);
  if (vod) {
    tags.push(["vod_mode", vod.mode]);
    if (vod.priceAtomic) tags.push(["vod_price", vod.priceAtomic]);
    if (vod.currency) tags.push(["vod_currency", vod.currency]);
    if (vod.accessSeconds) tags.push(["vod_access_sec", String(vod.accessSeconds)]);
    if (vod.playlistId) tags.push(["vod_playlist", vod.playlistId]);
    if (vod.accessScope) tags.push(["vod_scope", vod.accessScope]);
  }

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

  const stakeAmountAtomicRaw = getFirstTagValue(event.tags, "stake");
  const stakeAmountAtomic = stakeAmountAtomicRaw && /^\d+$/.test(stakeAmountAtomicRaw) ? stakeAmountAtomicRaw : undefined;
  const vodMode = normalizeVodMode(getFirstTagValue(event.tags, "vod_mode"));
  const vodPriceAtomicRaw = getFirstTagValue(event.tags, "vod_price");
  const vodPriceAtomic = vodPriceAtomicRaw && /^\d+$/.test(vodPriceAtomicRaw) ? vodPriceAtomicRaw : undefined;
  const vodCurrency = normalizeVodCurrency(getFirstTagValue(event.tags, "vod_currency"));
  const vodAccessSeconds = parsePositiveInt(getFirstTagValue(event.tags, "vod_access_sec"));
  const vodPlaylistId = (getFirstTagValue(event.tags, "vod_playlist") ?? "").trim() || undefined;
  const vodAccessScope = normalizeVodAccessScope(getFirstTagValue(event.tags, "vod_scope"));

  let vod: StreamVodPolicy | undefined;
  if (vodMode || vodPriceAtomic || vodCurrency || vodAccessSeconds || vodPlaylistId || vodAccessScope) {
    const defaultScope: StreamVodAccessScope =
      vodMode === "paid" && vodPlaylistId ? "playlist" : "stream";
    vod = {
      mode: vodMode ?? "public",
      priceAtomic: vodPriceAtomic,
      currency: vodCurrency,
      accessSeconds: vodAccessSeconds,
      playlistId: vodPlaylistId,
      accessScope: vodAccessScope ?? defaultScope
    };
  }

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
    manifestSignerPubkey,
    stakeAmountAtomic,
    stakeNote: getFirstTagValue(event.tags, "stake_note"),
    vod,
    captions,
    renditions,
    topics: sortTopicTags(getAllTagValues(event.tags, "t")),
    createdAt: event.created_at,
    raw: event
  };
}
