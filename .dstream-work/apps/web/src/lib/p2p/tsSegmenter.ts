/**
 * Client-side segment generator for P2P-only broadcasting.
 *
 * Takes a MediaStream from the camera, uses MediaRecorder to produce
 * short media chunks, and emits them as segments the P2P swarm can distribute.
 *
 * Strategy:
 * - Safari/Chrome: MediaRecorder outputs fMP4 (video/mp4). Segments are .m4s files.
 * - Firefox: MediaRecorder outputs webm. We transmux to MPEG-TS via mux.js.
 * - The first chunk contains the init segment (moov/header) which is extracted separately.
 */

import { P2PManifest, type ManifestSegment } from "./p2pManifest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TsSegmenterOpts {
  stream: MediaStream;
  streamPubkey: string;
  streamId: string;
  segmentDurationMs?: number;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
}

export interface SegmentEvent {
  url: string;
  data: ArrayBuffer;
  sequenceNumber: number;
  durationSec: number;
  isInit: boolean;
}

type SegmentHandler = (event: SegmentEvent) => void;

// ---------------------------------------------------------------------------
// MIME detection
// ---------------------------------------------------------------------------

const PREFERRED_MIMES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=h264,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pickMimeType(): { mime: string; format: "mp4" | "webm" } {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder not supported");
  }
  for (const mime of PREFERRED_MIMES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return { mime, format: mime.startsWith("video/mp4") ? "mp4" : "webm" };
    }
  }
  // Last resort — let the browser pick.
  return { mime: "", format: "webm" };
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function segmentUrl(pubkey: string, streamId: string, seq: number, ext: string): string {
  return `p2p://${pubkey}/${streamId}/${seq}${ext}`;
}

function initSegmentUrl(pubkey: string, streamId: string, ext: string): string {
  return `p2p://${pubkey}/${streamId}/init${ext}`;
}

// ---------------------------------------------------------------------------
// WebM → MPEG-TS transmuxer (lazy loaded, only for Firefox)
// ---------------------------------------------------------------------------

let transmuxerLoaded = false;
let Transmuxer: any = null;

async function loadTransmuxer(): Promise<void> {
  if (transmuxerLoaded) return;
  try {
    const muxjs = await import("mux.js");
    Transmuxer = (muxjs as any).default?.mp2t?.Transmuxer ?? (muxjs as any).mp2t?.Transmuxer;
    if (!Transmuxer) {
      // Try alternate export path.
      Transmuxer = (muxjs as any).Transmuxer;
    }
  } catch {
    // mux.js not available — webm transmuxing won't work.
  }
  transmuxerLoaded = true;
}

function transmuxWebmToTs(data: ArrayBuffer): ArrayBuffer | null {
  if (!Transmuxer) return null;
  try {
    const transmuxer = new Transmuxer();
    const segments: Uint8Array[] = [];
    transmuxer.on("data", (segment: any) => {
      if (segment.data) segments.push(new Uint8Array(segment.data));
    });
    transmuxer.push(new Uint8Array(data));
    transmuxer.flush();

    if (segments.length === 0) return null;
    const totalLen = segments.reduce((sum, s) => sum + s.byteLength, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const seg of segments) {
      result.set(seg, offset);
      offset += seg.byteLength;
    }
    return result.buffer;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// MP4 init segment extraction
// ---------------------------------------------------------------------------

/**
 * For fMP4 (Safari/Chrome), the first MediaRecorder chunk contains both
 * the moov (init) and first moof+mdat (media). We split them by finding
 * the moof box boundary.
 */
function splitInitAndMedia(data: ArrayBuffer): { init: ArrayBuffer; media: ArrayBuffer } | null {
  const view = new DataView(data);
  let offset = 0;
  let moofOffset = -1;

  // Walk top-level MP4 boxes to find 'moof'.
  while (offset + 8 <= data.byteLength) {
    const size = view.getUint32(offset);
    if (size < 8 || offset + size > data.byteLength) break;
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );
    if (type === "moof") {
      moofOffset = offset;
      break;
    }
    offset += size;
  }

  if (moofOffset <= 0) return null;

  return {
    init: data.slice(0, moofOffset),
    media: data.slice(moofOffset),
  };
}

// ---------------------------------------------------------------------------
// TsSegmenter
// ---------------------------------------------------------------------------

export class TsSegmenter {
  private opts: Required<Pick<TsSegmenterOpts, "streamPubkey" | "streamId" | "segmentDurationMs">> & TsSegmenterOpts;
  private recorder: MediaRecorder | null = null;
  private format: "mp4" | "webm" = "mp4";
  private seq = 0;
  private initEmitted = false;
  private manifest: P2PManifest;
  private handlers: SegmentHandler[] = [];
  private startTime = 0;
  private lastSegmentTime = 0;
  private stopped = false;

  constructor(opts: TsSegmenterOpts) {
    this.opts = {
      segmentDurationMs: 2000,
      ...opts,
    };
    this.manifest = new P2PManifest({ targetDurationSec: Math.ceil(this.opts.segmentDurationMs / 1000) + 1 });
  }

  onSegment(handler: SegmentHandler): void {
    this.handlers.push(handler);
  }

  getManifest(): string {
    return this.manifest.toString();
  }

  getSegmentCount(): number {
    return this.seq;
  }

  async start(): Promise<void> {
    this.stopped = false;
    const { mime, format } = pickMimeType();
    this.format = format;

    if (format === "webm") {
      await loadTransmuxer();
    }

    const recorderOpts: MediaRecorderOptions = {
      mimeType: mime || undefined,
    };
    if (this.opts.videoBitsPerSecond) {
      recorderOpts.videoBitsPerSecond = this.opts.videoBitsPerSecond;
    }
    if (this.opts.audioBitsPerSecond) {
      recorderOpts.audioBitsPerSecond = this.opts.audioBitsPerSecond;
    }

    this.recorder = new MediaRecorder(this.opts.stream, recorderOpts);
    this.startTime = Date.now();
    this.lastSegmentTime = this.startTime;

    this.recorder.ondataavailable = (e) => {
      if (this.stopped || !e.data || e.data.size === 0) return;
      this.processChunk(e.data);
    };

    this.recorder.onerror = () => {
      this.stop();
    };

    this.recorder.start(this.opts.segmentDurationMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        // already stopped
      }
    }
    this.recorder = null;
  }

  private async processChunk(blob: Blob): Promise<void> {
    const raw = await blob.arrayBuffer();
    if (raw.byteLength === 0) return;

    const now = Date.now();
    const durationSec = (now - this.lastSegmentTime) / 1000;
    this.lastSegmentTime = now;

    if (this.format === "mp4") {
      this.processMp4Chunk(raw, durationSec);
    } else {
      this.processWebmChunk(raw, durationSec);
    }
  }

  private processMp4Chunk(data: ArrayBuffer, durationSec: number): void {
    const ext = ".m4s";
    const { streamPubkey, streamId } = this.opts;

    if (!this.initEmitted) {
      // First chunk: split init (moov) from first media segment (moof+mdat).
      const split = splitInitAndMedia(data);
      if (split) {
        const initUrl = initSegmentUrl(streamPubkey, streamId, ".mp4");
        this.manifest.setInitSegment(initUrl);
        this.emit({ url: initUrl, data: split.init, sequenceNumber: -1, durationSec: 0, isInit: true });

        this.seq++;
        const url = segmentUrl(streamPubkey, streamId, this.seq, ext);
        this.manifest.addSegment({ url, durationSec, sequenceNumber: this.seq });
        this.emit({ url, data: split.media, sequenceNumber: this.seq, durationSec, isInit: false });
      } else {
        // Can't split — treat entire first chunk as both init and first segment.
        const initUrl = initSegmentUrl(streamPubkey, streamId, ".mp4");
        this.manifest.setInitSegment(initUrl);
        this.emit({ url: initUrl, data, sequenceNumber: -1, durationSec: 0, isInit: true });
      }
      this.initEmitted = true;
      return;
    }

    this.seq++;
    const url = segmentUrl(streamPubkey, streamId, this.seq, ext);
    this.manifest.addSegment({ url, durationSec, sequenceNumber: this.seq });
    this.emit({ url, data, sequenceNumber: this.seq, durationSec, isInit: false });
  }

  private processWebmChunk(data: ArrayBuffer, durationSec: number): void {
    const ext = ".ts";
    const { streamPubkey, streamId } = this.opts;

    const tsData = transmuxWebmToTs(data);
    if (!tsData) {
      // Transmuxing failed — skip this chunk.
      return;
    }

    if (!this.initEmitted) {
      // For TS, there's no separate init segment — each .ts is self-contained.
      this.initEmitted = true;
    }

    this.seq++;
    const url = segmentUrl(streamPubkey, streamId, this.seq, ext);
    this.manifest.addSegment({ url, durationSec, sequenceNumber: this.seq });
    this.emit({ url, data: tsData, sequenceNumber: this.seq, durationSec, isInit: false });
  }

  private emit(event: SegmentEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // ignore handler errors
      }
    }
  }
}
