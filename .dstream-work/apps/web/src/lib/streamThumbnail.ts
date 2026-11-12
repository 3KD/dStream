export type ThumbnailMode = "automatic" | "manual" | "off";

export interface StreamThumbnail {
  mode: ThumbnailMode;
  revision: number;
  source: "pending" | "generated" | "manual" | "off";
  imageUrl?: string;
  retryAt: number;
  warning?: string;
  privateStream: boolean;
  privateCaptureAllowed: boolean;
}

export function publicThumbnailUrl(origin: string, originStreamId: string): string {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password) {
    throw new Error("Thumbnail publication requires a public HTTPS origin.");
  }
  return new URL(`/api/thumbnail/${encodeURIComponent(originStreamId)}`, base.origin).href;
}

export function manualThumbnailUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.hash || value.length > 2048) {
    throw new Error("Use a publicly accessible HTTPS image URL without credentials or a fragment.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") ||
    host.startsWith("[") || /^\d+(?:\.\d+){3}$/.test(host) || !host.includes(".")) {
    throw new Error("Use a public image hostname, not a local or IP address.");
  }
  return url.href;
}

// NIP-01 replaces an address by timestamp, not by arrival order at a relay.
export class StreamAnnounceSequence {
  private sequence = 0;
  private lastTime = 0;
  constructor(readonly scope = "") {}
  begin(now = Math.floor(Date.now() / 1000), precedingCreatedAt = 0): { sequence: number; createdAt: number; scope: string } {
    this.sequence += 1;
    this.lastTime = Math.max(now, this.lastTime + 1, precedingCreatedAt + 1);
    return { sequence: this.sequence, createdAt: this.lastTime, scope: this.scope };
  }
  current(sequence: number): boolean { return sequence === this.sequence; }
  invalidate(): void { this.sequence += 1; }
}
