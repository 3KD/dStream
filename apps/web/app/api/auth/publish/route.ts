                                                                
import { NextRequest, NextResponse } from 'next/server';
import { deriveStreamPath } from '@/lib/streamId';
import * as ed from '@noble/ed25519';

// In-memory rate limiter (simple token bucket per IP)
// Note: In serverless, this resets often. In Docker container, it persists for the life of the process.
// Increased for dev: WebRTC reconnects frequently, each triggering an auth request
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const BLOCK_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 1000; // Increased from 100 - WebRTC is chatty

// MediaMTX sends a POST request with this structure
interface MediaMTXAuthPayload {
    action: string;      // 'publish' | 'read'
    path: string;        // The stream path (our derived hash)
    query: string;       // The query string from the URL
    ip: string;
}

export async function POST(req: NextRequest) {
    try {
        let body: MediaMTXAuthPayload;

        // Robust parsing: MediaMTX might send JSON, Form, or even plain text depending on version
        const contentType = req.headers.get('content-type') || '';
        console.log(`[Auth] Incoming request content-type: ${contentType}`);

        try {
            if (contentType.includes('application/json')) {
                body = await req.json();
            } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
                const formData = await req.formData();
                body = {
                    action: formData.get('action') as string || '',
                    path: formData.get('path') as string || '',
                    query: formData.get('query') as string || '',
                    ip: formData.get('ip') as string || ''
                };
            } else {
                // Final fallback: Try text and manual parse
                // Some older MediaMTX versions might send raw body
                const text = await req.text();
                try {
                    body = JSON.parse(text);
                } catch {
                    const params = new URLSearchParams(text);
                    body = {
                        action: params.get('action') as string || '',
                        path: params.get('path') as string || '',
                        query: params.get('query') as string || '',
                        ip: params.get('ip') as string || ''
                    };
                }
            }
        } catch (e) {
            console.error("[Auth] Failed to parse body:", e);
            return new NextResponse("Invalid Body Parsing", { status: 400 });
        }

        console.log(`[Auth] Publish request payload:`, body);

        // --- RATE LIMITING (Global Defense) ---
        // Basic Sybil/Leech Defense for both Publish and Read
        const requestIp = body.ip || 'unknown';
        const now = Date.now();
        const record = rateLimitMap.get(requestIp) || { count: 0, windowStart: now };

        if (now - record.windowStart > BLOCK_WINDOW_MS) {
            // New window
            record.count = 1;
            record.windowStart = now;
        } else {
            record.count++;
        }

        rateLimitMap.set(requestIp, record);

        if (record.count > MAX_REQUESTS_PER_MINUTE) {
            console.warn(`[Auth] Rate limit exceeded for IP ${requestIp}`);
            return new NextResponse("Rate limit exceeded", { status: 429 });
        }
        // ---------------------

        if (body.action !== 'publish') {
            // We only enforce strict crypto auth on publishing.
            // Reading is now Rate Limited but otherwise open (P2P/HLS).
            return new NextResponse("OK", { status: 200 });
        }

        // Allow unauthenticated test stream for ffsim
        if (body.path === 'test') {
            console.log(`[Auth] Bypassing auth for test path`);
            return new NextResponse("OK", { status: 200 });
        }

        const path = body.path; // This should be the hash
        const query = new URLSearchParams(body.query);

        const pubkey = query.get('pubkey');
        const signature = query.get('sig');
        const timestamp = query.get('t');
        const streamName = query.get('name'); // Original human name

        if (!pubkey || !signature || !streamName || !timestamp) {
            console.warn(`[Auth] Missing auth params for ${path}`);
            return new NextResponse("Missing params", { status: 401 });
        }

        // 0. Verify Timestamp (Replay Attack Protection)
        const ts = parseInt(timestamp);
        const verificationTime = Date.now();
        const MAX_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

        if (isNaN(ts) || Math.abs(verificationTime - ts) > MAX_WINDOW_MS) {
            console.warn(`[Auth] Timestamp expired or invalid: ${ts} (Now: ${verificationTime})`);
            return new NextResponse("Expired timestamp", { status: 401 });
        }

        // 1. Verify Binding: Hash(Pubkey + Name) === Path
        const expectedPath = await deriveStreamPath(pubkey, streamName);
        if (expectedPath !== path) {
            console.warn(`[Auth] Binding mismatch. Expected ${expectedPath}, got ${path}`);
            return new NextResponse("Invalid binding", { status: 401 });
        }

        // 2. Verify Ownership: Signature(Path + Timestamp) valid for Pubkey
        // Broadcaster signs "path:timestamp" to bind signature to this time window
        const message = `${path}:${timestamp}`;
        const messageBytes = new TextEncoder().encode(message);
        const signatureBytes = hexToBytes(signature);
        const pubkeyBytes = hexToBytes(pubkey);

        const isValid = await ed.verifyAsync(signatureBytes, messageBytes, pubkeyBytes);

        if (!isValid) {
            console.warn(`[Auth] Invalid signature for ${path}`);
            return new NextResponse("Invalid signature", { status: 401 });
        }

        console.log(`[Auth] Verified publish for ${streamName} (${path}) by ${pubkey} at ${new Date(ts).toISOString()}`);
        return new NextResponse("OK", { status: 200 });

    } catch (err: any) {
        console.error(`[Auth] Error:`, err);
        return new NextResponse("Internal Error", { status: 500 });
    }
}

function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}
