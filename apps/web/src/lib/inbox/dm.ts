export type DmDirection = "in" | "out";

export type NostrDmEvent = {
  id?: string;
  kind?: number;
  pubkey?: string;
  created_at?: number;
  tags?: string[][];
  content?: string;
};

export type DmMessage = {
  id: string;
  peerPubkey: string;
  senderPubkey: string;
  recipientPubkey: string;
  createdAt: number;
  direction: DmDirection;
  content: string;
};

export type DmThreadReadState = Record<string, number>;

export type DmThreadSummary = {
  peerPubkey: string;
  lastMessageAt: number;
  lastMessageId: string;
  lastMessagePreview: string;
  messageCount: number;
  unreadCount: number;
};

function normalizeMaybeHexPubkey(input: string | null | undefined): string {
  const raw = (input ?? "").trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) return raw.toLowerCase();
  return raw;
}

export function getFirstTagValue(tags: string[][] | null | undefined, tagName: string): string | null {
  if (!tags || tags.length === 0) return null;
  for (const tag of tags) {
    if (!Array.isArray(tag)) continue;
    if ((tag[0] ?? "") !== tagName) continue;
    const value = typeof tag[1] === "string" ? tag[1].trim() : "";
    if (value) return value;
  }
  return null;
}

export function getDmRecipientPubkey(event: Pick<NostrDmEvent, "tags">): string | null {
  const p = getFirstTagValue(event.tags, "p");
  if (!p) return null;
  return normalizeMaybeHexPubkey(p) || null;
}

export function getDmPeerPubkey(event: Pick<NostrDmEvent, "pubkey" | "tags">, selfPubkey: string): string | null {
  const self = normalizeMaybeHexPubkey(selfPubkey);
  if (!self) return null;
  const author = normalizeMaybeHexPubkey(event.pubkey);
  const recipient = getDmRecipientPubkey(event);
  if (!author || !recipient) return null;

  if (author === self) return recipient;
  if (recipient === self) return author;
  return null;
}

export function getDmDirection(event: Pick<NostrDmEvent, "pubkey" | "tags">, selfPubkey: string): DmDirection | null {
  const self = normalizeMaybeHexPubkey(selfPubkey);
  if (!self) return null;
  const peer = getDmPeerPubkey(event, self);
  if (!peer) return null;
  const author = normalizeMaybeHexPubkey(event.pubkey);
  return author === self ? "out" : "in";
}

export function buildDmThreadSummaries(messages: DmMessage[], readState: DmThreadReadState): DmThreadSummary[] {
  const byPeer = new Map<string, DmMessage[]>();
  for (const msg of messages) {
    const pk = normalizeMaybeHexPubkey(msg.peerPubkey);
    if (!pk) continue;
    const list = byPeer.get(pk);
    if (list) list.push(msg);
    else byPeer.set(pk, [msg]);
  }

  const threads: DmThreadSummary[] = [];
  for (const [peerPubkey, list] of byPeer.entries()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
    const last = list[list.length - 1];
    if (!last) continue;
    const lastReadAt = readState[peerPubkey] ?? 0;
    const unreadCount = list.filter((m) => m.direction === "in" && m.createdAt > lastReadAt).length;

    threads.push({
      peerPubkey,
      lastMessageAt: last.createdAt,
      lastMessageId: last.id,
      lastMessagePreview: last.content,
      messageCount: list.length,
      unreadCount
    });
  }

  threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  return threads;
}

