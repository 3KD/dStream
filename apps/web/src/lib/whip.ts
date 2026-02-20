export class WhipClient {
    private pc: RTCPeerConnection | null = null;
    private endpoint: string;

    constructor(endpoint: string) {
        this.endpoint = endpoint;
    }

    async publish(stream: MediaStream): Promise<void> {
        if (this.pc) this.close();

        this.pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });

        // Add tracks to the peer connection
        stream.getTracks().forEach(track => {
            if (this.pc) {
                this.pc.addTrack(track, stream);
                console.log(`[WHIP] Added ${track.kind} track: ${track.label}`);
            }
        });

        // Create Offer
        const offer = await this.pc.createOffer();

        // Force H264 codec for HLS compatibility (MediaMTX HLS muxer only supports H264)
        const h264Sdp = this.forceH264(offer.sdp!);
        await this.pc.setLocalDescription({ type: 'offer', sdp: h264Sdp });

        // Wait for ICE gathering to complete (simplifies WHIP compatibility)
        await this.waitForIceGatheringComplete(this.pc);

        // Send to MediaMTX
        const answer = await this.postOffer(this.pc.localDescription!);
        await this.pc.setRemoteDescription(answer);
    }

    private forceH264(sdp: string): string {
        const lines = sdp.split('\r\n');
        const result: string[] = [];

        // Find H264 payload types
        const h264PayloadTypes = new Set<string>();
        const rtxPayloadTypes = new Map<string, string>(); // apt -> rtx pt

        for (const line of lines) {
            // a=rtpmap:96 H264/90000
            const match = line.match(/^a=rtpmap:(\d+) H264\/90000/i);
            if (match) {
                h264PayloadTypes.add(match[1]);
            }
            // a=fmtp:97 apt=96 (RTX for H264)
            const rtxMatch = line.match(/^a=fmtp:(\d+) apt=(\d+)/);
            if (rtxMatch) {
                rtxPayloadTypes.set(rtxMatch[2], rtxMatch[1]);
            }
        }

        if (h264PayloadTypes.size === 0) {
            console.error('[WHIP] No H264 codec found in SDP. HLS playback will NOT work.');
            // We could throw here, but let's try to proceed so at least low-latency WebRTC might work
            // if the receiver supports other codecs.
            return sdp;
        }

        // Add RTX for H264
        for (const h264Pt of h264PayloadTypes) {
            if (rtxPayloadTypes.has(h264Pt)) {
                h264PayloadTypes.add(rtxPayloadTypes.get(h264Pt)!);
            }
        }

        console.log('[WHIP] Forcing H264 - using payload types:', Array.from(h264PayloadTypes));

        let inVideoSection = false;

        for (const line of lines) {
            // Detect video section start
            if (line.startsWith('m=video')) {
                inVideoSection = true;
                // Rewrite m=video line to only include H264 payload types
                const parts = line.split(' ');
                const port = parts[1];
                const proto = parts[2];
                const originalPayloads = parts.slice(3);
                const h264Payloads = originalPayloads.filter(pt => h264PayloadTypes.has(pt));

                if (h264Payloads.length > 0) {
                    result.push(`m=video ${port} ${proto} ${h264Payloads.join(' ')}`);
                } else {
                    result.push(line); // Fallback to original
                }
                continue;
            }

            // Detect section end
            if (line.startsWith('m=') && !line.startsWith('m=video')) {
                inVideoSection = false;
            }

            // Filter video section lines
            if (inVideoSection) {
                // Keep lines that reference H264 payload types or are not codec-specific
                const ptMatch = line.match(/^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)/);
                if (ptMatch) {
                    if (h264PayloadTypes.has(ptMatch[1])) {
                        result.push(line);
                    }
                    // Skip non-H264 codec lines
                    continue;
                }
            }

            result.push(line);
        }

        return result.join('\r\n');
    }

    private async postOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: offer.sdp
        });

        if (!response.ok) {
            throw new Error(`WHIP Error ${response.status}: ${await response.text()}`);
        }

        const answerSdp = await response.text();
        return { type: 'answer', sdp: answerSdp };
    }

    private waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
        if (pc.iceGatheringState === 'complete') return Promise.resolve();
        return new Promise(resolve => {
            const check = () => {
                if (pc.iceGatheringState === 'complete') {
                    pc.removeEventListener('icegatheringstatechange', check);
                    resolve();
                }
            };
            pc.addEventListener('icegatheringstatechange', check);
        });
    }

    close() {
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
    }
}
