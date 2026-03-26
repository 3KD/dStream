/**
 * Virtual HLS manifest generator for P2P-only broadcasts.
 *
 * Maintains a sliding window of recent segments and produces a valid
 * #EXTM3U playlist that HLS.js can parse and play.
 */

export interface ManifestSegment {
  url: string;
  durationSec: number;
  sequenceNumber: number;
}

export class P2PManifest {
  private segments: ManifestSegment[] = [];
  private initUrl: string | null = null;
  private windowSize: number;
  private targetDuration: number;

  constructor(opts?: { windowSize?: number; targetDurationSec?: number }) {
    this.windowSize = opts?.windowSize ?? 10;
    this.targetDuration = opts?.targetDurationSec ?? 3;
  }

  setInitSegment(url: string): void {
    this.initUrl = url;
  }

  addSegment(segment: ManifestSegment): void {
    this.segments.push(segment);
    // Trim to sliding window.
    if (this.segments.length > this.windowSize) {
      this.segments = this.segments.slice(-this.windowSize);
    }
    // Update target duration to at least the max segment duration.
    const maxDur = Math.max(...this.segments.map((s) => Math.ceil(s.durationSec)));
    if (maxDur > this.targetDuration) {
      this.targetDuration = maxDur;
    }
  }

  getMediaSequence(): number {
    return this.segments.length > 0 ? this.segments[0].sequenceNumber : 0;
  }

  getSegmentCount(): number {
    return this.segments.length;
  }

  toString(): string {
    if (this.segments.length === 0) return "";

    const lines: string[] = [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      `#EXT-X-TARGETDURATION:${this.targetDuration}`,
      `#EXT-X-MEDIA-SEQUENCE:${this.getMediaSequence()}`,
    ];

    if (this.initUrl) {
      lines.push(`#EXT-X-MAP:URI="${this.initUrl}"`);
    }

    for (const seg of this.segments) {
      lines.push(`#EXTINF:${seg.durationSec.toFixed(3)},`);
      lines.push(seg.url);
    }

    return lines.join("\n") + "\n";
  }
}
