"use client";

/**
 * Custom WHIP Client Implementation
 * 
 * This implementation uses RTCRtpSender.setCodecPreferences() to prioritize H.264
 * without breaking support for other codecs.
 * 
 * MediaMTX HLS requires H.264. By sorting H.264 to the top of the list,
 * we tell the browser to offer H.264 as the preferred codec in the SDP.
 * MediaMTX should then select it if supported.
 */

const MEDIAMTX_URL = "/whip"; // Proxy endpoint -> :8889

export class WHIPClient {
    private pc: RTCPeerConnection | null = null;
    private whipEndpoint: string;
    private resourceUrl: string | null = null;
    private _isConnected: boolean = false;

    constructor(streamKey: string, queryParams?: string) {
        // Construct endpoint: /whip/streamKey (Proxy rewrites to /streamKey/whip for MediaMTX)
        this.whipEndpoint = `${window.location.origin}${MEDIAMTX_URL}/${streamKey}${queryParams ? `?${queryParams}` : ''}`;
    }

    async connect(mediaStream: MediaStream): Promise<void> {
        console.log(`[WHIP] Connecting to ${this.whipEndpoint}`);
        console.log(`[WHIP] Stream tracks: ${mediaStream.getTracks().map(t => `${t.kind}:${t.label}`).join(', ')}`);

        try {
            // Create peer connection with STUN server
            this.pc = new RTCPeerConnection({
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
            });

            // Add tracks to the peer connection
            for (const track of mediaStream.getTracks()) {
                const sender = this.pc.addTrack(track, mediaStream);

                // If this is a video track, set codec preferences to prefer H.264
                if (track.kind === 'video') {
                    const capabilities = RTCRtpSender.getCapabilities('video');
                    if (capabilities) {
                        try {
                            console.log('[WHIP] Reordering codecs to prefer H.264...');
                            // Sort codecs to put H.264 first, but keep others as fallback
                            // We construct a new array containing the exact codec objects from capabilities
                            const allCodecs = capabilities.codecs;
                            const h264Codecs = allCodecs.filter(c => c.mimeType.toLowerCase() === 'video/h264');
                            const otherCodecs = allCodecs.filter(c => c.mimeType.toLowerCase() !== 'video/h264');

                            // Log available H.264 profiles
                            h264Codecs.forEach(c => {
                                console.log(`[WHIP] found H.264 candidate: fmtp=${c.sdpFmtpLine || 'none'}`);
                            });

                            // Prioritize Baseline (42e01f) if possible as it is most compatible
                            // But usually putting all H.264 first is enough
                            const sortedCodecs = [...h264Codecs, ...otherCodecs];

                            const transceivers = this.pc.getTransceivers();
                            const videoTransceiver = transceivers.find(t => t.sender === sender);

                            if (videoTransceiver && typeof videoTransceiver.setCodecPreferences === 'function') {
                                videoTransceiver.setCodecPreferences(sortedCodecs);
                                console.log('[WHIP] Codec preferences set. Top 3:',
                                    sortedCodecs.slice(0, 3).map(c => c.mimeType));
                            } else {
                                console.warn('[WHIP] setCodecPreferences not supported on this transceiver');
                            }
                        } catch (e) {
                            console.warn('[WHIP] Failed to set codec preferences:', e);
                        }
                    }
                }
                console.log(`[WHIP] Added ${track.kind} track: ${track.label}`);
            }

            // Create offer
            const offer = await this.pc.createOffer();

            if (!offer.sdp) {
                throw new Error('No SDP in offer');
            }

            // Analyze the generated SDP to verify our sorting worked
            const videoBlock = offer.sdp.split('m=video')[1]?.split('m=')[0];
            if (videoBlock) {
                const firstPayload = videoBlock.trim().split(' ')[0]; // Gets the first payload type number? No, m=video <port> <proto> <fmt>...
                // The m= line format is: m=<media> <port> <proto> <fmt> ...
                const mLine = offer.sdp.match(/m=video \d+ [A-Z/]+ (.*)/);
                if (mLine) {
                    const topPayloads = mLine[1].split(' ').slice(0, 3);
                    console.log(`[WHIP] Top 3 preferred payload types in SDP: ${topPayloads.join(', ')}`);

                    // Find what these correspond to
                    topPayloads.forEach(pt => {
                        const rtpMap = offer.sdp?.match(new RegExp(`a=rtpmap:${pt} ([a-zA-Z0-9/-]+)`));
                        if (rtpMap) {
                            console.log(`[WHIP] Payload ${pt} maps to ${rtpMap[1]}`);
                        }
                    });
                }
            }

            await this.pc.setLocalDescription(offer);

            // Wait for ICE gathering
            if (this.pc.iceGatheringState !== 'complete') {
                await new Promise<void>((resolve) => {
                    const checkState = () => {
                        if (this.pc?.iceGatheringState === 'complete') {
                            resolve();
                        }
                    };
                    this.pc!.addEventListener('icegatheringstatechange', checkState);
                    checkState();
                    // Short timeout is fine for trickle, but WHIP usually wants full offer or specific handling
                    setTimeout(resolve, 5000);
                });
            }

            // Get the final offer with ICE candidates
            const finalOffer = this.pc.localDescription;
            if (!finalOffer?.sdp) {
                throw new Error('No local description available');
            }

            // Send offer to WHIP endpoint
            console.log(`[WHIP] Sending offer to ${this.whipEndpoint}`);
            const response = await fetch(this.whipEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/sdp',
                },
                body: finalOffer.sdp,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`WHIP offer rejected: ${response.status} - ${errorText}`);
            }

            // Get resource URL for later deletion
            this.resourceUrl = response.headers.get('Location') || null;
            console.log(`[WHIP] Resource URL: ${this.resourceUrl}`);

            // Parse answer SDP
            const answerSdp = await response.text();
            console.log('[WHIP] Got SDP answer from server');

            // Log server choice
            const mLineAnswer = answerSdp.match(/m=video \d+ [A-Z/]+ ([0-9]+)/);
            if (mLineAnswer) {
                const selectedPayload = mLineAnswer[1];
                const rtpMap = answerSdp.match(new RegExp(`a=rtpmap:${selectedPayload} ([a-zA-Z0-9/-]+)`));
                if (rtpMap) {
                    console.log(`[WHIP] Server ANSWER selected codec: ${rtpMap[1]}`);
                    if (rtpMap[1].toLowerCase().includes('vp8')) {
                        console.warn('[WHIP] Warning: Server chose VP8. HLS streaming will fail.');
                        console.warn('[WHIP] This likely means MediaMTX rejected the offered H.264 profiles.');
                    }
                }
            }

            await this.pc.setRemoteDescription({
                type: 'answer',
                sdp: answerSdp,
            });

            // Monitor connection state
            this.pc.addEventListener('connectionstatechange', () => {
                console.log(`[WHIP] Connection state: ${this.pc?.connectionState}`);
                if (this.pc?.connectionState === 'connected') {
                    this._isConnected = true;
                } else if (this.pc?.connectionState === 'failed' || this.pc?.connectionState === 'disconnected') {
                    this._isConnected = false;
                }
            });

            this._isConnected = true;
            console.log('[WHIP] Connection established!');

        } catch (err) {
            console.error(`[WHIP] Failed to connect:`, err);
            this._isConnected = false;
            throw err;
        }
    }

    disconnect(): void {
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }

        // Optionally DELETE the WHIP resource
        if (this.resourceUrl) {
            fetch(this.resourceUrl, { method: 'DELETE' }).catch(() => {
                // Ignore errors
            });
            this.resourceUrl = null;
        }

        this._isConnected = false;
        console.log('[WHIP] Disconnected');
    }

    get isConnected(): boolean {
        return this._isConnected;
    }
}
