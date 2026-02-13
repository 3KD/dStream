import { deriveSwarmId, type P2PSignalPayloadV1 } from "@dstream/protocol";
import type { P2PSignalClient } from "./nostrSignal";
import { createP2PSignalClient } from "./nostrSignal";
import type { SignalIdentity } from "./localIdentity";
import { SegmentCache } from "./segmentCache";
import { getDefaultRtcConfig } from "../webrtc";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function nowMs() {
  return Date.now();
}

function randomId(bytes = 16): string {
  const cryptoObj = (globalThis as any).crypto;
  if (!cryptoObj?.getRandomValues) throw new Error("crypto.getRandomValues unavailable");
  const b = new Uint8Array(bytes);
  cryptoObj.getRandomValues(b);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function candidateToInit(candidate: RTCIceCandidate): RTCIceCandidateInit {
  const any = candidate as any;
  if (typeof any.toJSON === "function") return any.toJSON();
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: (candidate as any).usernameFragment
  };
}

const DEFAULT_CHUNK_BYTES = 16 * 1024;
const FAILURE_EVICT_THRESHOLD = 6;
const EVICT_COOLDOWN_MS = 120_000;

function pickChunkBytes(pc: RTCPeerConnection): number {
  const max = (pc as any)?.sctp?.maxMessageSize;
  if (typeof max === "number" && Number.isFinite(max) && max > 2048) {
    return Math.max(1024, Math.min(DEFAULT_CHUNK_BYTES, Math.floor(max - 1024)));
  }
  return DEFAULT_CHUNK_BYTES;
}

type DcMessage =
  | { v: 1; t: "get"; id: string; url: string }
  | { v: 1; t: "res"; id: string; ok: boolean; url: string; len?: number; mime?: string; err?: string };

function safeJsonParse(input: string): any | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function isDcMessage(obj: any): obj is DcMessage {
  if (!obj || typeof obj !== "object") return false;
  if (obj.v !== 1) return false;
  if (obj.t === "get") return typeof obj.id === "string" && typeof obj.url === "string";
  if (obj.t === "res") return typeof obj.id === "string" && typeof obj.ok === "boolean" && typeof obj.url === "string";
  return false;
}

export interface P2PSwarmStats {
  peersDesired: number;
  peersConnected: number;
  requestsToPeers: number;
  hitsFromPeers: number;
  bytesFromPeers: number;
  bytesToPeers: number;
  cacheBytes: number;
  evictedPeers: number;
}

type PeerRole = "initiator" | "responder";

export interface P2PSegmentResponse {
  peerPubkey: string;
  data: ArrayBuffer;
}

interface PeerConn {
  peerPubkey: string;
  role: PeerRole;
  sessionId: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  pendingIce: RTCIceCandidateInit[];
  sendQueue: Promise<void>;
  inflight?: { id: string; url: string; resolve: (data: P2PSegmentResponse | null) => void; timer: any; expectBinary: boolean };
  expectBinary?: { id: string; url: string; len: number; received: number; buffer: Uint8Array };
  successCount: number;
  failureCount: number;
  lastRttMs: number | null;
  lastAttemptAtMs: number;
  cooldownUntilMs: number;
}

export class P2PSwarm {
  private readonly identity: SignalIdentity;
  private readonly relays: string[];
  private readonly streamPubkey: string;
  private readonly streamId: string;
  private swarmId: string | null = null;
  private readonly rtcConfig: RTCConfiguration;
  private readonly maxPeers: number;
  private readonly cache: SegmentCache;
  private readonly signal: P2PSignalClient;
  private readonly earlyCandidates = new Map<string, { createdAtSec: number; candidates: RTCIceCandidateInit[] }>();
  private readonly evictedUntilMs = new Map<string, number>();

  private readonly peers = new Map<string, PeerConn>();
  private desiredPeers: string[] = [];
  private closed = false;
  private subClose: (() => void) | null = null;

  private stats: P2PSwarmStats = {
    peersDesired: 0,
    peersConnected: 0,
    requestsToPeers: 0,
    hitsFromPeers: 0,
    bytesFromPeers: 0,
    bytesToPeers: 0,
    cacheBytes: 0,
    evictedPeers: 0
  };

  constructor(opts: {
    identity: SignalIdentity;
    relays: string[];
    streamPubkey: string;
    streamId: string;
    rtcConfig?: RTCConfiguration;
    maxPeers?: number;
    cacheMaxBytes?: number;
  }) {
    this.identity = opts.identity;
    this.relays = opts.relays;
    this.streamPubkey = opts.streamPubkey;
    this.streamId = opts.streamId;
    this.rtcConfig = opts.rtcConfig ?? getDefaultRtcConfig();
    this.maxPeers = Math.max(1, Math.min(12, opts.maxPeers ?? 6));
    this.cache = new SegmentCache({ maxBytes: opts.cacheMaxBytes ?? 24 * 1024 * 1024 });

    this.signal = createP2PSignalClient({
      identity: this.identity,
      relays: this.relays,
      streamPubkey: this.streamPubkey,
      streamId: this.streamId
    });
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error("swarm closed");
    if (this.subClose) return;

    this.swarmId = await deriveSwarmId({ streamPubkey: this.streamPubkey, streamId: this.streamId });

    const sub = this.signal.subscribe((msg) => {
      void this.onSignal(msg.fromPubkey, msg.payload);
    });
    this.subClose = sub.close;
  }

  stop(): void {
    this.closed = true;
    try {
      this.subClose?.();
    } catch {
      // ignore
    }
    this.subClose = null;
    for (const peer of Array.from(this.peers.keys())) {
      this.closePeer(peer);
    }
  }

  getStats(): P2PSwarmStats {
    this.pruneEvictions();
    const connected = Array.from(this.peers.values()).filter((p) => p.dc?.readyState === "open").length;
    return {
      ...this.stats,
      peersDesired: this.desiredPeers.length,
      peersConnected: connected,
      cacheBytes: this.cache.totalBytes
    };
  }

  setDesiredPeers(pubkeys: string[]): void {
    if (this.closed) return;
    this.pruneEvictions();
    const unique = Array.from(new Set(pubkeys.filter(Boolean)));
    unique.sort((a, b) => a.localeCompare(b));
    const trimmed = unique
      .filter((pk) => pk !== this.identity.pubkey)
      .filter((pk) => !this.isPeerEvicted(pk))
      .slice(0, this.maxPeers);
    this.desiredPeers = trimmed;

    for (const pk of trimmed) {
      if (this.peers.has(pk)) continue;
      if (this.identity.pubkey.localeCompare(pk) < 0) {
        void this.initiate(pk);
      }
    }

    // If we have too many peers, close extras (oldest-first based on insertion order).
    const keep = new Set(trimmed);
    for (const pk of Array.from(this.peers.keys())) {
      if (!keep.has(pk)) this.closePeer(pk);
    }
  }

  storeSegment(url: string, data: ArrayBuffer): void {
    if (this.closed) return;
    this.cache.set(url, data);
    this.stats.cacheBytes = this.cache.totalBytes;
  }

  async requestSegment(url: string, opts?: { timeoutMs?: number }): Promise<P2PSegmentResponse | null> {
    if (this.closed) return null;
    const timeoutMs = Math.max(40, Math.min(900, opts?.timeoutMs ?? 180));
    const startedAtMs = nowMs();
    const peers = this.rankRequestPeers(this.requestablePeers());
    if (peers.length === 0) return null;

    for (const peer of peers) {
      const remaining = timeoutMs - (nowMs() - startedAtMs);
      if (remaining <= 30) break;
      const attemptTimeoutMs = Math.max(40, Math.min(remaining, 260));
      const out = await this.requestSegmentFromPeer(peer, url, attemptTimeoutMs);
      if (out) return out;
    }

    return null;
  }

  dropPeer(peerPubkey: string): void {
    if (this.closed) return;
    this.closePeer(peerPubkey);
  }

  private requestablePeers(): PeerConn[] {
    const now = nowMs();
    this.pruneEvictions();
    return Array.from(this.peers.values()).filter((peer) => {
      if (!peer.dc || peer.dc.readyState !== "open") return false;
      if (peer.inflight) return false;
      if (this.isPeerEvicted(peer.peerPubkey)) return false;
      return peer.cooldownUntilMs <= now;
    });
  }

  private peerScore(peer: PeerConn): number {
    const rtt = peer.lastRttMs ?? 140;
    const failurePenalty = peer.failureCount * 90;
    const successCredit = Math.min(peer.successCount, 12) * 6;
    return rtt + failurePenalty - successCredit;
  }

  private rankRequestPeers(peers: PeerConn[]): PeerConn[] {
    return peers.slice().sort((a, b) => {
      const byScore = this.peerScore(a) - this.peerScore(b);
      if (byScore !== 0) return byScore;
      return a.peerPubkey.localeCompare(b.peerPubkey);
    });
  }

  private markPeerFailure(peer: PeerConn, cooldownMs = 240): void {
    peer.failureCount = Math.min(peer.failureCount + 1, 20);
    if (peer.failureCount >= FAILURE_EVICT_THRESHOLD) {
      this.evictPeer(peer.peerPubkey);
      return;
    }
    const backoff = Math.min(2000, cooldownMs * Math.max(1, peer.failureCount));
    peer.cooldownUntilMs = nowMs() + backoff;
  }

  private markPeerSuccess(peer: PeerConn, rttMs: number): void {
    peer.successCount = Math.min(peer.successCount + 1, 1000);
    peer.failureCount = 0;
    peer.cooldownUntilMs = 0;
    if (Number.isFinite(rttMs) && rttMs >= 0) peer.lastRttMs = Math.round(rttMs);
  }

  private async requestSegmentFromPeer(peer: PeerConn, url: string, timeoutMs: number): Promise<P2PSegmentResponse | null> {
    const dc = peer.dc;
    if (!dc || dc.readyState !== "open") return null;

    this.stats.requestsToPeers += 1;

    const id = randomId(12);
    const payload: DcMessage = { v: 1, t: "get", id, url };

    return await new Promise<P2PSegmentResponse | null>((resolve) => {
      const timer = setTimeout(() => {
        if (peer.inflight?.id === id) peer.inflight = undefined;
        if (peer.expectBinary?.id === id) peer.expectBinary = undefined;
        this.markPeerFailure(peer, 260);
        resolve(null);
      }, timeoutMs);

      peer.lastAttemptAtMs = nowMs();
      peer.inflight = { id, url, resolve, timer, expectBinary: false };
      try {
        dc.send(JSON.stringify(payload));
      } catch {
        clearTimeout(timer);
        peer.inflight = undefined;
        this.markPeerFailure(peer, 260);
        resolve(null);
      }
    });
  }

  private earlyKey(peerPubkey: string, sessionId: string): string {
    return `${peerPubkey}:${sessionId}`;
  }

  private isPeerEvicted(peerPubkey: string): boolean {
    const until = this.evictedUntilMs.get(peerPubkey);
    if (!until) return false;
    return until > nowMs();
  }

  private pruneEvictions(): void {
    const now = nowMs();
    for (const [peerPubkey, until] of this.evictedUntilMs.entries()) {
      if (until <= now) this.evictedUntilMs.delete(peerPubkey);
    }
  }

  private evictPeer(peerPubkey: string): void {
    this.evictedUntilMs.set(peerPubkey, nowMs() + EVICT_COOLDOWN_MS);
    this.stats.evictedPeers += 1;
    this.closePeer(peerPubkey);
  }

  private pruneEarlyCandidates(): void {
    const cutoff = nowSec() - 45;
    for (const [key, entry] of this.earlyCandidates.entries()) {
      if (entry.createdAtSec < cutoff) this.earlyCandidates.delete(key);
    }
  }

  private bufferEarlyCandidate(peerPubkey: string, sessionId: string, candidate: RTCIceCandidateInit): void {
    const key = this.earlyKey(peerPubkey, sessionId);
    const existing = this.earlyCandidates.get(key);
    if (!existing) {
      this.earlyCandidates.set(key, { createdAtSec: nowSec(), candidates: [candidate] });
      return;
    }
    existing.createdAtSec = nowSec();
    if (existing.candidates.length < 64) existing.candidates.push(candidate);
  }

  private drainEarlyCandidates(peerPubkey: string, sessionId: string): RTCIceCandidateInit[] {
    const key = this.earlyKey(peerPubkey, sessionId);
    const entry = this.earlyCandidates.get(key);
    if (!entry) return [];
    this.earlyCandidates.delete(key);
    return entry.candidates;
  }

  private async onSignal(fromPubkey: string, payload: P2PSignalPayloadV1): Promise<void> {
    if (this.closed) return;
    if (this.isPeerEvicted(fromPubkey)) return;
    if (payload.streamPubkey !== this.streamPubkey) return;
    if (payload.streamId !== this.streamId) return;
    if (payload.swarmId && this.swarmId && payload.swarmId !== this.swarmId) return;

    this.pruneEarlyCandidates();

    if (payload.type === "offer" && typeof payload.sdp === "string") {
      await this.acceptOffer(fromPubkey, payload.sessionId, payload.sdp);
      return;
    }

    if (payload.type === "candidate" && payload.candidate) {
      const existing = this.peers.get(fromPubkey);
      if (!existing || existing.sessionId !== payload.sessionId) {
        this.bufferEarlyCandidate(fromPubkey, payload.sessionId, payload.candidate);
        return;
      }
    }

    const peer = this.peers.get(fromPubkey);
    if (!peer) return;
    if (payload.sessionId !== peer.sessionId) return;

    if (payload.type === "answer" && typeof payload.sdp === "string") {
      if (peer.role !== "initiator") return;
      await peer.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      for (const c of peer.pendingIce.splice(0)) {
        try {
          await peer.pc.addIceCandidate(c);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (payload.type === "candidate" && payload.candidate) {
      if (!peer.pc.remoteDescription) {
        peer.pendingIce.push(payload.candidate);
        return;
      }
      try {
        await peer.pc.addIceCandidate(payload.candidate);
      } catch {
        // ignore
      }
      return;
    }

    if (payload.type === "bye") {
      this.closePeer(fromPubkey);
      return;
    }
  }

  private async initiate(peerPubkey: string): Promise<void> {
    if (this.closed) return;
    if (this.peers.has(peerPubkey)) return;

    const sessionId = randomId(16);
    const pc = new RTCPeerConnection(this.rtcConfig);
    const conn: PeerConn = {
      peerPubkey,
      role: "initiator",
      sessionId,
      pc,
      dc: null,
      pendingIce: [],
      sendQueue: Promise.resolve(),
      successCount: 0,
      failureCount: 0,
      lastRttMs: null,
      lastAttemptAtMs: 0,
      cooldownUntilMs: 0
    };
    this.peers.set(peerPubkey, conn);

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      void this.signal.send(peerPubkey, {
        v: 1,
        type: "candidate",
        sessionId,
        streamPubkey: this.streamPubkey,
        streamId: this.streamId,
        swarmId: this.swarmId ?? undefined,
        candidate: candidateToInit(ev.candidate)
      } as P2PSignalPayloadV1);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "failed" || st === "closed" || st === "disconnected") this.closePeer(peerPubkey);
    };

    const dc = pc.createDataChannel("dstream");
    conn.dc = dc;
    this.attachDataChannel(conn, dc);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!pc.localDescription?.sdp) throw new Error("missing localDescription");

      await this.signal.send(peerPubkey, {
        v: 1,
        type: "offer",
        sessionId,
        streamPubkey: this.streamPubkey,
        streamId: this.streamId,
        swarmId: this.swarmId ?? undefined,
        sdp: pc.localDescription.sdp
      } as P2PSignalPayloadV1);
    } catch {
      this.closePeer(peerPubkey);
    }
  }

  private async acceptOffer(peerPubkey: string, sessionId: string, sdp: string): Promise<void> {
    if (this.closed) return;

    // Replace any existing connection with this peer.
    if (this.peers.has(peerPubkey)) this.closePeer(peerPubkey);

    const pc = new RTCPeerConnection(this.rtcConfig);
    const conn: PeerConn = {
      peerPubkey,
      role: "responder",
      sessionId,
      pc,
      dc: null,
      pendingIce: [],
      sendQueue: Promise.resolve(),
      successCount: 0,
      failureCount: 0,
      lastRttMs: null,
      lastAttemptAtMs: 0,
      cooldownUntilMs: 0
    };
    this.peers.set(peerPubkey, conn);

    const early = this.drainEarlyCandidates(peerPubkey, sessionId);
    if (early.length) conn.pendingIce.push(...early);

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      void this.signal.send(peerPubkey, {
        v: 1,
        type: "candidate",
        sessionId,
        streamPubkey: this.streamPubkey,
        streamId: this.streamId,
        swarmId: this.swarmId ?? undefined,
        candidate: candidateToInit(ev.candidate)
      } as P2PSignalPayloadV1);
    };
    pc.ondatachannel = (ev) => {
      conn.dc = ev.channel;
      this.attachDataChannel(conn, ev.channel);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "failed" || st === "closed" || st === "disconnected") this.closePeer(peerPubkey);
    };

    await pc.setRemoteDescription({ type: "offer", sdp });
    for (const c of conn.pendingIce.splice(0)) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        // ignore
      }
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (!pc.localDescription?.sdp) throw new Error("missing localDescription");

    await this.signal.send(peerPubkey, {
      v: 1,
      type: "answer",
      sessionId,
      streamPubkey: this.streamPubkey,
      streamId: this.streamId,
      swarmId: this.swarmId ?? undefined,
      sdp: pc.localDescription.sdp
    } as P2PSignalPayloadV1);
  }

  private attachDataChannel(peer: PeerConn, dc: RTCDataChannel): void {
    dc.binaryType = "arraybuffer";

    dc.onmessage = (ev) => {
      const data: any = ev.data;
      if (typeof data === "string") {
        const obj = safeJsonParse(data);
        if (!isDcMessage(obj)) return;
        void this.onDcMessage(peer, obj);
        return;
      }

      if (data instanceof ArrayBuffer) {
        void this.onDcBinary(peer, data);
        return;
      }

      if (data instanceof Blob) {
        void data
          .arrayBuffer()
          .then((buf) => this.onDcBinary(peer, buf))
          .catch(() => {
            // ignore
          });
        return;
      }

      if (ArrayBuffer.isView(data)) {
        const view = data as ArrayBufferView;
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        const copy = new Uint8Array(bytes);
        void this.onDcBinary(peer, copy.buffer);
      }
    };
  }

  private async onDcMessage(peer: PeerConn, msg: DcMessage): Promise<void> {
    if (this.closed) return;
    if (msg.t === "get") {
      const data = this.cache.get(msg.url);
      if (!data) {
        this.queueSend(peer, JSON.stringify({ v: 1, t: "res", id: msg.id, ok: false, url: msg.url, err: "miss" } satisfies DcMessage));
        return;
      }

      const header: DcMessage = {
        v: 1,
        t: "res",
        id: msg.id,
        ok: true,
        url: msg.url,
        len: data.byteLength,
        mime: "video/mp2t"
      };

      this.queueSend(peer, JSON.stringify(header));
      this.queueSendBinary(peer, data);
      this.stats.bytesToPeers += data.byteLength;
      return;
    }

    if (msg.t === "res") {
      if (!peer.inflight || peer.inflight.id !== msg.id) return;
      if (!msg.ok) {
        clearTimeout(peer.inflight.timer);
        const resolve = peer.inflight.resolve;
        peer.inflight = undefined;
        this.markPeerFailure(peer, 220);
        resolve(null);
        return;
      }
      const len = typeof msg.len === "number" ? msg.len : 0;
      if (len <= 0 || len > 8 * 1024 * 1024) {
        clearTimeout(peer.inflight.timer);
        const resolve = peer.inflight.resolve;
        peer.inflight = undefined;
        this.markPeerFailure(peer, 220);
        resolve(null);
        return;
      }
      peer.expectBinary = { id: msg.id, url: msg.url, len, received: 0, buffer: new Uint8Array(len) };
      peer.inflight.expectBinary = true;
      return;
    }
  }

  private async onDcBinary(peer: PeerConn, data: ArrayBuffer): Promise<void> {
    if (this.closed) return;
    const expected = peer.expectBinary;
    if (!expected) return;
    if (!peer.inflight || peer.inflight.id !== expected.id) return;

    const chunk = new Uint8Array(data);
    const remaining = expected.len - expected.received;

    if (chunk.byteLength > remaining) {
      clearTimeout(peer.inflight.timer);
      const resolve = peer.inflight.resolve;
      peer.inflight = undefined;
      peer.expectBinary = undefined;
      this.markPeerFailure(peer, 260);
      resolve(null);
      return;
    }

    expected.buffer.set(chunk, expected.received);
    expected.received += chunk.byteLength;
    if (expected.received < expected.len) return;

    const { resolve, timer, url } = peer.inflight;
    clearTimeout(timer);
    peer.inflight = undefined;
    peer.expectBinary = undefined;

    const full = expected.buffer.buffer as ArrayBuffer;
    this.stats.hitsFromPeers += 1;
    this.stats.bytesFromPeers += expected.len;
    this.markPeerSuccess(peer, nowMs() - peer.lastAttemptAtMs);
    resolve({ peerPubkey: peer.peerPubkey, data: full });
  }

  private queueSend(peer: PeerConn, data: string | ArrayBuffer | ArrayBufferView): void {
    const dc = peer.dc;
    if (!dc || dc.readyState !== "open") return;

    peer.sendQueue = peer.sendQueue
      .then(() => {
        dc.send(data as any);
      })
      .catch(() => {
        // ignore
      });
  }

  private queueSendBinary(peer: PeerConn, data: ArrayBuffer): void {
    const chunkBytes = pickChunkBytes(peer.pc);
    for (let offset = 0; offset < data.byteLength; offset += chunkBytes) {
      this.queueSend(peer, data.slice(offset, Math.min(data.byteLength, offset + chunkBytes)));
    }
  }

  private closePeer(peerPubkey: string): void {
    const peer = this.peers.get(peerPubkey);
    if (!peer) return;
    this.peers.delete(peerPubkey);

    try {
      peer.dc?.close();
    } catch {
      // ignore
    }
    try {
      peer.pc.close();
    } catch {
      // ignore
    }

    if (peer.inflight) {
      clearTimeout(peer.inflight.timer);
      try {
        peer.inflight.resolve(null);
      } catch {
        // ignore
      }
      peer.inflight = undefined;
    }
    peer.expectBinary = undefined;
  }
}
