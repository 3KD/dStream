
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Watcher } from './watcher';

const fastify = Fastify({ logger: true });
const watcher = new Watcher();

fastify.register(cors, {
    origin: '*'
});

// Start watching file system


fastify.get('/manifest', async (request, reply) => {
    const manifest = watcher.getLatestManifest();
    if (!manifest) {
        return reply.code(404).send({ error: "No manifest generated yet" });
    }
    return manifest;
});

fastify.get('/identity', async (request, reply) => {
    return { publicKey: watcher.getPublicKey() };
});

const start = async () => {
    try {
        await fastify.listen({ port: 3001, host: '0.0.0.0' });
        console.log("Manifest Service running on port 3001");
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
