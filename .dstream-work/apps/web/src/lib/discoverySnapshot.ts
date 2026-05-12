import { makeStreamKey, type StreamAnnounce } from "@dstream/protocol";
import { isLikelyLivePlayableMediaUrl } from "./mediaUrl";

export interface DiscoveryHiddenPolicy {
  hidden: boolean;
  createdAt: number;
}

export function streamSnapshotKey(stream: StreamAnnounce): string {
  return makeStreamKey(stream.pubkey.toLowerCase(), stream.streamId);
}

export function shouldIncludeSnapshotStream(
  stream: StreamAnnounce,
  hiddenPubkeys: Map<string, DiscoveryHiddenPolicy> = new Map(),
  hiddenStreams: Map<string, DiscoveryHiddenPolicy> = new Map()
): boolean {
  if (!stream.discoverable) return false;

  const pubkeyPolicy = hiddenPubkeys.get(stream.pubkey.toLowerCase());
  if (pubkeyPolicy?.hidden) return false;

  const streamPolicy = hiddenStreams.get(streamSnapshotKey(stream));
  if (streamPolicy?.hidden) return false;

  return true;
}

export function normalizeSnapshotStreamAvailability(
  stream: StreamAnnounce,
  isDefinitelyDeadLive = false
): StreamAnnounce {
  if (stream.status !== "live") return stream;
  if (!isLikelyLivePlayableMediaUrl(stream.streaming)) return { ...stream, status: "ended" };
  if (isDefinitelyDeadLive) return { ...stream, status: "ended" };
  return stream;
}

export function normalizeSnapshotStreamList(
  streams: StreamAnnounce[],
  definitelyDeadLiveKeys: Set<string> = new Set()
): StreamAnnounce[] {
  return streams.map((stream) =>
    normalizeSnapshotStreamAvailability(stream, definitelyDeadLiveKeys.has(streamSnapshotKey(stream)))
  );
}
