import { M3U8Parser } from "hls.js";

const ROTATING_PROVIDER_ROOTS = ["zap.stream", "letsfo.com", "streamroad.money"] as const;

export type RotatingMasterLevel = {
  url: string;
  bitrate: number;
  width: number;
  height: number;
  name: string;
};

export type RotatingMasterAudioTrack = {
  url: string;
  groupId: string;
  name: string;
  lang: string;
};

export type RotatingMasterSnapshot = {
  levels: RotatingMasterLevel[];
  audioTracks: RotatingMasterAudioTrack[];
};

type MutableLevel = {
  readonly url: string[];
  bitrate?: number;
  width?: number;
  height?: number;
  name?: string;
  loadError?: number;
  fragmentError?: number;
};

type MutableAudioTrack = {
  url: string;
  groupId?: string;
  name?: string;
  lang?: string;
};

export type RotatingMasterTarget = {
  levels: readonly MutableLevel[];
  audioTracks: readonly MutableAudioTrack[];
};

export type RotatingMasterUpdate = {
  changed: boolean;
  levelsChanged: number;
  audioTracksChanged: number;
};

type MasterPlaylistParser = Pick<typeof M3U8Parser, "parseMasterPlaylist" | "parseMasterPlaylistMedia">;

function hasProviderRoot(hostname: string, root: string): boolean {
  return hostname === root || hostname.endsWith(`.${root}`);
}

export function isZapStreamHlsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) && hasProviderRoot(parsed.hostname.toLowerCase(), "zap.stream");
  } catch {
    return false;
  }
}

export function isRotatingHlsProviderUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const hostname = parsed.hostname.toLowerCase();
    return ROTATING_PROVIDER_ROOTS.some((root) => hasProviderRoot(hostname, root));
  } catch {
    return false;
  }
}

export function resolveHlsStartupBufferTarget(options: {
  defaultTargetSeconds: number;
  rotatingProvider: boolean;
  thirdParty: boolean;
  classicExternal: boolean;
  backgroundPlayback: boolean;
  targetDurationSeconds: number | null;
}): number {
  const defaultTarget = Math.max(0, options.defaultTargetSeconds);
  const targetDuration =
    options.targetDurationSeconds !== null && Number.isFinite(options.targetDurationSeconds)
      ? Math.max(0, options.targetDurationSeconds)
      : null;
  if (options.rotatingProvider) {
    const foregroundReserve = Math.min(8, Math.max(6, targetDuration === null ? 6 : targetDuration * 3));
    return Math.max(defaultTarget, options.backgroundPlayback ? Math.min(8, foregroundReserve + 2) : foregroundReserve);
  }
  if (!options.thirdParty) return defaultTarget;
  if (options.classicExternal) {
    const foregroundReserve = Math.min(10, Math.max(8, targetDuration === null ? 8 : targetDuration * 2));
    return Math.max(defaultTarget, options.backgroundPlayback ? Math.min(12, foregroundReserve + 2) : foregroundReserve);
  }

  const foregroundReserve = Math.min(6, Math.max(3, targetDuration ?? 4));
  return Math.max(defaultTarget, options.backgroundPlayback ? Math.min(8, foregroundReserve + 2) : foregroundReserve);
}

export function selectBufferedLiveStartupPosition(options: {
  currentTime: number;
  rangeStart: number;
  rangeEnd: number;
  targetBufferSeconds: number;
}): number | null {
  const { currentTime, rangeStart, rangeEnd, targetBufferSeconds } = options;
  if (![currentTime, rangeStart, rangeEnd, targetBufferSeconds].every(Number.isFinite)) return null;
  const duration = rangeEnd - rangeStart;
  if (duration <= 0.25 || targetBufferSeconds <= 0) return null;

  const currentIsBuffered = currentTime >= rangeStart - 0.05 && currentTime <= rangeEnd + 0.05;
  const currentBufferAhead = currentIsBuffered ? Math.max(0, rangeEnd - currentTime) : 0;
  if (currentBufferAhead >= targetBufferSeconds) return null;

  const earliestPlayable = rangeStart + Math.min(0.1, duration / 4);
  return Math.max(earliestPlayable, rangeEnd - targetBufferSeconds);
}

export function selectRotatingStartupLevel(levels: readonly { bitrate?: number }[]): number {
  if (levels.length === 0) return -1;
  return levels.reduce((lowest, level, index) => {
    const lowestBitrate = levels[lowest]?.bitrate;
    const bitrate = level.bitrate;
    if (!Number.isFinite(bitrate)) return lowest;
    if (!Number.isFinite(lowestBitrate)) return index;
    return (bitrate ?? Number.POSITIVE_INFINITY) < (lowestBitrate ?? Number.POSITIVE_INFINITY) ? index : lowest;
  }, 0);
}

export function shouldFallbackToAudioForMissingVideoFragment(options: {
  fatal: boolean;
  details: string;
  status: number | null;
  fragmentType: string | null;
}): boolean {
  return (
    !options.fatal &&
    options.details === "fragLoadError" &&
    options.status === 404 &&
    options.fragmentType === "main"
  );
}

export function shouldRefreshRotatingMasterOnHlsError(options: {
  fatal: boolean;
  details: string;
}): boolean {
  if (options.fatal) return true;
  return ["levelLoadError", "audioTrackLoadError", "fragLoadError"].includes(options.details);
}

export type HlsPlaybackCompatibilityPolicy = {
  stableMode: boolean;
  bridgeLiveGaps: boolean;
  lowLatencyEnabled: boolean;
  preferCompleteSegments: boolean;
  completeSegmentLiveSyncCount: number | null;
  liveSyncDurationSeconds: number | null;
};

export function resolveHlsPlaybackCompatibilityPolicy(options: {
  sourceUrl: string;
  isFirefox: boolean;
  lowLatencyEnabled: boolean;
}): HlsPlaybackCompatibilityPolicy {
  const provider = (() => {
    try {
      const hostname = new URL(options.sourceUrl).hostname.toLowerCase();
      if (hasProviderRoot(hostname, "streamroad.money")) return "streamroad";
      if (hasProviderRoot(hostname, "zap.stream") || hasProviderRoot(hostname, "letsfo.com")) return "rotating";
    } catch {
      // Fall through to a generic source.
    }
    return "generic";
  })();
  const rotatingProvider = provider === "rotating";
  const stableMode = options.isFirefox;
  const preferCompleteSegments = provider === "streamroad" || rotatingProvider;
  return {
    stableMode,
    bridgeLiveGaps: stableMode,
    lowLatencyEnabled: options.lowLatencyEnabled && !stableMode && !preferCompleteSegments,
    preferCompleteSegments,
    completeSegmentLiveSyncCount: preferCompleteSegments ? 3 : null,
    liveSyncDurationSeconds: null
  };
}

export function parseRotatingMasterPlaylist(
  playlist: string,
  baseUrl: string,
  parser: MasterPlaylistParser = M3U8Parser
): RotatingMasterSnapshot | null {
  try {
    const parsed = parser.parseMasterPlaylist(playlist, baseUrl);
    if (parsed.playlistParsingError || parsed.levels.length === 0) return null;
    const media = parser.parseMasterPlaylistMedia(playlist, baseUrl, parsed);
    return {
      levels: parsed.levels.map((level) => ({
        url: level.url,
        bitrate: level.bitrate || 0,
        width: level.width || 0,
        height: level.height || 0,
        name: level.name || ""
      })),
      audioTracks: (media.AUDIO ?? []).map((track) => ({
        url: track.url,
        groupId: track.groupId || "",
        name: track.name || "",
        lang: track.lang || ""
      }))
    };
  } catch {
    return null;
  }
}

function findLevelMatch(
  current: MutableLevel,
  index: number,
  candidates: readonly RotatingMasterLevel[],
  used: Set<number>
): { candidate: RotatingMasterLevel; index: number } | null {
  const available = candidates
    .map((candidate, candidateIndex) => ({ candidate, index: candidateIndex }))
    .filter((entry) => !used.has(entry.index));
  const width = current.width || 0;
  const height = current.height || 0;
  const name = current.name || "";

  const exactResolution = available.find(
    (entry) => width > 0 && height > 0 && entry.candidate.width === width && entry.candidate.height === height
  );
  if (exactResolution) return exactResolution;

  const exactHeight = available.find((entry) => height > 0 && entry.candidate.height === height);
  if (exactHeight) return exactHeight;

  const exactName = available.find((entry) => name && entry.candidate.name === name);
  if (exactName) return exactName;

  const sameIndex = available.find((entry) => entry.index === index);
  return sameIndex ?? null;
}

function findAudioTrackMatch(
  current: MutableAudioTrack,
  index: number,
  candidates: readonly RotatingMasterAudioTrack[],
  used: Set<number>
): { candidate: RotatingMasterAudioTrack; index: number } | null {
  const available = candidates
    .map((candidate, candidateIndex) => ({ candidate, index: candidateIndex }))
    .filter((entry) => !used.has(entry.index));
  const groupId = current.groupId || "";
  const name = current.name || "";
  const lang = current.lang || "";

  const exact = available.find(
    (entry) =>
      (!groupId || entry.candidate.groupId === groupId) &&
      (!name || entry.candidate.name === name) &&
      (!lang || entry.candidate.lang === lang)
  );
  if (exact) return exact;

  const sameGroup = available.find((entry) => groupId && entry.candidate.groupId === groupId);
  if (sameGroup) return sameGroup;

  const sameIndex = available.find((entry) => entry.index === index);
  return sameIndex ?? null;
}

export function applyRotatingMasterSnapshot(
  target: RotatingMasterTarget,
  snapshot: RotatingMasterSnapshot
): RotatingMasterUpdate {
  let levelsChanged = 0;
  let audioTracksChanged = 0;
  const usedLevels = new Set<number>();
  const usedAudioTracks = new Set<number>();

  target.levels.forEach((level, index) => {
    const match = findLevelMatch(level, index, snapshot.levels, usedLevels);
    if (!match) return;
    usedLevels.add(match.index);
    if (level.url[0] === match.candidate.url) return;
    level.url.splice(0, level.url.length, match.candidate.url);
    level.loadError = 0;
    level.fragmentError = 0;
    levelsChanged += 1;
  });

  target.audioTracks.forEach((track, index) => {
    const match = findAudioTrackMatch(track, index, snapshot.audioTracks, usedAudioTracks);
    if (!match) return;
    usedAudioTracks.add(match.index);
    if (track.url === match.candidate.url) return;
    track.url = match.candidate.url;
    audioTracksChanged += 1;
  });

  return {
    changed: levelsChanged > 0 || audioTracksChanged > 0,
    levelsChanged,
    audioTracksChanged
  };
}
