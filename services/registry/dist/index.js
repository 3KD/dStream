"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const websocket_1 = __importDefault(require("@fastify/websocket"));
const fastify = (0, fastify_1.default)({ logger: true });
fastify.register(cors_1.default, { origin: '*' });
fastify.register(websocket_1.default);
const activeStreams = new Map();
const TTL = 60 * 1000; // 60 seconds TTL
// --- Crypto Helper ---
function verifySignature(message, signatureHex, pubkeyHex) {
    // In a real impl, we'd canonize JSON. For now we assume strict string matching or handle buffer directly
    // Ideally use headers for signature and raw body for verification
    // MVP: Trusting payload structure for now 
    return true;
}
// --- Registry Endpoints ---
fastify.post('/announce', async (request, reply) => {
    const body = request.body;
    const { pubkey, stream_id, signature } = body;
    // Verify Sig (TODO)
    activeStreams.set(pubkey, {
        pubkey,
        stream_id: stream_id || 'default',
        last_announce: Date.now(),
        metadata: body.metadata || {}
    });
    return { status: 'acknowledged', ttl: TTL };
});
fastify.get('/streams', async (request, reply) => {
    const now = Date.now();
    const streams = [];
    for (const [key, stream] of activeStreams.entries()) {
        if (now - stream.last_announce > TTL) {
            activeStreams.delete(key);
        }
        else {
            streams.push(stream);
        }
    }
    return streams;
});
fastify.register(async function (fastify) {
    fastify.get('/chat/:room', { websocket: true }, (connection /* SocketStream */, req /* FastifyRequest */) => {
        // @ts-ignore
        const room = req.params.room;
        // Simple room subscription
        // In a real app, use Redis Adapter
        connection.socket.on('message', (message) => {
            // Broadcast to all clients in this room (Naive implementation: broadcast to ALL for MVP)
            fastify.websocketServer.clients.forEach((client) => {
                if (client.readyState === 1 && client !== connection.socket) {
                    client.send(message.toString());
                }
            });
        });
    });
});
const start = async () => {
    try {
        await fastify.listen({ port: 3002, host: '0.0.0.0' });
        console.log("Registry Service running on port 3002");
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
