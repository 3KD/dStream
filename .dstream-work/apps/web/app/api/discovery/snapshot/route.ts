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
const QUERY_TIMEOUT_MS = 6_500;
const DISCOVERY_POLICY_LOOKBACK_SEC = 14 * 86400;
const DISCOVERY_POLICY_LIMIT = 2000;

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
  const relays = getNostrRelays();
  if (relays.length === 0) {
    return NextResponse.json({
      streams: [] as StreamAnnounce[],
      queriedAt: Math.floor(Date.now() / 1000),
      relays: [] as string[]
    });
  }

  const url = new URL(req.url);
  const lookbackDays = parseBoundedInt(url.searchParams.get("days"), DEFAULT_LOOKBACK_DAYS, MIN_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS);
  const limit = parseBoundedInt(url.searchParams.get("limit"), DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
  const nowSec = Math.floor(Date.now() / 1000);
  const sinceSec = nowSec - lookbackDays * 86400;
  const operatorPubkeys = getDiscoveryOperatorPubkeys();

  const streamFilter: Filter = {
    kinds: [NOSTR_KINDS.STREAM_ANNOUNCE],
    since: sinceSec,
    limit: Math.max(limit * 2, 200)
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

    const allEvents = perRelayResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
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
        const pubkeyPolicy = hiddenPubkeys.get(stream.pubkey.toLowerCase());
        if (pubkeyPolicy?.hidden) return false;
        const streamPolicy = hiddenStreams.get(makeStreamKey(stream.pubkey.toLowerCase(), stream.streamId));
        if (streamPolicy?.hidden) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);

    return NextResponse.json({
      streams,
      queriedAt: nowSec,
      relays
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        streams: [] as StreamAnnounce[],
        relays,
        queriedAt: nowSec,
        error: error?.message ?? "discovery snapshot failed"
      },
      { status: 502 }
    );
  } finally {
    try {
      pool.close(relays);
    } catch {
      // no-op
    }
  }
}
