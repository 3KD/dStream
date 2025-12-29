"use client";

/**
 * WHIP (WebRTC-HTTP Ingestion Protocol) client for browser-to-server streaming
 * 
 * MediaMTX WHIP endpoint: POST /stream_key/whip
 * - Request: SDP offer
 * - Response: SDP answer
 */

const MEDIAMTX_URL = "http://localhost:8881"; // WebRTC/WHIP port

export class WHIPClient {
    private pc: RTCPeerConnection | null = null;
    private stream: MediaStream | null = null;
    private whipEndpoint: string;

    constructor(streamKey: string, queryParams?: string) {
        this.whipEndpoint = `${MEDIAMTX_URL}/${streamKey}/whip${queryParams ? `?${queryParams}` : ''}`;
    }

    async connect(mediaStream: MediaStream): Promise<void> {
        this.stream = mediaStream;

        // Create peer connection
        this.pc = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" }
            ]
        });

        // Add tracks from the media stream with H.264 preference for video
        for (const track of mediaStream.getTracks()) {
            const sender = this.pc.addTrack(track, mediaStream);
            console.log(`[WHIP] Added track: ${track.kind}`);

            // For video tracks, prefer H.264 codec (required for HLS compatibility)
            if (track.kind === 'video') {
                const transceiver = this.pc.getTransceivers().find(t => t.sender === sender);
                if (transceiver && transceiver.setCodecPreferences) {
                    const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs || [];
                    // Filter to only H.264 codecs
                    const h264Codecs = codecs.filter(c =>
                        c.mimeType.toLowerCase() === 'video/h264'
                    );
                    if (h264Codecs.length > 0) {
                        console.log(`[WHIP] Setting H.264 codec preference for HLS compatibility`);
                        transceiver.setCodecPreferences(h264Codecs);
                    } else {
                        console.warn(`[WHIP] H.264 not available, stream may not be viewable`);
                    }
                }
            }
        }

        // Create offer
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        // Wait for ICE gathering to complete (or timeout)
        await this.waitForIceGathering();

        // Send offer to WHIP endpoint
        console.log(`[WHIP] Sending offer to ${this.whipEndpoint}`);

        try {
            const response = await fetch(this.whipEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/sdp'
                },
                body: this.pc.localDescription?.sdp
            });

            if (!response.ok) {
                throw new Error(`WHIP request failed: ${response.status} ${response.statusText}`);
            }

            const answerSdp = await response.text();
            console.log(`[WHIP] Received answer`);

            // Apply answer
            await this.pc.setRemoteDescription({
                type: 'answer',
                sdp: answerSdp
            });

            console.log(`[WHIP] Connection established! Monitoring state...`);

            // Monitor connection states
            this.pc.oniceconnectionstatechange = () => {
                console.log(`[WHIP] ICE State: ${this.pc?.iceConnectionState}`);
            };
            this.pc.onconnectionstatechange = () => {
                console.log(`[WHIP] Connection State: ${this.pc?.connectionState}`);
            };

            // Log if we received candidate in answer
            if (answerSdp.includes("a=candidate")) {
                console.log(`[WHIP] Remote SDP contains candidates`);
                // Extract and log candidates for debugging
                const candidates = answerSdp.split('\n').filter(l => l.includes('a=candidate'));
                console.log(`[WHIP] Candidates:`, candidates);
            } else {
                console.warn(`[WHIP] Remote SDP has NO candidates (Server might be in Lite-ICE mode or failed gathering)`);
            }

        } catch (err) {
            console.error(`[WHIP] Failed to connect:`, err);
            throw err;
        }
    }

    private waitForIceGathering(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.pc) {
                resolve();
                return;
            }

            if (this.pc.iceGatheringState === 'complete') {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                console.log(`[WHIP] ICE gathering timeout, proceeding anyway`);
                resolve();
            }, 2000);

            this.pc.onicegatheringstatechange = () => {
                if (this.pc?.iceGatheringState === 'complete') {
                    clearTimeout(timeout);
                    resolve();
                }
            };
        });
    }

    disconnect(): void {
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        console.log(`[WHIP] Disconnected`);
    }

    get isConnected(): boolean {
        return this.pc?.connectionState === 'connected';
    }
}
