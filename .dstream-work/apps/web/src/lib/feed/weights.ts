/**
 * Feed algorithm weight configuration.
 *
 * Users can tune these to control how the "For You" algorithm ranks streams.
 * Saved to localStorage, exportable as JSON, importable from others.
 */

export interface FeedWeights {
  /** Bonus for live streams (default: 100) */
  live: number;
  /** Bonus for favorited creator (default: 40) */
  favoriteCreator: number;
  /** Bonus for trusted creator (default: 20) */
  trustedCreator: number;
  /** Bonus for favorited specific stream (default: 50) */
  favoriteStream: number;
  /** Per-topic match multiplier (default: 8) */
  topicMatch: number;
  /** Cap on total topic score (default: 40) */
  topicMax: number;
  /** Viewer count base multiplier (default: 0.5) */
  viewerBase: number;
  /** Cap on viewer score (default: 25) */
  viewerMax: number;
  /** Max recency bonus for new streams (default: 15) */
  recencyMax: number;
  /** Bonus for streams from user's guilds (default: 10) */
  guild: number;
  /** Penalty for recently watched streams (default: -10) */
  rewatched: number;
}

export const DEFAULT_WEIGHTS: FeedWeights = {
  live: 100,
  favoriteCreator: 40,
  trustedCreator: 20,
  favoriteStream: 50,
  topicMatch: 8,
  topicMax: 40,
  viewerBase: 0.5,
  viewerMax: 25,
  recencyMax: 15,
  guild: 10,
  rewatched: -10,
};

export const WEIGHT_LABELS: Record<keyof FeedWeights, { label: string; description: string; min: number; max: number; step: number }> = {
  live: { label: "Live bonus", description: "How much to boost live streams", min: 0, max: 200, step: 5 },
  favoriteCreator: { label: "Favorite creator", description: "Boost for creators you favorited", min: 0, max: 100, step: 5 },
  trustedCreator: { label: "Trusted creator", description: "Boost for creators you trust", min: 0, max: 100, step: 5 },
  favoriteStream: { label: "Favorite stream", description: "Boost for specific streams you favorited", min: 0, max: 100, step: 5 },
  topicMatch: { label: "Topic relevance", description: "Per-topic match from watch history", min: 0, max: 30, step: 1 },
  topicMax: { label: "Topic cap", description: "Max total topic score", min: 0, max: 100, step: 5 },
  viewerBase: { label: "Viewer weight", description: "How much viewer count matters", min: 0, max: 5, step: 0.1 },
  viewerMax: { label: "Viewer cap", description: "Max score from viewers", min: 0, max: 50, step: 5 },
  recencyMax: { label: "Recency boost", description: "Bonus for brand new streams", min: 0, max: 50, step: 5 },
  guild: { label: "Guild boost", description: "Bonus for streams from your guilds", min: 0, max: 50, step: 5 },
  rewatched: { label: "Rewatch penalty", description: "Penalty for recently watched (negative = penalize)", min: -50, max: 0, step: 5 },
};

const STORAGE_KEY = "dstream_feed_weights_v1";

export function loadWeights(): FeedWeights {
  if (typeof window === "undefined") return { ...DEFAULT_WEIGHTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WEIGHTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_WEIGHTS, ...sanitizeWeights(parsed) };
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

export function saveWeights(weights: FeedWeights): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(weights));
  } catch {
    // ignore
  }
}

export function exportWeights(weights: FeedWeights): string {
  return JSON.stringify({ v: 1, t: "dstream-feed-weights", weights }, null, 2);
}

export function importWeights(json: string): FeedWeights | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || parsed.t !== "dstream-feed-weights" || !parsed.weights) return null;
    return { ...DEFAULT_WEIGHTS, ...sanitizeWeights(parsed.weights) };
  } catch {
    return null;
  }
}

function sanitizeWeights(input: any): Partial<FeedWeights> {
  if (!input || typeof input !== "object") return {};
  const result: Partial<FeedWeights> = {};
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof FeedWeights)[]) {
    const val = input[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      const meta = WEIGHT_LABELS[key];
      result[key] = Math.max(meta.min, Math.min(meta.max, val));
    }
  }
  return result;
}
