const ORIGIN_STREAM_ID_PATTERN = /^([0-9a-f]{64})--(.+)$/i;
const TRANSCODE_VARIANT_PATTERN = /__r\d+p$/i;

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

export function parseOriginStreamScope(segmentRaw: string | undefined): { streamPubkey: string; streamId: string } | null {
  if (!segmentRaw) return null;
  const decoded = safeDecode(segmentRaw.trim());
  if (!decoded) return null;
  const normalized = decoded.replace(TRANSCODE_VARIANT_PATTERN, "");
  const match = normalized.match(ORIGIN_STREAM_ID_PATTERN);
  if (!match?.[1] || !match?.[2]) return null;
  const streamPubkey = match[1].toLowerCase();
  const streamId = match[2];
  return { streamPubkey, streamId };
}
