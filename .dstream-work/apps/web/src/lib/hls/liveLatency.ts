export type BufferedTimeRange = {
  start: number;
  end: number;
};

export function resolveAdaptiveLiveStartupBufferSeconds({
  backgroundPlayEnabled,
  variantCount,
  configuredLiveSyncDuration
}: {
  backgroundPlayEnabled: boolean;
  variantCount: number;
  configuredLiveSyncDuration: number;
}): number {
  if (backgroundPlayEnabled || variantCount > 1) return 8;
  return Number.isFinite(configuredLiveSyncDuration) && configuredLiveSyncDuration >= 12 ? 4 : 0.5;
}

export function findBufferedLiveSyncTarget(
  ranges: readonly BufferedTimeRange[],
  liveSyncPosition: number,
  endPadding = 0.1
): number | null {
  if (!Number.isFinite(liveSyncPosition) || !Number.isFinite(endPadding) || endPadding < 0) return null;

  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) continue;
    if (liveSyncPosition >= range.start && liveSyncPosition <= range.end - endPadding) return liveSyncPosition;
  }
  return null;
}

export function isBufferedLiveStartupRangeCurrent(
  range: BufferedTimeRange | null | undefined,
  liveSyncPosition: number | null | undefined,
  maxDistanceBehind = 2
): boolean {
  if (typeof liveSyncPosition !== "number" || !Number.isFinite(liveSyncPosition)) return true;
  if (
    !range ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.end <= range.start ||
    !Number.isFinite(maxDistanceBehind) ||
    maxDistanceBehind < 0
  ) {
    return false;
  }
  return range.end + maxDistanceBehind >= liveSyncPosition;
}

export function findBufferedLiveStartupTarget(
  ranges: readonly BufferedTimeRange[],
  liveSyncPosition: number | null | undefined,
  minimumBufferAhead = 0.5,
  preferredLatency?: number
): number | null {
  if (
    !Number.isFinite(minimumBufferAhead) ||
    minimumBufferAhead < 0 ||
    (preferredLatency !== undefined && (!Number.isFinite(preferredLatency) || preferredLatency < 0))
  ) return null;

  let latestRange: BufferedTimeRange | null = null;
  for (const range of ranges) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) continue;
    if (!latestRange || range.end > latestRange.end) latestRange = range;
  }
  if (!latestRange) return null;

  const duration = latestRange.end - latestRange.start;
  const boundaryPadding = Math.min(0.1, duration / 4);
  const earliestSafeStart = latestRange.start + boundaryPadding;
  const availableBufferAhead = Math.max(boundaryPadding, duration - boundaryPadding);
  const requiredBufferAhead = Math.min(minimumBufferAhead, availableBufferAhead);
  const safeEnd = latestRange.end - requiredBufferAhead;
  if (preferredLatency === undefined) {
    if (
      typeof liveSyncPosition === "number" &&
      Number.isFinite(liveSyncPosition) &&
      liveSyncPosition >= latestRange.start &&
      liveSyncPosition <= latestRange.end
    ) {
      return Math.min(liveSyncPosition, safeEnd);
    }
    return safeEnd;
  }

  const boundedLatency = Math.max(minimumBufferAhead, preferredLatency);
  const fallbackTarget = Math.min(safeEnd, Math.max(earliestSafeStart, latestRange.end - boundedLatency));
  const maximumAcceptedLag = boundedLatency + Math.max(1, minimumBufferAhead);
  if (
    typeof liveSyncPosition === "number" &&
    Number.isFinite(liveSyncPosition) &&
    liveSyncPosition >= latestRange.start &&
    liveSyncPosition <= safeEnd &&
    latestRange.end - liveSyncPosition <= maximumAcceptedLag
  ) {
    return liveSyncPosition;
  }

  return fallbackTarget;
}

export function hasRepeatedMediaGaps(
  timestamps: readonly number[],
  now: number,
  threshold = 2,
  windowMs = 30_000
): boolean {
  if (!Number.isFinite(now) || threshold < 1 || windowMs < 0) return false;
  return (
    timestamps.filter((timestamp) => Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= windowMs)
      .length >= threshold
  );
}
