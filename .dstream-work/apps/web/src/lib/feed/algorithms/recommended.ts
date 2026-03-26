/**
 * Recommended (personalized) feed algorithm.
 *
 * Combines public Nostr signals with private on-device watch history.
 * All scoring weights are user-tunable via the feed weights config.
 * All computation is local — no data leaves the device.
 */

import { makeStreamKey, type StreamAnnounce } from "@dstream/protocol";
import type { FeedAlgorithm, FeedContext } from "../types";
import { loadWeights, type FeedWeights } from "../weights";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function topicMatchScore(
  streamTopics: string[],
  topicWeights: Map<string, number>,
  w: FeedWeights
): number {
  if (streamTopics.length === 0 || topicWeights.size === 0) return 0;
  let score = 0;
  for (const topic of streamTopics) {
    const weight = topicWeights.get(topic.toLowerCase());
    if (weight) score += w.topicMatch * Math.min(weight, 5);
  }
  return Math.min(score, w.topicMax);
}

function recencyScore(createdAt: number, now: number, max: number): number {
  const ageSec = Math.max(0, now - createdAt);
  if (ageSec < 60) return max;
  if (ageSec < 300) return max * 0.8;
  if (ageSec < 900) return max * 0.5;
  if (ageSec < 3600) return max * 0.2;
  return 0;
}

function viewerScore(viewerCount: number, base: number, max: number): number {
  if (viewerCount <= 0) return 0;
  return Math.min(base * Math.log2(viewerCount + 1) * 5, max);
}

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------

export const recommendedAlgorithm: FeedAlgorithm = {
  id: "recommended",
  name: "For You",
  description: "Personalized feed based on your favorites, watch history, and social graph. Weights are tunable in Settings. Private — never leaves your device.",

  rank(streams: StreamAnnounce[], context: FeedContext): StreamAnnounce[] {
    const { now, social, presence, watchHistory, guildMemberships } = context;
    const w = loadWeights();

    // Build topic weights from watch history.
    const topicWeights = new Map<string, number>();
    for (const entry of watchHistory) {
      const weight = Math.min(entry.durationSec / 60, 10);
      for (const topic of entry.topics) {
        topicWeights.set(topic.toLowerCase(), (topicWeights.get(topic.toLowerCase()) ?? 0) + weight);
      }
    }

    // Build recently-watched set (last 2 hours).
    const recentlyWatched = new Set<string>();
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const entry of watchHistory) {
      if (entry.watchedAt > twoHoursAgo) {
        recentlyWatched.add(entry.streamKey);
      }
    }

    // Score each stream.
    const scored = streams.map((stream) => {
      const key = makeStreamKey(stream.pubkey, stream.streamId);
      let score = 0;

      if (stream.status === "live") score += w.live;

      if (social.isFavoriteStream(stream.pubkey, stream.streamId)) score += w.favoriteStream;
      if (social.isFavoriteCreator(stream.pubkey)) score += w.favoriteCreator;
      else if (social.isTrusted(stream.pubkey)) score += w.trustedCreator;

      score += topicMatchScore(stream.topics, topicWeights, w);

      const viewers = presence.get(key)?.viewerCount ?? 0;
      score += viewerScore(viewers, w.viewerBase, w.viewerMax);

      score += recencyScore(stream.createdAt, now, w.recencyMax);

      for (const topic of stream.topics) {
        if (guildMemberships.has(topic.toLowerCase())) {
          score += w.guild;
          break;
        }
      }

      if (recentlyWatched.has(key)) score += w.rewatched;

      if (social.isBlocked(stream.pubkey) || social.isMuted(stream.pubkey)) {
        score = -Infinity;
      }

      return { stream, score };
    });

    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return b.stream.createdAt - a.stream.createdAt;
    });

    return scored.map((s) => s.stream);
  },
};
