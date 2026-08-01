export type HlsPlaylistReadiness = {
  playable: boolean;
  kind: "media" | "low_latency_media" | "master" | "malformed" | "empty";
};

export function inspectHlsPlaylist(input: string): HlsPlaylistReadiness {
  const playlist = input.trimStart();
  if (!playlist) return { playable: false, kind: "empty" };
  if (!playlist.startsWith("#EXTM3U")) return { playable: false, kind: "malformed" };

  const lines = playlist.split(/\r?\n/).map((line) => line.trim());
  const hasUriAfterTag = (tag: string) =>
    lines.some((line, index) => {
      if (!line.startsWith(tag)) return false;
      return lines.slice(index + 1).some((candidate) => candidate.length > 0 && !candidate.startsWith("#"));
    });

  if (hasUriAfterTag("#EXTINF:")) return { playable: true, kind: "media" };
  if (lines.some((line) => line.startsWith("#EXT-X-PART:") && /(?:^|,)URI=(?:"[^"]+"|[^,]+)/.test(line))) {
    return { playable: true, kind: "low_latency_media" };
  }
  if (hasUriAfterTag("#EXT-X-STREAM-INF:")) return { playable: true, kind: "master" };
  return { playable: false, kind: "empty" };
}
