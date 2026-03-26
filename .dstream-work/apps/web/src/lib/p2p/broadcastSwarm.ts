/**
 * Broadcaster-side swarm wrapper.
 *
 * Ties the TsSegmenter (MediaRecorder → segments) to the P2PSwarm,
 * pushing new segments to all connected peers and broadcasting
 * manifest updates.
 */

import type { P2PSwarm } from "./swarm";
import { TsSegmenter, type TsSegmenterOpts, type SegmentEvent } from "./tsSegmenter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BroadcastSwarmOpts {
  swarm: P2PSwarm;
  stream: MediaStream;
  streamPubkey: string;
  streamId: string;
  segmentDurationMs?: number;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
}

export interface BroadcastSwarmStats {
  segmentsGenerated: number;
  bytesGenerated: number;
  manifest: string;
}

// ---------------------------------------------------------------------------
// BroadcastSwarm
// ---------------------------------------------------------------------------

export class BroadcastSwarm {
  private swarm: P2PSwarm;
  private segmenter: TsSegmenter;
  private stats: BroadcastSwarmStats = {
    segmentsGenerated: 0,
    bytesGenerated: 0,
    manifest: "",
  };
  private stopped = false;

  constructor(opts: BroadcastSwarmOpts) {
    this.swarm = opts.swarm;
    this.segmenter = new TsSegmenter({
      stream: opts.stream,
      streamPubkey: opts.streamPubkey,
      streamId: opts.streamId,
      segmentDurationMs: opts.segmentDurationMs,
      videoBitsPerSecond: opts.videoBitsPerSecond,
      audioBitsPerSecond: opts.audioBitsPerSecond,
    });

    this.segmenter.onSegment((event: SegmentEvent) => {
      if (this.stopped) return;
      this.onSegment(event);
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.segmenter.start();
  }

  stop(): void {
    this.stopped = true;
    this.segmenter.stop();
  }

  getStats(): BroadcastSwarmStats {
    return { ...this.stats };
  }

  private onSegment(event: SegmentEvent): void {
    const { url, data } = event;

    // Store locally + push to all peers.
    this.swarm.pushSegmentToAll(url, data, event.isInit ? "video/mp4" : "video/mp2t");

    if (!event.isInit) {
      this.stats.segmentsGenerated++;
      this.stats.bytesGenerated += data.byteLength;
    }

    // Update and broadcast the manifest.
    const manifest = this.segmenter.getManifest();
    if (manifest) {
      this.swarm.setManifest(manifest);
      this.swarm.broadcastManifest();
      this.stats.manifest = manifest;
    }
  }
}
