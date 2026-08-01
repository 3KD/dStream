import { M3U8Parser } from "hls.js";

const ROTATING_PROVIDER_ROOTS = ["zap.stream", "letsfo.com"] as const;

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
  details?: unknown;
  loadError?: number;
  fragmentError?: number;
};

type MutableAudioTrack = {
  url: string;
  groupId?: string;
  name?: string;
  lang?: string;
  details?: unknown;
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
    level.details = undefined;
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
    track.details = undefined;
    audioTracksChanged += 1;
  });

  return {
    changed: levelsChanged > 0 || audioTracksChanged > 0,
    levelsChanged,
    audioTracksChanged
  };
}
