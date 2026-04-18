import type { NostrEvent, StreamChatMessage } from "./types";
import { NOSTR_KINDS } from "./types";
import { assertStreamIdentity, getAllTagValues, makeATag } from "./nostr";

export interface BuildChatInput {
  pubkey: string;
  createdAt: number;
  streamPubkey: string;
  streamId: string;
  content: string;
}

export function buildStreamChatEvent(input: BuildChatInput): Omit<NostrEvent, "id" | "sig"> {
  assertStreamIdentity(input.pubkey, input.streamId);
  assertStreamIdentity(input.streamPubkey, input.streamId);

  return {
    kind: NOSTR_KINDS.STREAM_CHAT,
    pubkey: input.pubkey,
    created_at: input.createdAt,
    content: input.content,
    tags: [["a", makeATag(input.streamPubkey, input.streamId), "", "root"]]
  };
}

export function parseStreamChatEvent(
  event: NostrEvent,
  scope: { streamPubkey: string; streamId: string }
): StreamChatMessage | null {
  if (!event || event.kind !== NOSTR_KINDS.STREAM_CHAT) return null;

  try {
    assertStreamIdentity(scope.streamPubkey, scope.streamId);
  } catch {
    return null;
  }

  const expectedATag = makeATag(scope.streamPubkey, scope.streamId);
  const aTags = getAllTagValues(event.tags ?? [], "a");
  if (!aTags.includes(expectedATag)) return null;

  const emojis = event.tags
    .filter((t) => t[0] === "emoji" && t.length >= 3)
    .map((t) => ({ shortcode: t[1] as string, url: t[2] as string, hash: t[3] as string | undefined }));

  return {
    id: event.id,
    pubkey: event.pubkey,
    streamPubkey: scope.streamPubkey,
    streamId: scope.streamId,
    content: event.content ?? "",
    createdAt: event.created_at,
    emojis: emojis.length > 0 ? emojis : undefined,
    raw: event
  };
}

