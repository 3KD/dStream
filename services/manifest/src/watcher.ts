
import fs from 'fs';
import path from 'path';
import { getOrCreateIdentity, signMessage, hashData } from './crypto';

// HLS_DIR from env or default - where MediaMTX writes segments
const HLS_DIR = process.env.HLS_DIR || '/hls';
// MediaMTX HLS server URL
const MEDIAMTX_HLS_URL = process.env.MEDIAMTX_HLS_URL || 'http://mediamtx:8888';
const POLL_INTERVAL = 2000;

// Simple in-memory storage for latest manifest
let latestManifest: any = null;

export class Watcher {
    private ident: { publicKey: Buffer; privateKey: Buffer };

    constructor() {
        this.ident = getOrCreateIdentity();
        console.log(`Watcher initialized with Public Key: ${this.ident.publicKey.toString('hex')}`);

        // Ensure HLS directory exists
        this.ensureDir(HLS_DIR);

        // Start watching
        this.watchDirectory(HLS_DIR);
    }

    private ensureDir(dir: string) {
        if (!fs.existsSync(dir)) {
            console.log(`Waiting for HLS directory: ${dir}`);
            setTimeout(() => this.ensureDir(dir), 1000);
        }
    }

    private watchDirectory(dir: string) {
        console.log(`Starting watch on: ${dir}`);

        // Initial scan
        this.scan(dir);

        // Polling loop (fs.watch is unreliable in containers)
        setInterval(() => this.scan(dir), POLL_INTERVAL);
    }

    private scan(dir: string) {
        try {
            if (!fs.existsSync(dir)) return;

            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    // This is likely a stream ID directory
                    console.log(`Scanning stream directory: ${entry.name}`);
                    this.processStreamDir(entry.name).catch(err =>
                        console.error(`Error processing ${entry.name}:`, err)
                    );
                }
            }
        } catch (err) {
            console.error('Error scanning directory:', err);
        }
    }

    private async processStreamDir(streamId: string) {
        const streamDir = path.join(HLS_DIR, streamId);

        // MediaMTX serves playlists via HTTP, not disk
        // Fetch the video media playlist from MediaMTX
        const playlistUrl = `${MEDIAMTX_HLS_URL}/${streamId}/video1_stream.m3u8`;
        console.log(`Fetching playlist: ${playlistUrl}`);

        try {
            const response = await fetch(playlistUrl, { signal: AbortSignal.timeout(2000) });
            console.log(`Fetch response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                // Stream might not be active yet
                return;
            }

            const content = await response.text();
            console.log(`Got playlist content, ${content.length} bytes`);
            await this.processPlaylistContent(content, streamDir, streamId);
        } catch (err: any) {
            console.error(`Error fetching playlist for ${streamId}:`, err.message);
        }
    }

    private async processPlaylistContent(content: string, streamDir: string, streamId: string) {
        const lines = content.split('\n');
        const segments: { file: string; duration: number }[] = [];

        // Standard HLS parsing
        let currentDuration = 0;
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('#EXTINF:')) {
                // e.g., #EXTINF:2.000,
                const parts = line.split(':')[1].split(',');
                currentDuration = parseFloat(parts[0]);
            } else if (line && !line.startsWith('#')) {
                // File line
                if (line.endsWith('.mp4') || line.endsWith('.ts') || line.endsWith('.m4s')) {
                    segments.push({
                        file: line,
                        duration: currentDuration
                    });
                }
            }
        }

        // Generate Manifest if segments exist
        if (segments.length > 0) {
            await this.generateManifest(streamDir, streamId, segments);
        }
    }

    private async generateManifest(streamDir: string, streamId: string, segments: any[]) {
        const manifestPath = path.join(streamDir, 'manifest.json');

        // Hash all segments
        const segmentHashes: Record<string, string> = {};

        for (const seg of segments) {
            const segPath = path.join(streamDir, seg.file);
            if (fs.existsSync(segPath)) {
                try {
                    const data = fs.readFileSync(segPath);
                    const hash = hashData(data);
                    segmentHashes[seg.file] = hash;
                } catch (e) {
                    // Segment might be writing or deleted
                }
            }
        }

        // Only create manifest if we have hashes
        if (Object.keys(segmentHashes).length === 0) return;

        const manifestData = {
            streamId: streamId,
            generatedAt: Date.now(),
            segments: segmentHashes
        };

        // Sign (pass both keys - required for Ed25519 JWK in Node.js)
        const signature = signMessage(manifestData, this.ident.privateKey, this.ident.publicKey);

        const manifestFile = {
            ...manifestData,
            signature,
            publicKey: this.ident.publicKey.toString('hex')
        };

        // Update memory cache
        latestManifest = manifestFile;

        // Write atomic
        const tempPath = manifestPath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(manifestFile, null, 2));
        fs.renameSync(tempPath, manifestPath);
        console.log(`Generated manifest for ${streamId} with ${Object.keys(segmentHashes).length} segments`);
    }

    public getLatestManifest() {
        return latestManifest;
    }

    public getPublicKey() {
        return this.ident.publicKey.toString('hex');
    }
}
