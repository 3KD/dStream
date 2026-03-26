/**
 * Pluggable feed algorithm framework.
 *
 * Each algorithm takes a list of streams + a context of signals
 * (social graph, presence, watch history) and returns a ranked list.
 * All computation happens client-side — nothing leaves the device.
 */

import type { StreamAnnounce } from "@dstream/protocol";

// ---------------------------------------------------------------------------
// Watch history (private, on-device only)
// ---------------------------------------------------------------------------

export interface WatchHistoryEntry {
  /** Canonical stream key: "pubkey:streamId" */
  streamKey: string;
  /** Broadcaster pubkey */
  pubkey: string;
  /** When the user started watching (epoch ms) */
  watchedAt: number;
  /** How long they watched (seconds) */
  durationSec: number;
  /** Topics from the stream's announce event */
  topics: string[];
}

// ---------------------------------------------------------------------------
// Feed context (assembled before ranking)
// ---------------------------------------------------------------------------

export interface FeedSocialSignals {
  isTrusted: (pubkey: string) => boolean;
  isBlocked: (pubkey: string) => boolean;
  isMuted: (pubkey: string) => boolean;
  isFavoriteCreator: (pubkey: string) => boolean;
  isFavoriteStream: (pubkey: string, streamId: string) => boolean;
}

export interface FeedPresenceInfo {
  viewerCount: number;
}

export interface FeedContext {
  /** Current time (epoch seconds) */
  now: number;
  /** User's social signals */
  social: FeedSocialSignals;
  /** Viewer counts by stream key ("pubkey:streamId") */
  presence: Map<string, FeedPresenceInfo>;
  /** User's private watch history (most recent first) */
  watchHistory: WatchHistoryEntry[];
  /** Guild IDs the user is a member of */
  guildMemberships: Set<string>;
  /** Stream insertion order from the directory (lower = seen earlier) */
  orderMeta: Map<string, { firstSeenAt: number; seq: number }>;
}

// ---------------------------------------------------------------------------
// Feed algorithm interface
// ---------------------------------------------------------------------------

export interface FeedAlgorithm {
  /** Unique identifier (e.g. "chronological", "trending", "recommended") */
  id: string;
  /** Display name */
  name: string;
  /** Short description shown in the feed selector UI */
  description: string;
  /** Take streams + context, return ranked list. Must not mutate inputs. */
  rank(streams: StreamAnnounce[], context: FeedContext): StreamAnnounce[];
}
