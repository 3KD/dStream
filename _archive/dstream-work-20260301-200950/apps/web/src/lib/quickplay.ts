import type { StreamRendition } from "@dstream/protocol";
import { makeOriginStreamId } from "@/lib/origin";

interface QuickPlaySourceInput {
  pubkey: string;
  streamId: string;
  streaming?: string;
  renditions?: StreamRendition[];
}

interface QuickPlayStateKeyInput {
  pubkey: string;
  streamId: string;
  hlsUrl?: string | null;
  viewerPubkey?: string | null;
}

function isPlaybackUrl(input: string | undefined | null): input is string {
  if (!input) return false;
  const value = input.trim();
  return /^https?:\/\//i.test(value) || value.startsWith("/");
}

function normalizeRenditions(input: StreamRendition[] | undefined): StreamRendition[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((rendition) => ({
      ...rendition,
      id: rendition.id.trim(),
      url: rendition.url.trim()
    }))
    .filter((rendition) => rendition.id.length > 0 && isPlaybackUrl(rendition.url))
    .slice(0, 8);
}

function fallbackHlsUrl(pubkey: string, streamId: string): string {
  const originStreamId = makeOriginStreamId(pubkey, streamId);
  const fallbackOrigin = `${pubkey.trim().toLowerCase()}--${streamId.trim()}`;
  return `/api/hls/${encodeURIComponent(originStreamId ?? fallbackOrigin)}/index.m3u8`;
}

export function deriveQuickPlayHlsUrl(input: QuickPlaySourceInput): string {
  const renditions = normalizeRenditions(input.renditions);
  if (renditions.length >= 2) {
    const params = new URLSearchParams();
    renditions.forEach((rendition, index) => {
      params.set(`id${index}`, rendition.id);
      params.set(`u${index}`, rendition.url);
      if (rendition.bandwidth) params.set(`bw${index}`, String(rendition.bandwidth));
      if (rendition.width) params.set(`w${index}`, String(rendition.width));
      if (rendition.height) params.set(`h${index}`, String(rendition.height));
      if (rendition.codecs) params.set(`c${index}`, rendition.codecs);
    });
    return `/api/hls-master?${params.toString()}`;
  }
  if (renditions[0]?.url) return renditions[0].url;
  if (isPlaybackUrl(input.streaming)) return input.streaming.trim();
  return fallbackHlsUrl(input.pubkey, input.streamId);
}

export function deriveQuickPlayWhepUrl(input: QuickPlaySourceInput, hlsUrl: string): string | undefined {
  if (!hlsUrl.startsWith("/api/hls/")) return undefined;
  const originStreamId = makeOriginStreamId(input.pubkey, input.streamId);
  if (!originStreamId) return undefined;
  return `/api/whep/${encodeURIComponent(originStreamId)}/whep`;
}

export function deriveQuickPlaySources(input: QuickPlaySourceInput) {
  const hlsUrl = deriveQuickPlayHlsUrl(input);
  const whepUrl = deriveQuickPlayWhepUrl(input, hlsUrl);
  return { hlsUrl, whepUrl };
}

export function deriveQuickPlayPlaybackStateKey(input: QuickPlayStateKeyInput): string {
  const pubkey = (input.pubkey ?? "").trim().toLowerCase();
  const streamId = (input.streamId ?? "").trim();
  const hlsUrl = (input.hlsUrl ?? "").trim();
  const vodIdentity = hlsUrl ? hlsUrl.split("?")[0] : "live";
  const viewer = (input.viewerPubkey ?? "").trim().toLowerCase();
  const viewerIdentity = /^[0-9a-f]{64}$/.test(viewer) ? viewer : "anon";
  return `quickplay:${viewerIdentity}:${pubkey}:${streamId}:${vodIdentity}`;
}
