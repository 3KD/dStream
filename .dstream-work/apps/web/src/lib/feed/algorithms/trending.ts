/**
 * Trending feed algorithm.
 *
 * Ranks by current viewer count. Live streams with more viewers
 * appear first. Simple, transparent, no personalization.
 */

import { makeStreamKey, type StreamAnnounce } from "@dstream/protocol";
import type { FeedAlgorithm, FeedContext } from "../types";

export const trendingAlgorithm: FeedAlgorithm = {
  id: "trending",
  name: "Trending",
  description: "Streams ranked by current viewer count. Most-watched first.",

  rank(streams: StreamAnnounce[], context: FeedContext): StreamAnnounce[] {
    const { presence } = context;

    return streams.slice().sort((a, b) => {
      // Live streams first.
      const aLive = a.status === "live";
      const bLive = b.status === "live";
      if (aLive !== bLive) return aLive ? -1 : 1;

      // Primary: viewer count (higher = better).
      const keyA = makeStreamKey(a.pubkey, a.streamId);
      const keyB = makeStreamKey(b.pubkey, b.streamId);
      const viewersA = presence.get(keyA)?.viewerCount ?? 0;
      const viewersB = presence.get(keyB)?.viewerCount ?? 0;
      if (viewersA !== viewersB) return viewersB - viewersA;

      // Tiebreaker: newer first.
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;

      return keyA.localeCompare(keyB);
    });
  },
};
