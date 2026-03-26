/**
 * Recommended (personalized) feed algorithm.
 *
 * Combines public Nostr signals with private on-device watch history
 * to produce a personalized feed. All computation is local —
 * no data leaves the device.
 *
 * Scoring factors:
 * - Social affinity (trusted/favorited creators)
 * - Topic match (overlap with watch history topics)
 * - Viewer momentum (current viewer count)
 * - Recency (newer streams boosted, decays over time)
 * - Guild boost (streams from user's guilds)
 * - Negative signals (blocked/muted filtered out)
 */

import { makeStreamKey, type StreamAnnounce } from "@dstream/protocol";
import type { FeedAlgorithm, FeedContext } from "../types";

// ---------------------------------------------------------------------------
// Score weights (tunable)
// ---------------------------------------------------------------------------

const W_LIVE = 100;           // Live status bonus
const W_FAVORITE_CREATOR = 40; // Favorited creator
const W_TRUSTED_CREATOR = 20;  // Trusted (but not favorited) creator
const W_FAVORITE_STREAM = 50;  // Favorited specific stream
const W_TOPIC_MATCH = 8;       // Per matching topic (scaled by watch history weight)
const W_TOPIC_MAX = 40;        // Cap on total topic score
const W_VIEWER_BASE = 0.5;     // Per viewer (logarithmic)
const W_VIEWER_MAX = 25;       // Cap on viewer score
const W_RECENCY_MAX = 15;      // Max recency bonus (for brand new streams)
const W_GUILD = 10;            // Stream from a guild the user belongs to
const W_REWATCHED = -10;       // Penalty for recently watched (avoid repetition)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function topicMatchScore(
  streamTopics: string[],
  topicWeights: Map<string, number>
): number {
  if (streamTopics.length === 0 || topicWeights.size === 0) return 0;
  let score = 0;
  for (const topic of streamTopics) {
    const weight = topicWeights.get(topic.toLowerCase());
    if (weight) score += W_TOPIC_MATCH * Math.min(weight, 5);
  }
  return Math.min(score, W_TOPIC_MAX);
}

function recencyScore(createdAt: number, now: number): number {
  const ageSec = Math.max(0, now - createdAt);
  if (ageSec < 60) return W_RECENCY_MAX;
  if (ageSec < 300) return W_RECENCY_MAX * 0.8;
  if (ageSec < 900) return W_RECENCY_MAX * 0.5;
  if (ageSec < 3600) return W_RECENCY_MAX * 0.2;
  return 0;
}

function viewerScore(viewerCount: number): number {
  if (viewerCount <= 0) return 0;
  // Logarithmic: diminishing returns at higher counts.
  return Math.min(W_VIEWER_BASE * Math.log2(viewerCount + 1) * 5, W_VIEWER_MAX);
}

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------

export const recommendedAlgorithm: FeedAlgorithm = {
  id: "recommended",
  name: "For You",
  description: "Personalized feed based on your favorites, watch history, and social graph. Private — never leaves your device.",

  rank(streams: StreamAnnounce[], context: FeedContext): StreamAnnounce[] {
    const { now, social, presence, watchHistory, guildMemberships } = context;

    // Build topic weights from watch history.
    const topicWeights = new Map<string, number>();
    for (const entry of watchHistory) {
      const weight = Math.min(entry.durationSec / 60, 10);
      for (const topic of entry.topics) {
        topicWeights.set(topic.toLowerCase(), (topicWeights.get(topic.toLowerCase()) ?? 0) + weight);
      }
    }

    // Build recently-watched set (last 2 hours) to penalize repetition.
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

      // Live status.
      if (stream.status === "live") score += W_LIVE;

      // Social affinity.
      if (social.isFavoriteStream(stream.pubkey, stream.streamId)) score += W_FAVORITE_STREAM;
      if (social.isFavoriteCreator(stream.pubkey)) score += W_FAVORITE_CREATOR;
      else if (social.isTrusted(stream.pubkey)) score += W_TRUSTED_CREATOR;

      // Topic match.
      score += topicMatchScore(stream.topics, topicWeights);

      // Viewer momentum.
      const viewers = presence.get(key)?.viewerCount ?? 0;
      score += viewerScore(viewers);

      // Recency.
      score += recencyScore(stream.createdAt, now);

      // Guild boost.
      // Check if any of the stream's topics match a guild the user belongs to.
      for (const topic of stream.topics) {
        if (guildMemberships.has(topic.toLowerCase())) {
          score += W_GUILD;
          break;
        }
      }

      // Recently watched penalty (avoid showing the same stream again).
      if (recentlyWatched.has(key)) score += W_REWATCHED;

      // Blocked/muted filter (hard negative).
      if (social.isBlocked(stream.pubkey) || social.isMuted(stream.pubkey)) {
        score = -Infinity;
      }

      return { stream, score };
    });

    // Sort by score descending, then by createdAt as tiebreaker.
    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return b.stream.createdAt - a.stream.createdAt;
    });

    return scored.map((s) => s.stream);
  },
};
