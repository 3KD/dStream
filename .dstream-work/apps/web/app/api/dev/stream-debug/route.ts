import { NextResponse } from "next/server";
import { SimplePool, type Filter } from "nostr-tools";
import { makeStreamKey, NOSTR_KINDS, parseStreamAnnounceEvent, type StreamAnnounce } from "@dstream/protocol";
import { getNostrRelays } from "@/lib/config";
import { isLikelyLivePlayableMediaUrl, isLikelyPublicPlayableMediaUrl } from "@/lib/mediaUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN_STREAM_ID_PATTERN = /^[0-9a-f]{64}--(.+)$/i;
const TRANSCODE_VARIANT_PATTERN = /__r\d+p$/i;
const LIVE_STALE_SEC = 6 * 60 * 60;
const LIVE_HINT_GRACE_SEC = 45 * 24 * 60 * 60;

function normalizeStreamId(streamId: string): string {
  const value = streamId.trim();
  if (!value) return value;
  const match = value.match(ORIGIN_STREAM_ID_PATTERN);
  return (match?.[1]?.trim() || value).replace(TRANSCODE_VARIANT_PATTERN, "").toLowerCase();
}

function streamIdFromStreamingUrl(streaming: string): string {
  const raw = streaming.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const si = parts.findIndex((p) => p.toLowerCase() === "stream");
    if (si >= 0 && si + 1 < parts.length) return normalizeStreamId(parts[si + 1] ?? "");
    if (parts.length >= 2 && (parts[parts.length - 1] ?? "").toLowerCase() === "index.m3u8")
      return normalizeStreamId(parts[parts.length - 2] ?? "");
  } catch {}
  return "";
}

function canonicalStreamKey(stream: StreamAnnounce): string {
  const idFromTag = normalizeStreamId(stream.streamId);
  const idFromUrl = streamIdFromStreamingUrl(stream.streaming ?? "");
  if (idFromTag && idFromUrl) return idFromTag.length <= idFromUrl.length ? idFromTag : idFromUrl;
  return idFromTag || idFromUrl || makeStreamKey(stream.pubkey, stream.streamId).toLowerCase();
}

export async function GET(): Promise<Response> {
  const relays = getNostrRelays();
  const nowSec = Math.floor(Date.now() / 1000);
  const sinceSec = nowSec - 45 * 86400;

  const pool = new SimplePool();
  try {
    const filter: Filter = { kinds: [NOSTR_KINDS.STREAM_ANNOUNCE], since: sinceSec, limit: 720 };
    const perRelay = await Promise.allSettled(
      relays.map(async (relay) => {
        const events = await pool.querySync([relay], filter, { maxWait: 8000 });
        return { relay, count: events.length, events };
      })
    );

    const relayStats = perRelay.map((r, i) =>
      r.status === "fulfilled"
        ? { relay: relays[i], events: r.value.count }
        : { relay: relays[i], error: (r as any).reason?.message ?? "failed" }
    );

    const allEvents = perRelay.flatMap((r) => (r.status === "fulfilled" ? r.value.events : []));

    // Step 1: parse + dedup by streamKey (like updateStreamAnnounce)
    const byStreamKey = new Map<string, StreamAnnounce>();
    for (const event of allEvents) {
      const parsed = parseStreamAnnounceEvent(event);
      if (!parsed) continue;
      const sk = makeStreamKey(parsed.pubkey, parsed.streamId);
      const prev = byStreamKey.get(sk);
      if (!prev || parsed.createdAt >= prev.createdAt) byStreamKey.set(sk, parsed);
    }

    // Step 2: normalize stale status
    const staleCutoff = nowSec - LIVE_STALE_SEC;
    const hintGraceCutoff = nowSec - LIVE_HINT_GRACE_SEC;
    for (const [sk, s] of byStreamKey) {
      if (s.status === "live") {
        if (s.createdAt < staleCutoff) {
          const hasUrl = isLikelyLivePlayableMediaUrl(s.streaming);
          if (!hasUrl || s.createdAt < hintGraceCutoff) {
            byStreamKey.set(sk, { ...s, status: "ended" });
          }
        }
      }
    }

    const allParsed = Array.from(byStreamKey.values());
    const liveAll = allParsed.filter((s) => s.status === "live");
    const liveWithUrl = liveAll.filter((s) => isLikelyLivePlayableMediaUrl(s.streaming));
    const livePublic = liveWithUrl.filter((s) => isLikelyPublicPlayableMediaUrl(s.streaming));

    // Step 3: canonical dedup pass 1
    const byCanonical = new Map<string, StreamAnnounce>();
    for (const s of allParsed) {
      const ck = `${s.pubkey.toLowerCase()}::${canonicalStreamKey(s)}`;
      const existing = byCanonical.get(ck);
      if (!existing) { byCanonical.set(ck, s); continue; }
      // prefer live, then newer
      if (s.status === "live" && existing.status !== "live") byCanonical.set(ck, s);
      else if (s.createdAt > existing.createdAt) byCanonical.set(ck, s);
    }
    const afterPass1 = Array.from(byCanonical.values());
    const liveAfterPass1 = afterPass1.filter((s) => s.status === "live" && isLikelyLivePlayableMediaUrl(s.streaming));

    // Step 4: title dedup pass 2
    const byTitle = new Map<string, StreamAnnounce>();
    for (const s of afterPass1) {
      const title = (s.title || "").trim().toLowerCase();
      if (!title) { byTitle.set(`${s.pubkey}::notitle::${s.streamId}`, s); continue; }
      const tk = `${s.pubkey.toLowerCase()}::title::${title}`;
      const existing = byTitle.get(tk);
      if (!existing) { byTitle.set(tk, s); continue; }
      if (s.status === "live" && existing.status !== "live") byTitle.set(tk, s);
      else if (s.createdAt > existing.createdAt) byTitle.set(tk, s);
    }
    const afterPass2 = Array.from(byTitle.values());
    const liveAfterPass2 = afterPass2.filter((s) => s.status === "live" && isLikelyLivePlayableMediaUrl(s.streaming));

    // Step 5: apply homepage filters (discoverable, !mature, !restricted)
    const homepageFiltered = liveAfterPass2.filter((s) => {
      if (!s.discoverable) return false;
      if (s.matureContent) return false;
      if (s.viewerAllowPubkeys.length > 0) return false;
      return true;
    });

    // Step 6: isLikelyPublicPlayableMediaUrl (page.tsx filter)
    const pageFiltered = homepageFiltered.filter((s) => isLikelyPublicPlayableMediaUrl(s.streaming));

    return NextResponse.json({
      relayStats,
      pipeline: {
        rawEvents: allEvents.length,
        uniqueStreamKeys: byStreamKey.size,
        allParsed: allParsed.length,
        liveAll: liveAll.length,
        liveWithPlayableUrl: liveWithUrl.length,
        liveWithPublicUrl: livePublic.length,
        afterCanonicalDedup: afterPass1.length,
        liveAfterCanonicalDedup: liveAfterPass1.length,
        afterTitleDedup: afterPass2.length,
        liveAfterTitleDedup: liveAfterPass2.length,
        homepageFiltered: homepageFiltered.length,
        pageFiltered: pageFiltered.length,
      },
      liveStreams: pageFiltered.map((s) => ({
        title: s.title?.slice(0, 50),
        canonicalKey: canonicalStreamKey(s),
        pubkey: s.pubkey.slice(0, 8) + "...",
        streaming: (s.streaming ?? "").slice(0, 80),
      })),
    });
  } finally {
    try { pool.close(relays); } catch {}
  }
}
