import type { NostrEvent, StreamPresence } from "./types";
import { NOSTR_KINDS } from "./types";
import { assertStreamIdentity, getAllTagValues, makeATag } from "./nostr";

export interface BuildPresenceInput {
  pubkey: string;
  createdAt: number;
  streamPubkey: string;
  streamId: string;
}

export function buildStreamPresenceEvent(input: BuildPresenceInput): Omit<NostrEvent, "id" | "sig"> {
  assertStreamIdentity(input.pubkey, input.streamId);
  assertStreamIdentity(input.streamPubkey, input.streamId);

  return {
    kind: NOSTR_KINDS.PRESENCE,
    pubkey: input.pubkey,
    created_at: input.createdAt,
    content: "",
    tags: [["a", makeATag(input.streamPubkey, input.streamId)]]
  };
}

export function parseStreamPresenceEvent(
  event: NostrEvent,
  scope: { streamPubkey: string; streamId: string }
): StreamPresence | null {
  if (!event || event.kind !== NOSTR_KINDS.PRESENCE) return null;

  try {
    assertStreamIdentity(scope.streamPubkey, scope.streamId);
  } catch {
    return null;
  }

  const expectedATag = makeATag(scope.streamPubkey, scope.streamId);
  const aTags = getAllTagValues(event.tags ?? [], "a");
  if (!aTags.includes(expectedATag)) return null;

  return {
    id: event.id,
    pubkey: event.pubkey,
    streamPubkey: scope.streamPubkey,
    streamId: scope.streamId,
    createdAt: event.created_at,
    raw: event
  };
}

