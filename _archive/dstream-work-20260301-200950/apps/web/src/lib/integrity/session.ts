import type { StreamManifestRoot } from "@dstream/protocol";
import { isSha256Supported, sha256Hex } from "./sha256";

export type IntegritySource = { t: "http"; url: string } | { t: "p2p"; peerPubkey: string };

export interface IntegrityTamper {
  atMs: number;
  renditionId: string;
  uri: string;
  expectedSha256: string;
  actualSha256: string;
  source: IntegritySource;
}

export interface IntegritySnapshot {
  enabled: boolean;
  sha256Supported: boolean;
  manifestsSeen: number;
  entriesKnown: number;
  verifiedOk: number;
  verifiedFail: number;
  unverifiedSegments: number;
  lastManifestAtMs: number | null;
  lastVerifiedAtMs: number | null;
  lastTamper: IntegrityTamper | null;
}

type HashEntry = {
  sha256: string;
  epochStartMs: number;
  epochDurationMs: number;
  lastSeenAtMs: number;
  byteLength?: number;
};

function normalizeRenditionId(input: string): string {
  return (input || "").trim() || "index";
}

function normalizeUri(input: string): string {
  return (input || "").trim();
}

export class IntegritySession {
  readonly streamPubkey: string;
  readonly streamId: string;
  readonly manifestSignerPubkey: string;
  readonly sha256Supported: boolean;
  readonly enabled: boolean;

  private readonly byRendition = new Map<string, Map<string, HashEntry>>();
  private manifestsSeen = 0;
  private verifiedOk = 0;
  private verifiedFail = 0;
  private unverifiedSegments = 0;
  private lastManifestAtMs: number | null = null;
  private lastVerifiedAtMs: number | null = null;
  private lastTamper: IntegrityTamper | null = null;
  private lastPruneAtMs = 0;

  constructor(opts: { streamPubkey: string; streamId: string; manifestSignerPubkey: string }) {
    this.streamPubkey = opts.streamPubkey;
    this.streamId = opts.streamId;
    this.manifestSignerPubkey = opts.manifestSignerPubkey;
    this.sha256Supported = isSha256Supported();
    this.enabled = this.sha256Supported;
  }

  ingestManifest(manifest: StreamManifestRoot): void {
    if (!manifest) return;
    if (manifest.pubkey !== this.manifestSignerPubkey) return;
    if (manifest.streamPubkey !== this.streamPubkey) return;
    if (manifest.streamId !== this.streamId) return;

    const nowMs = Date.now();
    this.lastManifestAtMs = nowMs;
    this.manifestsSeen += 1;

    const renditionId = normalizeRenditionId(manifest.renditionId);
    let map = this.byRendition.get(renditionId);
    if (!map) {
      map = new Map();
      this.byRendition.set(renditionId, map);
    }

    for (const seg of manifest.segments) {
      const uri = normalizeUri(seg.uri);
      if (!uri) continue;
      map.set(uri, {
        sha256: seg.sha256.toLowerCase(),
        epochStartMs: manifest.epochStartMs,
        epochDurationMs: manifest.epochDurationMs,
        lastSeenAtMs: nowMs,
        byteLength: seg.byteLength ?? undefined
      });
    }

    if (manifest.init) {
      const uri = normalizeUri(manifest.init.uri);
      if (uri) {
        map.set(uri, {
          sha256: manifest.init.sha256.toLowerCase(),
          epochStartMs: manifest.epochStartMs,
          epochDurationMs: manifest.epochDurationMs,
          lastSeenAtMs: nowMs,
          byteLength: manifest.init.byteLength ?? undefined
        });
      }
    }

    this.pruneIfNeeded(nowMs);
  }

  private pruneIfNeeded(nowMs: number): void {
    if (nowMs - this.lastPruneAtMs < 60_000) return;
    this.lastPruneAtMs = nowMs;

    const maxAgeMs = 20 * 60_000;
    for (const rendition of this.byRendition.values()) {
      for (const [uri, entry] of rendition.entries()) {
        if (nowMs - entry.lastSeenAtMs > maxAgeMs) rendition.delete(uri);
      }
    }
  }

  private findExpected(renditionId: string, uri: string): HashEntry | null {
    const rid = normalizeRenditionId(renditionId);
    const u = normalizeUri(uri);
    if (!u) return null;
    const map = this.byRendition.get(rid);
    const direct = map?.get(u);
    if (direct) return direct;

    for (const other of this.byRendition.values()) {
      const found = other.get(u);
      if (found) return found;
    }

    return null;
  }

  async verifySegment(opts: { renditionId: string; uri: string; data: ArrayBuffer; source: IntegritySource }): Promise<{
    ok: boolean;
    verified: boolean;
    expectedSha256?: string;
    actualSha256?: string;
  }> {
    if (!this.enabled) {
      this.unverifiedSegments += 1;
      return { ok: true, verified: false };
    }

    const expected = this.findExpected(opts.renditionId, opts.uri);
    if (!expected) {
      this.unverifiedSegments += 1;
      return { ok: true, verified: false };
    }

    const actual = await sha256Hex(opts.data);
    if (!actual) {
      this.unverifiedSegments += 1;
      return { ok: true, verified: false };
    }

    const actualLower = actual.toLowerCase();
    if (actualLower !== expected.sha256) {
      this.verifiedFail += 1;
      this.lastTamper = {
        atMs: Date.now(),
        renditionId: normalizeRenditionId(opts.renditionId),
        uri: normalizeUri(opts.uri),
        expectedSha256: expected.sha256,
        actualSha256: actualLower,
        source: opts.source
      };
      return { ok: false, verified: true, expectedSha256: expected.sha256, actualSha256: actualLower };
    }

    this.verifiedOk += 1;
    this.lastVerifiedAtMs = Date.now();
    return { ok: true, verified: true, expectedSha256: expected.sha256, actualSha256: actualLower };
  }

  snapshot(): IntegritySnapshot {
    let entriesKnown = 0;
    for (const map of this.byRendition.values()) entriesKnown += map.size;
    return {
      enabled: this.enabled,
      sha256Supported: this.sha256Supported,
      manifestsSeen: this.manifestsSeen,
      entriesKnown,
      verifiedOk: this.verifiedOk,
      verifiedFail: this.verifiedFail,
      unverifiedSegments: this.unverifiedSegments,
      lastManifestAtMs: this.lastManifestAtMs,
      lastVerifiedAtMs: this.lastVerifiedAtMs,
      lastTamper: this.lastTamper
    };
  }
}

