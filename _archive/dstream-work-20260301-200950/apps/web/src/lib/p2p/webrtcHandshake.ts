import { type P2PSignalPayloadV1 } from "@dstream/protocol";
import { SimplePool } from "nostr-tools";
import { createLocalSignalIdentity } from "./localIdentity";
import { createP2PSignalClient } from "./nostrSignal";
import { getDefaultRtcConfig } from "../webrtc";

function now() {
  return Date.now();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomSessionId(bytes = 16): string {
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

function hashFnv1a32(buf: ArrayBuffer): number {
  const bytes = new Uint8Array(buf);
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function runP2PDataChannelHandshake(opts: {
  relays: string[];
  streamPubkey: string;
  streamId: string;
  swarmId?: string;
  rtcConfig?: RTCConfiguration;
  timeoutMs?: number;
  onLog?: (line: string) => void;
}): Promise<{ ok: boolean; reason?: string }> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const deadline = now() + timeoutMs;
  const log = (line: string) => opts.onLog?.(line);
  const rtcConfig = opts.rtcConfig ?? getDefaultRtcConfig();

  const alice = createLocalSignalIdentity();
  const bob = createLocalSignalIdentity();
  const sessionId = randomSessionId();
  const alicePool = new SimplePool();
  const bobPool = new SimplePool();

  log(`P2P: alice=${alice.pubkey.slice(0, 8)}… bob=${bob.pubkey.slice(0, 8)}… session=${sessionId.slice(0, 8)}…`);

  const aliceSignal = createP2PSignalClient({
    identity: alice,
    relays: opts.relays,
    streamPubkey: opts.streamPubkey,
    streamId: opts.streamId,
    label: "alice-signal",
    onLog: log,
    pool: alicePool
  });
  const bobSignal = createP2PSignalClient({
    identity: bob,
    relays: opts.relays,
    streamPubkey: opts.streamPubkey,
    streamId: opts.streamId,
    label: "bob-signal",
    onLog: log,
    pool: bobPool
  });

  let alicePc: RTCPeerConnection | null = null;
  let bobPc: RTCPeerConnection | null = null;
  let aliceDc: RTCDataChannel | null = null;
  let bobDc: RTCDataChannel | null = null;

  const alicePendingCandidates: RTCIceCandidateInit[] = [];
  const bobPendingCandidates: RTCIceCandidateInit[] = [];

  const closeAll = () => {
    try {
      aliceDc?.close();
    } catch {
      // ignore
    }
    try {
      bobDc?.close();
    } catch {
      // ignore
    }
    try {
      alicePc?.close();
    } catch {
      // ignore
    }
    try {
      bobPc?.close();
    } catch {
      // ignore
    }
    aliceDc = null;
    bobDc = null;
    alicePc = null;
    bobPc = null;
  };

  const makeBase = (type: P2PSignalPayloadV1["type"]): Omit<P2PSignalPayloadV1, "sdp" | "candidate"> => ({
    v: 1,
    type,
    sessionId,
    streamPubkey: opts.streamPubkey,
    streamId: opts.streamId,
    swarmId: opts.swarmId
  });

  const aliceSub = aliceSignal.subscribe(async (msg) => {
    if (msg.payload.sessionId !== sessionId) return;
    if (msg.fromPubkey !== bob.pubkey) return;

    if (msg.payload.type === "answer") log("P2P: alice received answer");
    if (msg.payload.type === "answer" && typeof msg.payload.sdp === "string") {
      if (!alicePc) return;
      await alicePc.setRemoteDescription({ type: "answer", sdp: msg.payload.sdp });
      log("P2P: alice setRemoteDescription(answer)");
      for (const c of alicePendingCandidates.splice(0)) {
        try {
          await alicePc.addIceCandidate(c);
        } catch {
          // ignore
        }
      }
    }

    if (msg.payload.type === "candidate" && msg.payload.candidate) {
      if (!alicePc || !alicePc.remoteDescription) {
        alicePendingCandidates.push(msg.payload.candidate);
        return;
      }
      try {
        await alicePc.addIceCandidate(msg.payload.candidate);
      } catch {
        // ignore
      }
    }
  });

  const bobSub = bobSignal.subscribe(async (msg) => {
    if (msg.payload.sessionId !== sessionId) return;
    if (msg.fromPubkey !== alice.pubkey) return;

    if (msg.payload.type === "offer" && typeof msg.payload.sdp === "string") {
      log("P2P: bob received offer");
      if (!bobPc) {
        bobPc = new RTCPeerConnection(rtcConfig);
        bobPc.onconnectionstatechange = () => log(`P2P: bob connection=${bobPc?.connectionState ?? "?"}`);
        bobPc.oniceconnectionstatechange = () => log(`P2P: bob ice=${bobPc?.iceConnectionState ?? "?"}`);
        bobPc.onicecandidate = (ev) => {
          if (!ev.candidate) return;
          void bobSignal.send(alice.pubkey, {
            ...makeBase("candidate"),
            candidate: candidateToInit(ev.candidate)
          } as P2PSignalPayloadV1);
        };
        bobPc.ondatachannel = (ev) => {
          bobDc = ev.channel;
          bobDc.binaryType = "arraybuffer";
          bobDc.onopen = () => log("P2P: bob datachannel open");
          bobDc.onmessage = (e) => {
            const data: any = (e as any).data;
            if (typeof data === "string") {
              if (data !== "ping") return;
              try {
                bobDc?.send("pong");
              } catch {
                // ignore
              }
              return;
            }

            if (data instanceof ArrayBuffer) {
              try {
                bobDc?.send(data);
              } catch {
                // ignore
              }
            }
          };
        };
      }

      await bobPc.setRemoteDescription({ type: "offer", sdp: msg.payload.sdp });
      log("P2P: bob setRemoteDescription(offer)");

      for (const c of bobPendingCandidates.splice(0)) {
        try {
          await bobPc.addIceCandidate(c);
        } catch {
          // ignore
        }
      }

      const answer = await bobPc.createAnswer();
      await bobPc.setLocalDescription(answer);
      if (!bobPc.localDescription) throw new Error("bob localDescription missing after setLocalDescription");

      await bobSignal.send(alice.pubkey, {
        ...makeBase("answer"),
        sdp: bobPc.localDescription.sdp
      } as P2PSignalPayloadV1);
      log("P2P: bob sent answer");
    }

    if (msg.payload.type === "candidate" && msg.payload.candidate) {
      if (!bobPc || !bobPc.remoteDescription) {
        bobPendingCandidates.push(msg.payload.candidate);
        return;
      }
      try {
        await bobPc.addIceCandidate(msg.payload.candidate);
      } catch {
        // ignore
      }
    }
  });

  try {
    void aliceSub.ready.then(() => log("P2P: alice subscription ready"));
    void bobSub.ready.then(() => log("P2P: bob subscription ready"));

    alicePc = new RTCPeerConnection(rtcConfig);
    alicePc.onconnectionstatechange = () => log(`P2P: alice connection=${alicePc?.connectionState ?? "?"}`);
    alicePc.oniceconnectionstatechange = () => log(`P2P: alice ice=${alicePc?.iceConnectionState ?? "?"}`);
    alicePc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      void aliceSignal.send(bob.pubkey, {
        ...makeBase("candidate"),
        candidate: candidateToInit(ev.candidate)
      } as P2PSignalPayloadV1);
    };

    aliceDc = alicePc.createDataChannel("dstream");
    aliceDc.binaryType = "arraybuffer";
    aliceDc.onopen = () => log("P2P: alice datachannel open");

    const readyTimeoutMs = Math.max(0, Math.min(8000, deadline - now()));
    const readyOk = await Promise.race([
      Promise.all([aliceSub.ready, bobSub.ready]).then(() => true),
      sleep(readyTimeoutMs).then(() => false)
    ]);
    log(`P2P: subscriptions ${readyOk ? "ready" : "not ready (continuing anyway)"}`);

    const pongPromise = new Promise<void>((resolve, reject) => {
      if (!aliceDc) return reject(new Error("data channel missing"));

      const timer = setTimeout(() => reject(new Error("timeout waiting for pong")), Math.max(0, deadline - now()));
      const handler = (e: MessageEvent) => {
        if (String((e as any).data) !== "pong") return;
        clearTimeout(timer);
        aliceDc?.removeEventListener("message", handler as any);
        resolve();
      };
      aliceDc.addEventListener("message", handler as any);
    });

    const offer = await alicePc.createOffer();
    await alicePc.setLocalDescription(offer);
    if (!alicePc.localDescription) throw new Error("alice localDescription missing after setLocalDescription");

    const offerOk = await aliceSignal.send(bob.pubkey, {
      ...makeBase("offer"),
      sdp: alicePc.localDescription.sdp
    } as P2PSignalPayloadV1);
    if (!offerOk.ok) throw new Error("failed to publish offer");

    log("P2P: alice sent offer");

    // Give the data channel a moment to open after signaling completes.
    while (aliceDc.readyState !== "open" && now() < deadline) {
      await sleep(50);
    }
    if (aliceDc.readyState !== "open") throw new Error(`data channel never opened (state=${aliceDc.readyState})`);

    aliceDc.send("ping");
    await pongPromise;

    log("P2P: datachannel ping/pong ok");

    const binaryBytes = 64 * 1024;
    const chunkBytes = 4 * 1024;
    const payload = new Uint8Array(binaryBytes);
    (globalThis as any).crypto.getRandomValues(payload);
    const expectedHash = hashFnv1a32(payload.buffer);

    if (!aliceDc) throw new Error("data channel missing");

    const queue: ArrayBuffer[] = [];
    let wake: (() => void) | null = null;
    const onMessage = (e: MessageEvent) => {
      const data: any = (e as any).data;
      if (!(data instanceof ArrayBuffer)) return;
      queue.push(data);
      wake?.();
    };
    aliceDc.addEventListener("message", onMessage as any);

    const waitForChunk = async (): Promise<ArrayBuffer> => {
      if (queue.length) return queue.shift()!;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          wake = null;
          reject(new Error("timeout waiting for binary echo"));
        }, Math.max(0, deadline - now()));
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
      });
      const next = queue.shift();
      if (!next) throw new Error("binary echo: missing chunk");
      return next;
    };

    try {
      const out = new Uint8Array(binaryBytes);
      let received = 0;

      for (let offset = 0; offset < payload.byteLength; offset += chunkBytes) {
        const expectedChunk = payload.subarray(offset, Math.min(payload.byteLength, offset + chunkBytes));
        try {
          aliceDc.send(expectedChunk.slice().buffer);
        } catch (e: any) {
          throw new Error(`send failed at offset=${offset} buffered=${aliceDc.bufferedAmount}: ${e?.message ?? String(e)}`);
        }

        const echoed = await waitForChunk();
        if (echoed.byteLength !== expectedChunk.byteLength) {
          throw new Error(`echo length mismatch (${echoed.byteLength} != ${expectedChunk.byteLength})`);
        }
        out.set(new Uint8Array(echoed), received);
        received += echoed.byteLength;
      }

      if (received !== binaryBytes) throw new Error(`binary echo: incomplete (${received} != ${binaryBytes})`);
      const gotHash = hashFnv1a32(out.buffer);
      if (gotHash !== expectedHash) throw new Error(`binary hash mismatch (${gotHash} != ${expectedHash})`);
    } finally {
      aliceDc.removeEventListener("message", onMessage as any);
      wake = null;
      queue.length = 0;
    }

    log(`P2P binary echo: ok (${binaryBytes} bytes, chunk=${chunkBytes})`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  } finally {
    try {
      aliceSub.close();
    } catch {
      // ignore
    }
    try {
      bobSub.close();
    } catch {
      // ignore
    }
    try {
      alicePool.destroy();
    } catch {
      // ignore
    }
    try {
      bobPool.destroy();
    } catch {
      // ignore
    }
    closeAll();
  }
}
