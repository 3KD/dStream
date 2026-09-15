const PROVIDER_HLS_RELAY_PATH = "/api/hls-relay";
const RELAYED_PROVIDER_ROOTS = ["streamroad.money"] as const;

function hasProviderRoot(hostname: string, root: string): boolean {
  return hostname === root || hostname.endsWith(`.${root}`);
}

export function parseRelayedProviderUrl(value: string, baseUrl?: string): URL | null {
  const raw = value.trim();
  if (!raw || raw.length > 4_096 || raw.startsWith(PROVIDER_HLS_RELAY_PATH)) return null;
  try {
    const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    const hostname = url.hostname.toLowerCase();
    if (!RELAYED_PROVIDER_ROOTS.some((root) => hasProviderRoot(hostname, root))) return null;
    return url;
  } catch {
    return null;
  }
}

export function buildProviderHlsRelayPath(value: string, baseUrl?: string): string | null {
  const source = parseRelayedProviderUrl(value, baseUrl);
  if (!source) return null;
  return `${PROVIDER_HLS_RELAY_PATH}?url=${encodeURIComponent(source.href)}`;
}

export function rewriteProviderHlsPlaylist(playlist: string, sourceUrl: string): string {
  const base = parseRelayedProviderUrl(sourceUrl);
  if (!base) throw new Error("Untrusted HLS playlist source.");

  const trailingNewline = playlist.endsWith("\n");
  const lines = playlist.split(/\r?\n/);
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith("#")) return buildProviderHlsRelayPath(trimmed, base.href) ?? line;
    return line.replace(/URI="([^"]+)"/g, (match, uri: string) => {
      const relayPath = buildProviderHlsRelayPath(uri, base.href);
      return relayPath ? `URI="${relayPath}"` : match;
    });
  });

  if (trailingNewline && rewritten.at(-1) !== "") rewritten.push("");
  return rewritten.join("\n");
}
