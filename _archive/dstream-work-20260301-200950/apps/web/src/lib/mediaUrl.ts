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

export function isHttpLikeMediaUrl(input: string | null | undefined): input is string {
  if (!input) return false;
  const value = input.trim();
  return value.startsWith("/") || /^https?:\/\//i.test(value);
}

export function inferMediaUrlKind(input: string | null | undefined): MediaUrlKind {
  if (!isHttpLikeMediaUrl(input)) return "unknown";

  const path = splitPathFromUrl(input);
  if (!path) return "unknown";

  if (path.endsWith(".m3u8") || path.includes("/hls/") || path.includes("/stream/")) return "hls";
  if (DIRECT_MEDIA_EXTENSIONS.some((ext) => path.endsWith(ext))) return "direct";
  return "unknown";
}

export function isLikelyHlsUrl(input: string | null | undefined): boolean {
  return inferMediaUrlKind(input) === "hls";
}

export function isLikelyPlayableMediaUrl(input: string | null | undefined): boolean {
  return inferMediaUrlKind(input) !== "unknown";
}
