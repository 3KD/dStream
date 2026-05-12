import { NextResponse, type NextRequest } from "next/server";
import { SimplePool, type Filter } from "nostr-tools";
import { makeStreamKey, NOSTR_KINDS, parseDiscoveryModerationEvent, parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getDiscoveryOperatorPubkeys, getNostrRelays } from "@/lib/config";
import { normalizeSnapshotStreamList, shouldIncludeSnapshotStream, sortSnapshotStreamsForResponse, streamSnapshotKey } from "@/lib/discoverySnapshot";
import { isLikelyHlsUrl, isLikelyLivePlayableMediaUrl } from "@/lib/mediaUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_LIMIT = 600;
const MIN_LIMIT = 40;
const MAX_LIMIT = 1000;
const QUERY_TIMEOUT_MS = 6_000;
const DISCOVERY_POLICY_LOOKBACK_SEC = 14 * 86400;
const DISCOVERY_POLICY_LIMIT = 2000;
const STREAM_PROBE_LIMIT = 80;
const STREAM_PROBE_CONCURRENCY = 10;
const STREAM_PROBE_TIMEOUT_MS = 1_500;
const STREAM_PROBE_CACHE_MS = 5 * 60_000;
const ENDED_PLAYBACK_PROMOTION_LOOKBACK_DAYS = 45;

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
interface StreamProbeResult {
  playable: boolean;
  liveLike: boolean;
}

interface ProbeFetchResult {
  state: "playable" | "dead" | "unknown";
  liveLike: boolean;
}

const streamProbeCache = new Map<string, { checkedAtMs: number; result: StreamProbeResult }>();

/** Read cache without TS narrowing (module-level var changes between awaits). */
function getCached(): CachedSnapshot | null { return cached; }

function shouldProbeStream(stream: StreamAnnounce): boolean {
  if (stream.status !== "live" && stream.status !== "ended") return false;
  const url = stream.streaming?.trim();
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return isLikelyLivePlayableMediaUrl(url);
}

function isDefinitelyDeadStatus(status: number): boolean {
  return status === 404 || status === 410;
}

function normalizeProbeUrl(url: string): string {
  return url.trim();
}

function isLiveLikeHlsManifest(body: string): boolean {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith("#EXTM3U")) return false;
  if (/#EXT-X-ENDLIST\b/i.test(body)) return false;
  return /#EXT-X-(MEDIA-SEQUENCE|TARGETDURATION|STREAM-INF)\b/i.test(body) || /#EXTINF\b/i.test(body);
}

async function probeFetchStatus(url: string, method: "HEAD" | "GET"): Promise<ProbeFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STREAM_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: method === "GET" ? { Range: "bytes=0-2047" } : undefined
    });
    if (isDefinitelyDeadStatus(response.status)) return { state: "dead", liveLike: false };
    if (!(response.ok || response.status === 206)) return { state: "unknown", liveLike: false };
    if (method === "GET" && isLikelyHlsUrl(url)) {
      const body = await response.text();
      const trimmed = body.trimStart();
      if (!trimmed.startsWith("#EXTM3U")) return { state: "dead", liveLike: false };
      return { state: "playable", liveLike: isLiveLikeHlsManifest(body) };
    }
    return { state: "playable", liveLike: false };
  } catch (error: unknown) {
    if (error instanceof Error && error.name !== "AbortError") {
      console.warn("[snapshot] stream probe failed:", error.message);
    }
    return { state: "unknown", liveLike: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeStreamPlayback(url: string): Promise<StreamProbeResult> {
  const normalized = normalizeProbeUrl(url);
  const nowMs = Date.now();
  const cachedResult = streamProbeCache.get(normalized);
  if (cachedResult && nowMs - cachedResult.checkedAtMs < STREAM_PROBE_CACHE_MS) {
    return cachedResult.result;
  }

  const first = isLikelyHlsUrl(normalized) ? await probeFetchStatus(normalized, "GET") : await probeFetchStatus(normalized, "HEAD");
  const fallback = first.state === "unknown" ? await probeFetchStatus(normalized, "GET") : first;
  const result = {
    playable: fallback.state !== "dead",
    liveLike: fallback.liveLike
  };

  streamProbeCache.set(normalized, { checkedAtMs: nowMs, result });
  return result;
}

async function annotateDefinitelyDeadLiveStreams(streams: StreamAnnounce[]): Promise<StreamAnnounce[]> {
  const endedPromotionCutoff = Math.floor(Date.now() / 1000) - ENDED_PLAYBACK_PROMOTION_LOOKBACK_DAYS * 86400;
  const liveCandidates = streams.filter((stream) => stream.status === "live" && shouldProbeStream(stream));
  const endedCandidatesByUrl = new Map<string, StreamAnnounce>();

  for (const stream of streams) {
    if (stream.status !== "ended" || stream.createdAt < endedPromotionCutoff || !shouldProbeStream(stream)) continue;
    const url = normalizeProbeUrl(stream.streaming ?? "");
    const existing = endedCandidatesByUrl.get(url);
    if (!existing || stream.createdAt > existing.createdAt) {
      endedCandidatesByUrl.set(url, stream);
    }
  }

  const probeCandidates = [...liveCandidates, ...endedCandidatesByUrl.values()]
    .sort((a, b) => {
      const aLive = a.status === "live";
      const bLive = b.status === "live";
      if (aLive !== bLive) return aLive ? -1 : 1;
      return b.createdAt - a.createdAt;
    })
    .slice(0, STREAM_PROBE_LIMIT);
  if (probeCandidates.length === 0) return streams;

  const definitelyDeadLiveKeys = new Set<string>();
  const verifiedLivePlaybackKeys = new Set<string>();
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(STREAM_PROBE_CONCURRENCY, probeCandidates.length) }, async () => {
    while (nextIndex < probeCandidates.length) {
      const stream = probeCandidates[nextIndex++];
      if (!stream?.streaming) continue;
      const probe = await probeStreamPlayback(stream.streaming);
      if (stream.status === "live" && !probe.playable) {
        definitelyDeadLiveKeys.add(streamSnapshotKey(stream));
        continue;
      }
      if (stream.status === "ended" && probe.liveLike) {
        verifiedLivePlaybackKeys.add(streamSnapshotKey(stream));
      }
    }
  });
  await Promise.all(workers);

  return normalizeSnapshotStreamList(streams, definitelyDeadLiveKeys, verifiedLivePlaybackKeys);
}

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
    limit: Math.max(DEFAULT_LIMIT * 3, 1200)
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

    const publicStreams = normalizeSnapshotStreamList(
      Array.from(byStreamKey.values()).filter((stream) =>
        shouldIncludeSnapshotStream(stream, hiddenPubkeys, hiddenStreams)
      )
    );
    const streams = sortSnapshotStreamsForResponse(await annotateDefinitelyDeadLiveStreams(publicStreams))
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
