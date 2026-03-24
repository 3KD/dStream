import { getWebRtcIceServers } from "./webrtc";

export type WhipPublishOptions = {
  videoMaxBitrateKbps?: number;
  videoMaxFps?: number;
};

export class WhipClient {
  private pc: RTCPeerConnection | null = null;
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async publish(stream: MediaStream, options?: WhipPublishOptions): Promise<void> {
    if (this.pc) this.close();

    this.pc = new RTCPeerConnection({
      iceServers: getWebRtcIceServers()
    });

    stream.getTracks().forEach((track) => {
      this.pc?.addTrack(track, stream);
    });
    await this.applyPublishOptions(options);

    const offer = await this.pc.createOffer();
    const preferredSdp = this.preferH264(offer.sdp ?? "");
    await this.pc.setLocalDescription({ type: "offer", sdp: preferredSdp });

    await this.waitForIceGatheringComplete(this.pc);

    const answer = await this.postOffer(this.pc.localDescription!);
    await this.pc.setRemoteDescription(answer);
    await this.waitForConnected(this.pc, 10_000);
    try {
      await this.waitForOutboundMedia(this.pc, 3_000);
    } catch {
      // Some browsers delay outbound stats when tabs are backgrounded.
      // Treat this as non-fatal; HLS readiness checks on the app side still verify stream availability.
    }
  }

  private preferH264(sdp: string): string {
    const lines = sdp.split(/\r\n|\n/);

    const h264PayloadTypes = new Set<string>();
    const rtxPayloadTypes = new Map<string, string>(); // apt -> rtx pt

    for (const line of lines) {
      const match = line.match(/^a=rtpmap:(\d+) H264\/90000/i);
      if (match) h264PayloadTypes.add(match[1]);

      const rtxMatch = line.match(/^a=fmtp:(\d+) apt=(\d+)/);
      if (rtxMatch) rtxPayloadTypes.set(rtxMatch[2], rtxMatch[1]);
    }

    if (h264PayloadTypes.size === 0) return sdp;

    for (const h264Pt of Array.from(h264PayloadTypes)) {
      const rtx = rtxPayloadTypes.get(h264Pt);
      if (rtx) h264PayloadTypes.add(rtx);
    }

    const out = [...lines];
    for (let i = 0; i < out.length; i++) {
      const line = out[i] ?? "";
      if (!line.startsWith("m=video")) continue;

      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;

      const prefix = parts.slice(0, 3).join(" ");
      const originalPayloads = parts.slice(3);
      const preferred = originalPayloads.filter((pt) => h264PayloadTypes.has(pt));
      if (preferred.length === 0) continue;

      const rest = originalPayloads.filter((pt) => !h264PayloadTypes.has(pt));
      out[i] = `${prefix} ${preferred.join(" ")}${rest.length ? ` ${rest.join(" ")}` : ""}`;
    }

    // Normalize to the SDP-required CRLF line endings since some WebRTC stacks / WHIP servers
    // are strict about it.
    const joined = out.join("\r\n");
    return joined.endsWith("\r\n") ? joined : `${joined}\r\n`;
  }

  private async postOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp
    });

    if (!response.ok) {
      throw new Error(`WHIP error ${response.status}: ${await response.text()}`);
    }

    const answerSdp = await response.text();
    return { type: "answer", sdp: answerSdp };
  }

  private waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);

      const check = () => {
        if (pc.iceGatheringState === "complete") {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        window.clearTimeout(timer);
        try {
          pc.removeEventListener("icegatheringstatechange", check);
        } catch {
          // ignore
        }
      };

      pc.addEventListener("icegatheringstatechange", check);
      check();
    });
  }

  private waitForConnected(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
    if (pc.connectionState === "connected") return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("WHIP publish timed out waiting for peer connection."));
      }, timeoutMs);

      const onStateChange = () => {
        if (pc.connectionState === "connected") {
          cleanup();
          resolve();
          return;
        }
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
          cleanup();
          reject(new Error(`WHIP peer connection ${pc.connectionState}.`));
        }
      };

      const cleanup = () => {
        window.clearTimeout(timer);
        try {
          pc.removeEventListener("connectionstatechange", onStateChange);
        } catch {
          // ignore
        }
      };

      pc.addEventListener("connectionstatechange", onStateChange);
      onStateChange();
    });
  }

  private async waitForOutboundMedia(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
    const sender =
      pc.getSenders().find((value) => value.track?.kind === "video") ??
      pc.getSenders().find((value) => value.track?.kind === "audio") ??
      null;
    if (!sender || !sender.track) throw new Error("WHIP publish has no active media sender.");

    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const stats = await sender.getStats();
        for (const report of stats.values()) {
          if (report.type !== "outbound-rtp") continue;
          const bytesSent = Number((report as any).bytesSent ?? 0);
          const packetsSent = Number((report as any).packetsSent ?? 0);
          if (bytesSent > 0 || packetsSent > 0) return;
        }
      } catch {
        // ignore, keep polling
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }

    throw new Error(
      "WHIP connected but no outbound media was detected. Keep the source tab visible and confirm camera/screen permissions."
    );
  }

  private async applyPublishOptions(options?: WhipPublishOptions): Promise<void> {
    if (!this.pc) return;
    if (!options) return;

    const sender = this.pc.getSenders().find((value) => value.track?.kind === "video");
    if (!sender) return;

    const maxBitrate = typeof options.videoMaxBitrateKbps === "number" && Number.isFinite(options.videoMaxBitrateKbps)
      ? Math.trunc(options.videoMaxBitrateKbps * 1000)
      : null;
    const maxFramerate = typeof options.videoMaxFps === "number" && Number.isFinite(options.videoMaxFps)
      ? Math.trunc(options.videoMaxFps)
      : null;
    if ((!maxBitrate || maxBitrate <= 0) && (!maxFramerate || maxFramerate <= 0)) return;

    const params = sender.getParameters();
    const encodings = Array.isArray(params.encodings) && params.encodings.length > 0 ? params.encodings : [{}];
    params.encodings = encodings.map((encoding) => {
      const next = { ...encoding };
      if (maxBitrate && maxBitrate > 0) next.maxBitrate = maxBitrate;
      if (maxFramerate && maxFramerate > 0) next.maxFramerate = maxFramerate;
      return next;
    });

    try {
      await sender.setParameters(params);
    } catch {
      // Browser/codec combinations vary; publish continues with defaults if setParameters fails.
    }
  }

  close() {
    this.pc?.close();
    this.pc = null;
  }
}
