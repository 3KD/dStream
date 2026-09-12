export type BufferedTimeRange = {
  start: number;
  end: number;
};

export function getLiveLatencyRecoveryLimit(targetLatency: number, targetDuration: number): number | null {
  if (!Number.isFinite(targetLatency) || targetLatency < 0) return null;
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) return null;
  return targetLatency + Math.max(6, targetDuration * 3);
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

export function findBufferedLiveStartupTarget(
  ranges: readonly BufferedTimeRange[],
  liveSyncPosition: number | null | undefined,
  minimumBufferAhead = 0.5
): number | null {
  if (!Number.isFinite(minimumBufferAhead) || minimumBufferAhead < 0) return null;

  let latestRange: BufferedTimeRange | null = null;
  for (const range of ranges) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) continue;
    if (!latestRange || range.end > latestRange.end) latestRange = range;
  }
  if (!latestRange) return null;

  const duration = latestRange.end - latestRange.start;
  const safeEnd = latestRange.end - Math.min(minimumBufferAhead, duration / 2);
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
