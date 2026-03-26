/**
 * Feed algorithm registry.
 *
 * Ships with 3 built-in algorithms. Extensible for custom algorithms.
 */

import type { FeedAlgorithm } from "./types";
import { chronologicalAlgorithm } from "./algorithms/chronological";
import { trendingAlgorithm } from "./algorithms/trending";
import { recommendedAlgorithm } from "./algorithms/recommended";

const BUILTIN_ALGORITHMS: FeedAlgorithm[] = [
  chronologicalAlgorithm,
  trendingAlgorithm,
  recommendedAlgorithm,
];

const algorithmMap = new Map<string, FeedAlgorithm>();
for (const algo of BUILTIN_ALGORITHMS) {
  algorithmMap.set(algo.id, algo);
}

export function getAlgorithm(id: string): FeedAlgorithm {
  return algorithmMap.get(id) ?? chronologicalAlgorithm;
}

export function listAlgorithms(): FeedAlgorithm[] {
  return [...algorithmMap.values()];
}

export const DEFAULT_ALGORITHM_ID = "chronological";

export const ALGORITHM_STORAGE_KEY = "dstream_feed_algorithm_v1";

export function getSavedAlgorithmId(): string {
  if (typeof window === "undefined") return DEFAULT_ALGORITHM_ID;
  try {
    return localStorage.getItem(ALGORITHM_STORAGE_KEY) || DEFAULT_ALGORITHM_ID;
  } catch {
    return DEFAULT_ALGORITHM_ID;
  }
}

export function saveAlgorithmId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ALGORITHM_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}
