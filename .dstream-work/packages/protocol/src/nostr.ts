import type { NostrEvent, NostrTag } from "./types";
import { NOSTR_KINDS } from "./types";
import { isHex64, uniqStrings } from "./validate";

export function makeStreamKey(pubkey: string, streamId: string): string {
  return `${pubkey}:${streamId}`;
}

export function makeGuildKey(pubkey: string, guildId: string): string {
  return `${pubkey}:${guildId}`;
}

export function makeATag(pubkey: string, streamId: string): string {
  return `${NOSTR_KINDS.STREAM_ANNOUNCE}:${pubkey}:${streamId}`;
}

export function makeGuildATag(pubkey: string, guildId: string): string {
  return `${NOSTR_KINDS.GUILD}:${pubkey}:${guildId}`;
}

export function parseStreamATag(aTag: string): { streamPubkey: string; streamId: string } | null {
  // Expected: "30311:<pubkeyHex>:<d>", but allow ":" inside <d> by splitting on the first 2 colons only.
  const first = aTag.indexOf(":");
  if (first < 0) return null;
  const second = aTag.indexOf(":", first + 1);
  if (second < 0) return null;

  const kindStr = aTag.slice(0, first);
  if (kindStr !== String(NOSTR_KINDS.STREAM_ANNOUNCE)) return null;

  const streamPubkey = aTag.slice(first + 1, second);
  const streamId = aTag.slice(second + 1);
  if (!isHex64(streamPubkey)) return null;
  if (!streamId) return null;
  return { streamPubkey: streamPubkey.toLowerCase(), streamId };
}

export function parseGuildATag(aTag: string): { guildPubkey: string; guildId: string } | null {
  // Expected: "30315:<pubkeyHex>:<d>", but allow ":" inside <d> by splitting on the first 2 colons only.
  const first = aTag.indexOf(":");
  if (first < 0) return null;
  const second = aTag.indexOf(":", first + 1);
  if (second < 0) return null;

  const kindStr = aTag.slice(0, first);
  if (kindStr !== String(NOSTR_KINDS.GUILD)) return null;

  const guildPubkey = aTag.slice(first + 1, second);
  const guildId = aTag.slice(second + 1);
  if (!isHex64(guildPubkey)) return null;
  if (!guildId) return null;
  return { guildPubkey: guildPubkey.toLowerCase(), guildId };
}

export function getFirstTagValue(tags: NostrTag[], key: string): string | undefined {
  return tags.find((t) => t[0] === key)?.[1];
}

export function getAllTagValues(tags: NostrTag[], key: string): string[] {
  return tags.filter((t) => t[0] === key).map((t) => t[1]).filter(Boolean);
}

export function normalizeRelayUrl(url: string): string {
  return url.trim();
}

export function isValidStreamId(streamId: string): boolean {
  return typeof streamId === "string" && streamId.trim().length > 0;
}

export function assertStreamIdentity(pubkey: string, streamId: string): void {
  if (!isHex64(pubkey)) throw new Error("pubkey must be 64-hex");
  if (!isValidStreamId(streamId)) throw new Error("streamId must be non-empty");
}

export function sortTopicTags(tags: string[]): string[] {
  return uniqStrings(tags).sort((a, b) => a.localeCompare(b));
}
