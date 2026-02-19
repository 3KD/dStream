import type {
  NostrEvent,
  StreamAnnounce,
  StreamCaptionTrack,
  StreamGuildFeeWaiver,
  StreamPaymentAsset,
  StreamPaymentMethod,
  StreamHostMode,
  StreamRendition,
  StreamStatus
} from "./types";
import { NOSTR_KINDS, STREAM_PAYMENT_ASSETS } from "./types";
import {
  assertStreamIdentity,
  getAllTagValues,
  getFirstTagValue,
  makeGuildATag,
  makeGuildKey,
  parseGuildATag,
  sortTopicTags
} from "./nostr";
import { isHex64 } from "./validate";

function parsePositiveInt(input: string | undefined): number | undefined {
  if (!input) return undefined;
  if (!/^\d+$/.test(input)) return undefined;
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function parseBooleanFlag(input: string | undefined): boolean | undefined {
  if (!input) return undefined;
  const value = input.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return undefined;
}

function normalizePaymentAsset(input: string | undefined): StreamPaymentAsset | undefined {
  if (!input) return undefined;
  const value = input.trim().toLowerCase();
  return STREAM_PAYMENT_ASSETS.includes(value as StreamPaymentAsset) ? (value as StreamPaymentAsset) : undefined;
}

function isValidPaymentAddress(asset: StreamPaymentAsset, addressRaw: string): boolean {
  const address = addressRaw.trim();
  if (!address) return false;

  switch (asset) {
    case "xmr":
      return /^[48][1-9A-HJ-NP-Za-km-z]{94,105}$/.test(address);
    case "eth":
    case "usdt":
    case "usdc":
    case "pepe":
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    case "btc":
      return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,87}$/.test(address);
    case "xrp":
      return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
    case "sol":
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    case "trx":
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
    case "doge":
      return /^[DA9][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
    case "bch":
      return /^(bitcoincash:)?(q|p)[a-z0-9]{41}$/.test(address.toLowerCase());
    case "ada":
      return /^(addr1|Ae2)[0-9a-zA-Z]{20,200}$/.test(address);
    default:
      return false;
  }
}

function normalizePaymentMethod(input: StreamPaymentMethod): StreamPaymentMethod | null {
  const asset = normalizePaymentAsset(input.asset);
  const address = (input.address ?? "").trim();
  if (!asset || !address) return null;
  if (!isValidPaymentAddress(asset, address)) return null;
  const network = (input.network ?? "").trim() || undefined;
  const label = (input.label ?? "").trim() || undefined;
  return { asset, address, network, label };
}

function paymentMethodKey(input: StreamPaymentMethod): string {
  return `${input.asset}|${input.address}|${input.network ?? ""}|${input.label ?? ""}`;
}

function normalizePaymentMethods(input: StreamPaymentMethod[]): StreamPaymentMethod[] {
  const out: StreamPaymentMethod[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const method = normalizePaymentMethod(raw);
    if (!method) continue;
    const key = paymentMethodKey(method);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(method);
  }
  return out;
}

function normalizeHostMode(input: string | undefined): StreamHostMode | undefined {
  if (!input) return undefined;
  const value = input.trim().toLowerCase();
  if (value === "p2p_economy" || value === "host_only") return value;
  return undefined;
}

function normalizeGuildFeeWaiver(input: StreamGuildFeeWaiver): StreamGuildFeeWaiver | null {
  const guildPubkey = (input.guildPubkey ?? "").trim().toLowerCase();
  const guildId = (input.guildId ?? "").trim();
  if (!isHex64(guildPubkey) || !guildId) return null;
  return { guildPubkey, guildId };
}

function normalizeGuildFeeWaivers(input: StreamGuildFeeWaiver[]): StreamGuildFeeWaiver[] {
  const out: StreamGuildFeeWaiver[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const waiver = normalizeGuildFeeWaiver(raw);
    if (!waiver) continue;
    const key = makeGuildKey(waiver.guildPubkey, waiver.guildId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(waiver);
  }
  return out;
}

function normalizeVipPubkeys(input: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const pubkey = (raw ?? "").trim().toLowerCase();
    if (!isHex64(pubkey)) continue;
    if (seen.has(pubkey)) continue;
    seen.add(pubkey);
    out.push(pubkey);
  }
  return out;
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

function parsePaymentTag(tag: string[]): StreamPaymentMethod | null {
  if (tag[0] !== "payment") return null;
  const asset = normalizePaymentAsset(tag[1]);
  const address = (tag[2] ?? "").trim();
  if (!asset || !address) return null;
  const network = (tag[3] ?? "").trim() || undefined;
  const label = (tag[4] ?? "").trim() || undefined;
  return { asset, address, network, label };
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
  payments?: StreamPaymentMethod[];
  hostMode?: StreamHostMode;
  rebroadcastThreshold?: number;
  streamChatSlowModeSec?: number;
  streamChatSubscriberOnly?: boolean;
  streamChatFollowerOnly?: boolean;
  discoverable?: boolean;
  matureContent?: boolean;
  viewerAllowPubkeys?: string[];
  vodArchiveEnabled?: boolean;
  feeWaiverGuilds?: StreamGuildFeeWaiver[];
  feeWaiverVipPubkeys?: string[];
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

  const paymentCandidates: StreamPaymentMethod[] = [...(input.payments ?? [])];
  if (input.xmr) paymentCandidates.push({ asset: "xmr", address: input.xmr });
  const normalizedPayments = normalizePaymentMethods(paymentCandidates);
  const legacyXmr = normalizedPayments.find((method) => method.asset === "xmr")?.address;
  if (legacyXmr) tags.push(["xmr", legacyXmr]);
  for (const method of normalizedPayments) {
    tags.push(["payment", method.asset, method.address, method.network ?? "", method.label ?? ""]);
  }

  if (input.hostMode) tags.push(["host_mode", input.hostMode]);
  if (typeof input.rebroadcastThreshold === "number") {
    const normalized = parsePositiveInt(String(input.rebroadcastThreshold));
    if (normalized) tags.push(["rebroadcast_threshold", String(normalized)]);
  }
  if (typeof input.streamChatSlowModeSec === "number") {
    const normalized = parsePositiveInt(String(input.streamChatSlowModeSec));
    if (normalized) tags.push(["chat_slow", String(normalized)]);
  }
  if (typeof input.streamChatSubscriberOnly === "boolean") {
    tags.push(["chat_sub_only", input.streamChatSubscriberOnly ? "1" : "0"]);
  }
  if (typeof input.streamChatFollowerOnly === "boolean") {
    tags.push(["chat_follow_only", input.streamChatFollowerOnly ? "1" : "0"]);
  }
  if (typeof input.discoverable === "boolean") {
    tags.push(["discoverable", input.discoverable ? "1" : "0"]);
  }
  if (typeof input.matureContent === "boolean") {
    tags.push(["mature", input.matureContent ? "1" : "0"]);
  }

  const viewerAllowPubkeys = normalizeVipPubkeys(input.viewerAllowPubkeys ?? []);
  for (const viewerPubkey of viewerAllowPubkeys) {
    tags.push(["viewer_allow", viewerPubkey]);
  }
  if (typeof input.vodArchiveEnabled === "boolean") {
    tags.push(["vod_archive", input.vodArchiveEnabled ? "1" : "0"]);
  }

  const feeWaiverGuilds = normalizeGuildFeeWaivers(input.feeWaiverGuilds ?? []);
  for (const waiver of feeWaiverGuilds) {
    tags.push(["waive_guild", makeGuildATag(waiver.guildPubkey, waiver.guildId)]);
  }

  const feeWaiverVipPubkeys = normalizeVipPubkeys(input.feeWaiverVipPubkeys ?? []);
  for (const vipPubkey of feeWaiverVipPubkeys) {
    tags.push(["vip", vipPubkey]);
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
  const streamChatSlowModeSec = parsePositiveInt(getFirstTagValue(event.tags, "chat_slow"));
  const streamChatSubscriberOnly = parseBooleanFlag(getFirstTagValue(event.tags, "chat_sub_only"));
  const streamChatFollowerOnly = parseBooleanFlag(getFirstTagValue(event.tags, "chat_follow_only"));
  const discoverable = parseBooleanFlag(getFirstTagValue(event.tags, "discoverable")) ?? true;
  const matureContent = parseBooleanFlag(getFirstTagValue(event.tags, "mature")) ?? false;
  const viewerAllowPubkeys = normalizeVipPubkeys(getAllTagValues(event.tags, "viewer_allow"));
  const vodArchiveEnabled = parseBooleanFlag(getFirstTagValue(event.tags, "vod_archive"));
  const feeWaiverGuilds = (() => {
    const refs: StreamGuildFeeWaiver[] = [];
    for (const tag of event.tags) {
      if (tag[0] !== "waive_guild") continue;
      const parsed = parseGuildATag((tag[1] ?? "").trim());
      if (!parsed) continue;
      refs.push({ guildPubkey: parsed.guildPubkey, guildId: parsed.guildId });
    }
    return normalizeGuildFeeWaivers(refs);
  })();
  const feeWaiverVipPubkeys = normalizeVipPubkeys(getAllTagValues(event.tags, "vip"));

  const stakeAmountAtomicRaw = getFirstTagValue(event.tags, "stake");
  const stakeAmountAtomic = stakeAmountAtomicRaw && /^\d+$/.test(stakeAmountAtomicRaw) ? stakeAmountAtomicRaw : undefined;
  const captions = event.tags.map(parseCaptionTag).filter((value): value is StreamCaptionTrack => !!value);
  const renditions = event.tags.map(parseRenditionTag).filter((value): value is StreamRendition => !!value);
  const paymentTags = event.tags.map(parsePaymentTag).filter((value): value is StreamPaymentMethod => !!value);
  const legacyXmrRaw = getFirstTagValue(event.tags, "xmr");
  const legacyXmr = legacyXmrRaw ? normalizePaymentMethod({ asset: "xmr", address: legacyXmrRaw })?.address : undefined;
  const paymentCandidates: StreamPaymentMethod[] = [...paymentTags];
  if (legacyXmr) paymentCandidates.push({ asset: "xmr", address: legacyXmr });
  const payments = normalizePaymentMethods(paymentCandidates);
  const xmrPayment = payments.find((payment) => payment.asset === "xmr");

  return {
    pubkey: event.pubkey,
    streamId,
    title,
    status: statusRaw,
    summary: getFirstTagValue(event.tags, "summary"),
    image: getFirstTagValue(event.tags, "image"),
    streaming: getFirstTagValue(event.tags, "streaming"),
    xmr: xmrPayment?.address ?? legacyXmr ?? undefined,
    hostMode,
    rebroadcastThreshold,
    streamChatSlowModeSec,
    streamChatSubscriberOnly,
    streamChatFollowerOnly,
    discoverable,
    matureContent,
    viewerAllowPubkeys,
    vodArchiveEnabled,
    feeWaiverGuilds,
    feeWaiverVipPubkeys,
    manifestSignerPubkey,
    stakeAmountAtomic,
    stakeNote: getFirstTagValue(event.tags, "stake_note"),
    payments,
    captions,
    renditions,
    topics: sortTopicTags(getAllTagValues(event.tags, "t")),
    createdAt: event.created_at,
    raw: event
  };
}
