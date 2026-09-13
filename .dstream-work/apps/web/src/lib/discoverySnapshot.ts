import { makeStreamKey, type StreamAnnounce } from "@dstream/protocol";

export const DISCOVERY_SNAPSHOT_REFRESH_AFTER_SEC = 60;
export const DISCOVERY_SNAPSHOT_AUTHORITY_MAX_AGE_SEC = 120;

const MAX_FUTURE_CLOCK_SKEW_SEC = 30;

export function normalizeDiscoverySnapshotQueriedAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const queriedAt = Math.floor(value);
  return queriedAt > 0 ? queriedAt : 0;
}

export function shouldRefreshDiscoverySnapshot(queriedAt: number, nowSec: number): boolean {
  if (!Number.isFinite(nowSec)) return true;
  const normalizedQueriedAt = normalizeDiscoverySnapshotQueriedAt(queriedAt);
  if (!normalizedQueriedAt) return true;
  const ageSec = Math.floor(nowSec) - normalizedQueriedAt;
  return ageSec >= DISCOVERY_SNAPSHOT_REFRESH_AFTER_SEC || ageSec < -MAX_FUTURE_CLOCK_SKEW_SEC;
}

export function isDiscoverySnapshotAuthoritative(queriedAt: number, nowSec: number): boolean {
  if (!Number.isFinite(nowSec)) return false;
  const normalizedQueriedAt = normalizeDiscoverySnapshotQueriedAt(queriedAt);
  if (!normalizedQueriedAt) return false;
  const ageSec = Math.floor(nowSec) - normalizedQueriedAt;
  return ageSec >= -MAX_FUTURE_CLOCK_SKEW_SEC && ageSec <= DISCOVERY_SNAPSHOT_AUTHORITY_MAX_AGE_SEC;
}

export function buildDiscoverySnapshotLiveKeys(streams: StreamAnnounce[]): Set<string> {
  const liveKeys = new Set<string>();
  for (const stream of streams) {
    if (stream?.status !== "live" || typeof stream.pubkey !== "string" || typeof stream.streamId !== "string") {
      continue;
    }
    liveKeys.add(makeStreamKey(stream.pubkey, stream.streamId));
  }
  return liveKeys;
}

export function reconcileStreamWithDiscoverySnapshot(
  stream: StreamAnnounce,
  liveKeys: ReadonlySet<string>,
  queriedAt: number,
  nowSec: number
): StreamAnnounce {
  if (!isDiscoverySnapshotAuthoritative(queriedAt, nowSec)) return stream;

  const snapshotSaysLive = liveKeys.has(makeStreamKey(stream.pubkey, stream.streamId));
  if (snapshotSaysLive) {
    return stream.status === "live" ? stream : { ...stream, status: "live" };
  }

  // A snapshot cannot disprove an event that did not exist when its relay query began.
  if (stream.status === "live" && stream.createdAt <= queriedAt) {
    return { ...stream, status: "ended" };
  }
  return stream;
}
