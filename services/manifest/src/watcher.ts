
import fs from 'fs/promises';
import { existsSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { getOrCreateIdentity, signMessage, hashData } from './crypto';

// HLS_DIR from env or default - where MediaMTX writes segments
const HLS_DIR = process.env.HLS_DIR || '/hls';
// MediaMTX HLS server URL
const MEDIAMTX_HLS_URL = process.env.MEDIAMTX_HLS_URL || 'http://mediamtx:8880';
const POLL_INTERVAL = 2000;

// Simple in-memory storage for latest manifest
let latestManifest: any = null;

// Cache for file hashes: filePath -> { mtimeMs, hash }
const fileHashCache = new Map<string, { mtimeMs: number, hash: string }>();

export class Watcher {
    private ident: { publicKey: Buffer; privateKey: Buffer };
    private isScanning = false;

    constructor() {
        this.ident = getOrCreateIdentity();
        console.log(`Watcher initialized with Public Key: ${this.ident.publicKey.toString('hex')}`);

        // Ensure HLS directory exists (sync ok in constructor)
        this.ensureDirLoop(HLS_DIR);
    }

    private async ensureDirLoop(dir: string) {
        // Wait for directory to appear
        while (true) {
            try {
                await fs.access(dir);
                break;
            } catch {
                console.log(`Waiting for HLS directory: ${dir}`);
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        // Start watching
        this.startLoop(dir);
    }

    private startLoop(dir: string) {
        console.log(`Starting watch on: ${dir}`);
        const loop = async () => {
            try {
                await this.scan(dir);
            } catch (err) {
                console.error('Critical error in scan loop:', err);
            }
            // Schedule next run only after this one completes
            setTimeout(loop, POLL_INTERVAL);
        };
        loop();
    }

    private async scan(dir: string) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    // This is likely a stream ID directory
                    // Process sequentially to keep load manageable, or parallel? 
                    // Sequential safest for stability.
                    try {
                        await this.processStreamDir(entry.name);
                    } catch (err) {
                        console.error(`Error processing stream ${entry.name}:`, err);
                    }
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
        // console.log(`Fetching playlist: ${playlistUrl}`);

        let content: string;
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 5000); // 5s timeout
            const response = await fetch(playlistUrl, { signal: controller.signal });
            clearTimeout(id);

            if (!response.ok) {
                return; // Stream not ready
            }
            content = await response.text();
        } catch (err: any) {
            // Quietly fail for connection errors (common connection refused loop)
            if (err.cause?.code !== 'ECONNREFUSED') {
                console.error(`Error fetching playlist for ${streamId}:`, err.message);
            }
            return;
        }

        await this.processPlaylistContent(content, streamDir, streamId);
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
        let hasChanges = false;

        const currentFiles = new Set<string>();

        // Pre-load current manifest to compare? Or just rely on file changes?
        // We rely on file MTIME to avoid re-hashing.

        for (const seg of segments) {
            const filename = seg.file;
            const segPath = path.join(streamDir, filename);
            currentFiles.add(segPath);

            try {
                const stats = await fs.stat(segPath);
                const cacheKey = segPath;
                const cached = fileHashCache.get(cacheKey);

                if (cached && cached.mtimeMs === stats.mtimeMs) {
                    // Cache hit
                    segmentHashes[filename] = cached.hash;
                } else {
                    // Cache miss or changed
                    // console.log(`Hashing new segment: ${filename}`);
                    const data = await fs.readFile(segPath);
                    const hash = hashData(data);

                    fileHashCache.set(cacheKey, {
                        mtimeMs: stats.mtimeMs,
                        hash: hash
                    });
                    segmentHashes[filename] = hash;
                    hasChanges = true;
                }
            } catch (e) {
                // Segment might be writing or deleted
                // console.warn(`Skipping missing segment: ${filename}`);
            }
        }

        // Cleanup cache for files that don't exist anymore in this stream?
        // A bit expensive to do every time. Maybe a periodic cleanup or LRU?
        // For now, let memory grow slightly, it's just strings.

        // Only create manifest if we have hashes
        if (Object.keys(segmentHashes).length === 0) return;

        const manifestData = {
            streamId: streamId,
            generatedAt: Date.now(),
            segments: segmentHashes
        };

        // Sign
        const signature = signMessage(manifestData, this.ident.privateKey, this.ident.publicKey);

        const manifestFile = {
            ...manifestData,
            signature,
            publicKey: this.ident.publicKey.toString('hex')
        };

        // Update global (in-memory)
        latestManifest = manifestFile;

        // Write atomic (Sync write for manifest is fine as it's small and infrequent compared to reads)
        // Using sync here to ensure atomicity simpler, but async is better.
        // Let's use async.
        const tempPath = manifestPath + '.tmp';
        await fs.writeFile(tempPath, JSON.stringify(manifestFile, null, 2));
        await fs.rename(tempPath, manifestPath);

        // console.log(`Generated manifest for ${streamId}`);
    }

    public getLatestManifest() {
        return latestManifest;
    }

    public getPublicKey() {
        return this.ident.publicKey.toString('hex');
    }
}
