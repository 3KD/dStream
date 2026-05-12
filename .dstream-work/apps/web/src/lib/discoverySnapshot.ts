import { makeStreamKey, type StreamAnnounce } from "@dstream/protocol";
import { isLikelyLivePlayableMediaUrl, isLikelyPublicPlaybackUrl } from "./mediaUrl";

export interface DiscoveryHiddenPolicy {
  hidden: boolean;
  createdAt: number;
}

export type SnapshotPlaybackHealth = "unchecked" | "unavailable";

export interface SnapshotPlaybackHealthFields {
  playbackHealth?: SnapshotPlaybackHealth;
  playbackHealthReason?: string;
  playbackHealthCheckedAt?: number;
}

export type SnapshotStreamAnnounce = StreamAnnounce & SnapshotPlaybackHealthFields;

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
  isDefinitelyDeadLive = false,
  isVerifiedLivePlayback = false
): SnapshotStreamAnnounce {
  if (stream.status === "ended" && isVerifiedLivePlayback) {
    return { ...stream, status: "live" };
  }
  if (stream.status !== "live") return stream;
  if (!isLikelyPublicPlaybackUrl(stream.streaming)) return { ...stream, status: "ended" };
  if (isDefinitelyDeadLive) {
    return {
      ...stream,
      playbackHealth: "unavailable",
      playbackHealthReason: "playback_probe_failed",
      playbackHealthCheckedAt: Math.floor(Date.now() / 1000)
    };
  }
  return stream;
}

export function normalizeSnapshotStreamList(
  streams: StreamAnnounce[],
  definitelyDeadLiveKeys: Set<string> = new Set(),
  verifiedLivePlaybackKeys: Set<string> = new Set()
): SnapshotStreamAnnounce[] {
  return streams.map((stream) =>
    normalizeSnapshotStreamAvailability(
      stream,
      definitelyDeadLiveKeys.has(streamSnapshotKey(stream)),
      verifiedLivePlaybackKeys.has(streamSnapshotKey(stream))
    )
  );
}

export function sortSnapshotStreamsForResponse(streams: StreamAnnounce[]): StreamAnnounce[] {
  return streams.slice().sort((a, b) => {
    const aLive = a.status === "live";
    const bLive = b.status === "live";
    if (aLive !== bLive) return aLive ? -1 : 1;
    const aPotentialLive = isLikelyLivePlayableMediaUrl(a.streaming);
    const bPotentialLive = isLikelyLivePlayableMediaUrl(b.streaming);
    if (aPotentialLive !== bPotentialLive) return aPotentialLive ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}
