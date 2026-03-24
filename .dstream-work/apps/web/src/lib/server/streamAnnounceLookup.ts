import { makeStreamKey, NOSTR_KINDS, parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { SimplePool, type Event, type Filter } from "nostr-tools";
import { getNostrRelays } from "@/lib/config";

const pool = new SimplePool();
const cache = new Map<string, { value: StreamAnnounce | null; expiresAt: number }>();

function nowMs(): number {
  return Date.now();
}

function sortLatest(first: StreamAnnounce | null, second: StreamAnnounce): StreamAnnounce {
  if (!first) return second;
  if (second.createdAt !== first.createdAt) return second.createdAt > first.createdAt ? second : first;
  return second.raw.id && !first.raw.id ? second : first;
}

export async function getLatestStreamAnnounce(
  streamPubkey: string,
  streamId: string,
  opts?: { cacheTtlMs?: number; maxWaitMs?: number }
): Promise<StreamAnnounce | null> {
  const key = makeStreamKey(streamPubkey, streamId);
  const ttlMs = opts?.cacheTtlMs ?? 15_000;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > nowMs()) return cached.value;

  const relays = getNostrRelays();
  if (relays.length === 0) return null;

  const filter: Filter = {
    kinds: [NOSTR_KINDS.STREAM_ANNOUNCE],
    authors: [streamPubkey],
    "#d": [streamId],
    limit: 50,
    since: Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60
  };

  let parsedLatest: StreamAnnounce | null = null;
  try {
    const events = (await pool.querySync(relays, filter, {
      maxWait: opts?.maxWaitMs ?? 2500
    })) as Event[];
    for (const event of events) {
      const parsed = parseStreamAnnounceEvent(event as any);
      if (!parsed) continue;
      if (parsed.pubkey !== streamPubkey || parsed.streamId !== streamId) continue;
      parsedLatest = sortLatest(parsedLatest, parsed);
    }
  } catch {
    parsedLatest = null;
  }

  cache.set(key, { value: parsedLatest, expiresAt: nowMs() + ttlMs });
  return parsedLatest;
}
