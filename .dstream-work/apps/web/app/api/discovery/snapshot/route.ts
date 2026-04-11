import { NextResponse, type NextRequest } from "next/server";
import { SimplePool, type Filter } from "nostr-tools";
import { makeStreamKey, NOSTR_KINDS, parseDiscoveryModerationEvent, parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getDiscoveryOperatorPubkeys, getNostrRelays } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LOOKBACK_DAYS = 45;
const MIN_LOOKBACK_DAYS = 1;
const MAX_LOOKBACK_DAYS = 120;
const DEFAULT_LIMIT = 360;
const MIN_LIMIT = 40;
const MAX_LIMIT = 600;
const QUERY_TIMEOUT_MS = 20_000;
const DISCOVERY_POLICY_LOOKBACK_SEC = 14 * 86400;
const DISCOVERY_POLICY_LIMIT = 2000;

// ---------------------------------------------------------------------------
// Background cache: relay queries run in the background on a 60s interval.
// The GET handler returns whatever is cached — never blocks on relay I/O.
// ---------------------------------------------------------------------------
const REFRESH_INTERVAL_MS = 60_000;

interface CachedSnapshot {
  streams: StreamAnnounce[];
  queriedAt: number;
  relays: string[];
}

let cached: CachedSnapshot | null = null;
let refreshInFlight = false;

/** Read cache without TS narrowing (module-level var changes between awaits). */
function getCached(): CachedSnapshot | null { return cached; }

/** Query all relays and rebuild the cached snapshot. */
async function refreshCache(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;

  const relays = getNostrRelays();
  if (relays.length === 0) {
    cached = { streams: [], queriedAt: Math.floor(Date.now() / 1000), relays: [] };
    refreshInFlight = false;
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const sinceSec = nowSec - DEFAULT_LOOKBACK_DAYS * 86400;
  const operatorPubkeys = getDiscoveryOperatorPubkeys();

  const streamFilter: Filter = {
    kinds: [NOSTR_KINDS.STREAM_ANNOUNCE],
    since: sinceSec,
    limit: Math.max(DEFAULT_LIMIT * 2, 200)
  };
  const policyFilter: Filter | null =
    operatorPubkeys.length > 0
      ? {
          kinds: [NOSTR_KINDS.APP_DISCOVERY_MOD],
          authors: operatorPubkeys,
          since: Math.max(sinceSec, nowSec - DISCOVERY_POLICY_LOOKBACK_SEC),
          limit: DISCOVERY_POLICY_LIMIT
        }
      : null;

  const pool = new SimplePool();
  try {
    const perRelayResults = await Promise.allSettled(
      relays.map(async (relay) => {
        const streamEvents = await pool.querySync([relay], streamFilter, {
          maxWait: QUERY_TIMEOUT_MS
        });
        if (!policyFilter) return streamEvents;
        const policyEvents = await pool.querySync([relay], policyFilter, {
          maxWait: QUERY_TIMEOUT_MS
        });
        return [...streamEvents, ...policyEvents];
      })
    );

    const allEvents = perRelayResults.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    );
    const hiddenPubkeys = new Map<string, { hidden: boolean; createdAt: number }>();
    const hiddenStreams = new Map<string, { hidden: boolean; createdAt: number }>();
    const byStreamKey = new Map<string, StreamAnnounce>();

    for (const event of allEvents) {
      if (event?.kind === NOSTR_KINDS.APP_DISCOVERY_MOD) {
        const parsed = parseDiscoveryModerationEvent(event);
        if (!parsed) continue;
        if (parsed.targetType === "pubkey") {
          const key = parsed.targetPubkey.toLowerCase();
          const prev = hiddenPubkeys.get(key);
          if (!prev || parsed.createdAt >= prev.createdAt) {
            hiddenPubkeys.set(key, { hidden: parsed.action === "hide", createdAt: parsed.createdAt });
          }
          continue;
        }
        const key = makeStreamKey(parsed.targetPubkey.toLowerCase(), parsed.targetStreamId ?? "");
        const prev = hiddenStreams.get(key);
        if (!prev || parsed.createdAt >= prev.createdAt) {
          hiddenStreams.set(key, { hidden: parsed.action === "hide", createdAt: parsed.createdAt });
        }
        continue;
      }

      const parsedStream = parseStreamAnnounceEvent(event);
      if (!parsedStream) continue;
      const streamKey = makeStreamKey(parsedStream.pubkey.toLowerCase(), parsedStream.streamId);
      const prev = byStreamKey.get(streamKey);
      if (!prev || parsedStream.createdAt >= prev.createdAt) {
        byStreamKey.set(streamKey, parsedStream);
      }
    }

    const streams = Array.from(byStreamKey.values())
      .filter((stream) => {
        if (!stream.discoverable) return false;
        
        // Final sanity check for playable stream validity
        if (!stream.streaming) return false;
        const pubkeyPolicy = hiddenPubkeys.get(stream.pubkey.toLowerCase());
        if (pubkeyPolicy?.hidden) return false;
        const streamPolicy = hiddenStreams.get(makeStreamKey(stream.pubkey.toLowerCase(), stream.streamId));
        if (streamPolicy?.hidden) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, DEFAULT_LIMIT);

    cached = { streams, queriedAt: nowSec, relays };
  } catch (error: unknown) {
    // Keep stale cache on error — better than nothing.
    console.error("[snapshot] refresh failed:", error);
  } finally {
    try { pool.close(relays); } catch { /* no-op */ }
    refreshInFlight = false;
  }
}

// Kick off the first refresh immediately on module load, then repeat.
refreshCache();
setInterval(() => { refreshCache(); }, REFRESH_INTERVAL_MS);

// ---------------------------------------------------------------------------
// GET handler — always returns instantly from cache.
// ---------------------------------------------------------------------------
function parseBoundedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const value = Math.floor(parsed);
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const limit = parseBoundedInt(url.searchParams.get("limit"), DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);

  // If cache is populated, return immediately.
  let snap = getCached();
  if (snap) {
    return NextResponse.json({
      streams: snap.streams.slice(0, limit),
      queriedAt: snap.queriedAt,
      relays: snap.relays
    });
  }

  // Cache not ready yet (first request came before initial refresh finished).
  // Wait up to 25s for it, polling every 500ms.
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    snap = getCached();
    if (snap) break;
  }

  if (snap) {
    return NextResponse.json({
      streams: snap.streams.slice(0, limit),
      queriedAt: snap.queriedAt,
      relays: snap.relays
    });
  }

  // Still nothing — return empty.
  return NextResponse.json({
    streams: [] as StreamAnnounce[],
    queriedAt: Math.floor(Date.now() / 1000),
    relays: getNostrRelays()
  });
}
