export type MediaUrlKind = "hls" | "direct" | "unknown";

const DIRECT_MEDIA_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".mkv",
  ".ogv",
  ".ogg",
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".flac",
  ".opus"
] as const;

const HLS_PATH_MARKERS = ["/hls/", "/api/hls/", "/whep", "/whip", "/master.m3u8", "/manifest.m3u8"] as const;
const LIVE_PATH_MARKERS = ["/hls/live.m3u8", "/live.m3u8", "/whep", "/whip"] as const;
const LIVE_PATH_REGEXES = [/\/stream\/[^/]+\/index\.m3u8$/i, /\/api\/hls\/[^/]+\/index\.m3u8$/i, /\/hls\/[^/]+\/index\.m3u8$/i] as const;
const Video_PATH_MARKERS = ["/video/", "/replay/", "/replays/", "/archive/", "/recording/", "/recordings/", "/dvr/"] as const;
const Video_QUERY_MARKERS = ["video=1", "replay=1", "archive=1", "video=true", "replay=true", "archive=true"] as const;

function splitPathFromUrl(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (value.startsWith("/")) return value.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";

  try {
    const parsed = new URL(value);
    return parsed.pathname.toLowerCase();
  } catch {
    return value.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  }
}

function splitQueryFromUrl(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (value.startsWith("/")) {
    const query = value.split("?", 2)[1] ?? "";
    return query.toLowerCase();
  }

  try {
    const parsed = new URL(value);
    return parsed.search.toLowerCase();
  } catch {
    return "";
  }
}

export function isHttpLikeMediaUrl(input: string | null | undefined): input is string {
  if (!input) return false;
  const value = input.trim();
  return value.startsWith("/") || /^https?:\/\//i.test(value);
}

export function inferMediaUrlKind(input: string | null | undefined): MediaUrlKind {
  if (!isHttpLikeMediaUrl(input)) return "unknown";

  const path = splitPathFromUrl(input);
  const query = splitQueryFromUrl(input);
  if (!path) return "unknown";

  if (path.endsWith(".m3u8")) return "hls";
  if (HLS_PATH_MARKERS.some((marker) => path.includes(marker))) return "hls";
  if (query.includes("format=m3u8") || query.includes("ext=m3u8")) return "hls";
  if (DIRECT_MEDIA_EXTENSIONS.some((ext) => path.endsWith(ext))) return "direct";
  return "unknown";
}

export function isLikelyHlsUrl(input: string | null | undefined): boolean {
  return inferMediaUrlKind(input) === "hls";
}

export function isLikelyPlayableMediaUrl(input: string | null | undefined): boolean {
  return inferMediaUrlKind(input) !== "unknown";
}

export function isLikelyLivePlaybackUrl(input: string | null | undefined): boolean {
  if (!isHttpLikeMediaUrl(input)) return false;
  const path = splitPathFromUrl(input);
  if (!path) return false;
  if (LIVE_PATH_MARKERS.some((marker) => path.includes(marker))) return true;
  if (LIVE_PATH_REGEXES.some((pattern) => pattern.test(path))) return true;
  return /\/live(\.|\/|$)/i.test(path);
}

export function isLikelyVideoPlaybackUrl(input: string | null | undefined): boolean {
  if (!isHttpLikeMediaUrl(input)) return false;
  const path = splitPathFromUrl(input);
  if (!path) return false;
  const hasDirectExtension = DIRECT_MEDIA_EXTENSIONS.some((ext) => path.endsWith(ext));
  if (Video_PATH_MARKERS.some((marker) => path.includes(marker))) return true;
  if (path.includes("/api/video/")) return true;

  const query = splitQueryFromUrl(input);
  if (Video_QUERY_MARKERS.some((marker) => query.includes(marker))) return true;
  if (hasDirectExtension) return false;
  if (!path.endsWith(".m3u8")) return false;
  if (isLikelyLivePlaybackUrl(input)) return false;

  return path.includes("/playlist/") || path.includes("/recorded/") || path.includes("/video/");
}

export function isLikelyLivePlayableMediaUrl(input: string | null | undefined): boolean {
  if (!isLikelyPublicPlayableMediaUrl(input)) return false;
  if (isLikelyVideoPlaybackUrl(input)) return false;
  if (isLikelyLivePlaybackUrl(input)) return true;
  return inferMediaUrlKind(input) === "hls";
}

function isPrivateIpv4Host(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 127) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 0) return true;
  return false;
}

function isLocalOnlyHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "localhost") return true;
  if (normalized === "host.docker.internal") return true;
  if (normalized === "10.0.2.2") return true;
  if (normalized.endsWith(".local")) return true;
  if (isPrivateIpv4Host(normalized)) return true;
  if (normalized.includes(":")) return true;
  return false;
}

function isMixedContentRisk(parsed: URL): boolean {
  return parsed.protocol === "http:" && !isLocalOnlyHost(parsed.hostname);
}

export function isLikelyPublicPlaybackUrl(input: string | null | undefined): boolean {
  if (!isHttpLikeMediaUrl(input)) return false;
  const value = input.trim();
  if (value.startsWith("/")) return true;
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    if (isLocalOnlyHost(parsed.hostname)) return false;
    // Relaxed mixed-content check to restore global HTTP-only broadcast relays.
    // if (isMixedContentRisk(parsed)) return false;
    return true;
  } catch {
    return false;
  }
}

export function isLikelyPublicPlayableMediaUrl(input: string | null | undefined): boolean {
  return isLikelyPlayableMediaUrl(input) && isLikelyPublicPlaybackUrl(input);
}
