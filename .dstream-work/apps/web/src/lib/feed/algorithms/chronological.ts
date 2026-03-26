/**
 * Chronological feed algorithm.
 *
 * Replicates the existing default behavior:
 * live streams first, then by discovery order, then by creation time.
 */

import { makeStreamKey, type StreamAnnounce } from "@dstream/protocol";
import type { FeedAlgorithm, FeedContext } from "../types";

export const chronologicalAlgorithm: FeedAlgorithm = {
  id: "chronological",
  name: "Latest",
  description: "Streams ordered by discovery time. Live streams first.",

  rank(streams: StreamAnnounce[], context: FeedContext): StreamAnnounce[] {
    const { orderMeta } = context;

    return streams.slice().sort((a, b) => {
      // Live streams first.
      const aLive = a.status === "live";
      const bLive = b.status === "live";
      if (aLive !== bLive) return aLive ? -1 : 1;

      // Primary: insertion order (keeps cards stable as relay data arrives).
      const keyA = makeStreamKey(a.pubkey, a.streamId);
      const keyB = makeStreamKey(b.pubkey, b.streamId);
      const seqA = orderMeta.get(keyA)?.seq ?? Number.MAX_SAFE_INTEGER;
      const seqB = orderMeta.get(keyB)?.seq ?? Number.MAX_SAFE_INTEGER;
      if (seqA !== seqB) return seqA - seqB;

      // Fallback: newest first.
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;

      return keyA.localeCompare(keyB);
    });
  },
};
