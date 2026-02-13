import type { Guild, GuildFeaturedStreamRef, NostrEvent } from "./types";
import { NOSTR_KINDS } from "./types";
import { assertStreamIdentity, getAllTagValues, getFirstTagValue, makeATag, makeStreamKey, parseStreamATag, sortTopicTags } from "./nostr";
import { isHex64, requireNonEmpty } from "./validate";

export interface BuildGuildInput {
  pubkey: string;
  createdAt: number;
  guildId: string;
  name: string;
  about?: string;
  image?: string;
  topics?: string[];
  featuredStreams?: GuildFeaturedStreamRef[];
}

export function buildGuildEvent(input: BuildGuildInput): Omit<NostrEvent, "id" | "sig"> {
  if (!isHex64(input.pubkey)) throw new Error("pubkey must be 64-hex");

  const guildId = requireNonEmpty(input.guildId, "guildId");
  const name = requireNonEmpty(input.name, "name");

  const tags: string[][] = [
    ["d", guildId],
    ["name", name]
  ];

  if (input.about) tags.push(["about", input.about]);
  if (input.image) tags.push(["image", input.image]);

  for (const topic of sortTopicTags(input.topics ?? [])) {
    tags.push(["t", topic]);
  }

  for (const ref of input.featuredStreams ?? []) {
    assertStreamIdentity(ref.streamPubkey, ref.streamId);
    tags.push(["a", makeATag(ref.streamPubkey, ref.streamId)]);
  }

  return {
    kind: NOSTR_KINDS.GUILD,
    pubkey: input.pubkey.toLowerCase(),
    created_at: input.createdAt,
    tags,
    content: ""
  };
}

export function parseGuildEvent(event: NostrEvent): Guild | null {
  if (!event || event.kind !== NOSTR_KINDS.GUILD) return null;
  if (!event.pubkey || !event.tags) return null;

  const pubkey = typeof event.pubkey === "string" ? event.pubkey.toLowerCase() : "";
  if (!isHex64(pubkey)) return null;

  const guildId = getFirstTagValue(event.tags, "d")?.trim() ?? "";
  if (!guildId) return null;

  const name = (getFirstTagValue(event.tags, "name") ?? guildId).trim();
  if (!name) return null;

  const about = getFirstTagValue(event.tags, "about")?.trim();
  const image = getFirstTagValue(event.tags, "image")?.trim();
  const topics = sortTopicTags(getAllTagValues(event.tags, "t"));

  const featuredStreams = (() => {
    const refs: GuildFeaturedStreamRef[] = [];
    for (const a of getAllTagValues(event.tags, "a")) {
      const parsed = parseStreamATag(a);
      if (!parsed) continue;
      refs.push({ streamPubkey: parsed.streamPubkey, streamId: parsed.streamId });
    }
    const map = new Map<string, GuildFeaturedStreamRef>();
    for (const ref of refs) map.set(makeStreamKey(ref.streamPubkey, ref.streamId), ref);
    return Array.from(map.values());
  })();

  return {
    pubkey,
    guildId,
    name,
    about: about || undefined,
    image: image || undefined,
    topics,
    featuredStreams,
    createdAt: event.created_at,
    raw: event
  };
}

