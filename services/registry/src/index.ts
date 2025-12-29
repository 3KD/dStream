import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import * as crypto from 'crypto';

const fastify = Fastify({ logger: true });

fastify.register(cors, { origin: '*' });
fastify.register(websocket);

// Verify Ed25519 signature
async function verifySignature(message: string, signatureHex: string, publicKeyHex: string): Promise<boolean> {
    try {
        const signature = Buffer.from(signatureHex, 'hex');
        const publicKey = Buffer.from(publicKeyHex, 'hex');
        const messageBytes = Buffer.from(message);

        return crypto.verify(
            null,
            messageBytes,
            {
                key: publicKey,
                format: 'raw',
                type: 'public'
            } as any,
            signature
        );
    } catch (e) {
        // Fallback for Node versions that need slightly different params
        try {
            return crypto.verify(
                undefined,
                Buffer.from(message),
                crypto.createPublicKey({
                    key: Buffer.concat([
                        Buffer.from('302a300506032b6570032100', 'hex'),
                        Buffer.from(publicKeyHex, 'hex')
                    ]),
                    format: 'der',
                    type: 'spki'
                }),
                Buffer.from(signatureHex, 'hex')
            );
        } catch (innerError) {
            console.error('Signature verification error:', e, innerError);
            return false;
        }
    }
}

interface ActiveStream {
    pubkey: string;
    stream_id: string;
    last_announce: number;
    metadata: any;
    verified: boolean;
}

const activeStreams = new Map<string, ActiveStream>();
const TTL = 60 * 1000; // 60 seconds TTL

// Add demo channels on startup
const demoChannels = [
    { id: 'test', title: 'Test Pattern Stream', desc: 'FFmpeg test pattern' },
    { id: 'gaming', title: 'Gaming Stream', desc: 'Live gameplay' },
    { id: 'music', title: 'Music Channel', desc: 'Lo-fi beats' },
    { id: 'coding', title: 'Coding Live', desc: 'Building cool stuff' },
    { id: 'art', title: 'Digital Art', desc: 'Creating digital art' },
];

demoChannels.forEach((ch, i) => {
    const fakePubkey = `demo_${ch.id}_${'0'.repeat(48)}`.substring(0, 64);
    activeStreams.set(fakePubkey, {
        pubkey: fakePubkey,
        stream_id: ch.id,
        last_announce: Date.now() + (i * 1000),
        metadata: { title: ch.title, description: ch.desc },
        verified: false // Demo channels are unverified
    });
});

// Refresh demo channels periodically
setInterval(() => {
    demoChannels.forEach((ch) => {
        const fakePubkey = `demo_${ch.id}_${'0'.repeat(48)}`.substring(0, 64);
        const existing = activeStreams.get(fakePubkey);
        if (existing) {
            existing.last_announce = Date.now();
        }
    });
}, 30_000);

// --- Registry Endpoints ---

fastify.post('/announce', async (request, reply) => {
    const body: any = request.body;
    const { pubkey, stream_id, signature, metadata } = body;

    // Verify signature if provided
    let verified = false;
    if (signature && pubkey) {
        // Create canonical message for verification
        const messageToVerify = JSON.stringify({
            type: body.type || 'STREAM_ANNOUNCE',
            pubkey,
            stream_id,
            metadata
        });
        verified = await verifySignature(messageToVerify, signature, pubkey);

        if (!verified) {
            console.log(`[ANNOUNCE] Invalid signature from ${pubkey.substring(0, 16)}...`);
        } else {
            console.log(`[ANNOUNCE] ✓ Verified signature from ${pubkey.substring(0, 16)}...`);
        }
    }

    activeStreams.set(pubkey, {
        pubkey,
        stream_id: stream_id || 'default',
        last_announce: Date.now(),
        metadata: metadata || {},
        verified
    });

    return { status: 'acknowledged', ttl: TTL, verified };
});

fastify.get('/streams', async (request, reply) => {
    const now = Date.now();
    const streams: ActiveStream[] = [];

    for (const [key, stream] of activeStreams.entries()) {
        if (now - stream.last_announce > TTL) {
            activeStreams.delete(key);
        } else {
            streams.push(stream);
        }
    }

    return streams;
});

fastify.get('/stream/:streamId', async (request, reply) => {
    const { streamId } = request.params as { streamId: string };

    // Find stream by ID (inefficient map scan but fine for MVP)
    for (const stream of activeStreams.values()) {
        if (stream.stream_id === streamId || (streamId === 'test' && stream.stream_id === 'test')) {
            return stream;
        }
    }
    return reply.code(404).send({ error: 'Stream not found' });
});

// Viewer count endpoint
fastify.get('/viewers/:room', async (request, reply) => {
    const { room } = request.params as { room: string };
    const clients = chatRooms.get(room);
    return {
        room,
        viewers: clients?.size || 0
    };
});

// --- Chat Relay ---
interface ChatMessage {
    user_pubkey?: string;
    text: string;
    timestamp: number;
    room?: string;
}

// Store all connected clients by room
const chatRooms = new Map<string, Set<any>>();

fastify.register(async function (fastify) {
    fastify.get('/chat/:room', { websocket: true }, (socket: any, req: any) => {
        const room = req.params.room;
        console.log(`[CHAT] Client connected to room: ${room}`);

        if (!chatRooms.has(room)) {
            chatRooms.set(room, new Set());
        }
        chatRooms.get(room)!.add(socket);

        socket.on('message', (message: Buffer) => {
            const msgStr = message.toString();

            const clients = chatRooms.get(room);
            if (clients) {
                clients.forEach((client: any) => {
                    if (client.readyState === 1) {
                        client.send(msgStr);
                    }
                });
            }
        });

        socket.on('close', () => {
            chatRooms.get(room)?.delete(socket);
        });

        socket.on('error', (err: Error) => {
            console.error(`[CHAT] Socket error in ${room}:`, err.message);
        });
    });
});

const start = async () => {
    try {
        await fastify.listen({ port: 3002, host: '0.0.0.0' });
        console.log("Registry Service running on port 3002");
        console.log(`Loaded ${demoChannels.length} demo channels`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
