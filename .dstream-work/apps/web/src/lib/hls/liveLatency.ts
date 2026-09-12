export type BufferedTimeRange = {
  start: number;
  end: number;
};

export function getLiveLatencyRecoveryLimit(targetLatency: number, targetDuration: number): number | null {
  if (!Number.isFinite(targetLatency) || targetLatency < 0) return null;
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) return null;
  return targetLatency + Math.max(2, targetDuration);
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
