import { getWebRtcIceServers } from "./webrtc";

export interface WhepStartResult {
  pc: RTCPeerConnection;
  sessionUrl: string | null;
  stream: MediaStream;
}

function normalizeSdp(sdp: string): string {
  const lines = sdp.split(/\r\n|\n/);
  const joined = lines.join("\r\n");
  return joined.endsWith("\r\n") ? joined : `${joined}\r\n`;
}

function extractIceCreds(sdp: string): { ufrag: string; pwd: string } | null {
  const ufrag = sdp.match(/^a=ice-ufrag:(.+)$/m)?.[1]?.trim() ?? "";
  const pwd = sdp.match(/^a=ice-pwd:(.+)$/m)?.[1]?.trim() ?? "";
  if (!ufrag || !pwd) return null;
  return { ufrag, pwd };
}

function makeTrickleFragment(opts: { sdp: string; candidates: string[]; end: boolean }): string {
  const creds = extractIceCreds(opts.sdp);
  const lines: string[] = [];

  if (creds) {
    lines.push(`a=ice-ufrag:${creds.ufrag}`);
    lines.push(`a=ice-pwd:${creds.pwd}`);
  }

  for (const c of opts.candidates) {
    const trimmed = (c ?? "").trim();
    if (!trimmed) continue;
    // candidate strings are usually "candidate:..." (without the leading "a=")
    lines.push(trimmed.startsWith("candidate:") ? `a=${trimmed}` : trimmed.startsWith("a=candidate:") ? trimmed : `a=${trimmed}`);
  }

  if (opts.end) lines.push("a=end-of-candidates");
  return normalizeSdp(lines.join("\r\n"));
}

function waitForTrack(pc: RTCPeerConnection, timeoutMs: number): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WHEP: timed out waiting for remote track."));
    }, timeoutMs);

    const onTrack = (ev: RTCTrackEvent) => {
      const stream = ev.streams?.[0];
      if (stream) {
        cleanup();
        resolve(stream);
        return;
      }

      const ms = new MediaStream();
      ms.addTrack(ev.track);
      cleanup();
      resolve(ms);
    };

    const cleanup = () => {
      clearTimeout(timer);
      try {
        pc.removeEventListener("track", onTrack);
      } catch {
        // ignore
      }
    };

    pc.addEventListener("track", onTrack);
  });
}

async function postOffer(endpoint: string, offerSdp: string): Promise<{ answerSdp: string; sessionUrl: string | null }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/sdp" },
    body: offerSdp
  });

  if (!response.ok) {
    throw new Error(`WHEP error ${response.status}: ${await response.text()}`);
  }

  const answerSdp = await response.text();
  const location = response.headers.get("location");
  return { answerSdp, sessionUrl: location ? location.trim() : null };
}

async function patchCandidates(sessionUrl: string, fragmentSdp: string): Promise<void> {
  await fetch(sessionUrl, {
    method: "PATCH",
    headers: {
      "content-type": "application/trickle-ice-sdpfrag",
      "if-match": "*"
    },
    body: fragmentSdp
  }).catch(() => undefined);
}

async function deleteSession(sessionUrl: string): Promise<void> {
  await fetch(sessionUrl, { method: "DELETE" }).catch(() => undefined);
}

export class WhepClient {
  private pc: RTCPeerConnection | null = null;
  private sessionUrl: string | null = null;
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async start(opts?: { timeoutMs?: number }): Promise<WhepStartResult> {
    if (this.pc) await this.close();

    const pc = new RTCPeerConnection({ iceServers: getWebRtcIceServers() });
    this.pc = pc;

    // Receive-only. MediaMTX may expose only video, but requesting audio is harmless.
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    const trackTimeoutMs = opts?.timeoutMs ?? 3500;
    const trackPromise = waitForTrack(pc, trackTimeoutMs);

    const offer = await pc.createOffer();
    await pc.setLocalDescription({ type: "offer", sdp: normalizeSdp(offer.sdp ?? "") });

    const localSdp = pc.localDescription?.sdp ?? "";

    const candidates: string[] = [];
    let end = false;
    let sessionUrl: string | null = null;

    const flush = async () => {
      if (!sessionUrl) return;
      if (candidates.length === 0 && !end) return;
      const batch = candidates.splice(0, candidates.length);
      const frag = makeTrickleFragment({ sdp: localSdp, candidates: batch, end });
      end = false;
      await patchCandidates(sessionUrl, frag);
    };

    pc.addEventListener("icecandidate", (ev) => {
      if (ev.candidate?.candidate) candidates.push(ev.candidate.candidate);
      if (!ev.candidate) end = true;
      void flush();
    });

    const { answerSdp, sessionUrl: location } = await postOffer(this.endpoint, normalizeSdp(localSdp));
    sessionUrl = location && /^https?:\/\//.test(location) ? location : location ? location : null;
    this.sessionUrl = sessionUrl;

    await pc.setRemoteDescription({ type: "answer", sdp: normalizeSdp(answerSdp) });
    void flush();

    const stream = await trackPromise;
    return { pc, sessionUrl: this.sessionUrl, stream };
  }

  async close(): Promise<void> {
    try {
      this.pc?.close();
    } catch {
      // ignore
    } finally {
      this.pc = null;
    }

    if (this.sessionUrl) {
      const url = this.sessionUrl;
      this.sessionUrl = null;
      await deleteSession(url);
    }
  }
}

