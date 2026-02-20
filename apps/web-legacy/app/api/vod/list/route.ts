import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
    try {
        const STORAGE_DIR = '/tmp/dStream_storage';

        if (!fs.existsSync(STORAGE_DIR)) {
            return NextResponse.json({ recordings: [] });
        }

        const streams = fs.readdirSync(STORAGE_DIR);
        const recordings = [];

        for (const streamId of streams) {
            const streamPath = path.join(STORAGE_DIR, streamId);

            try {
                const stats = fs.statSync(streamPath);
                if (!stats.isDirectory()) continue;

                // Check for vod.m3u8 to confirm it's a valid recording
                const hasPlaylist = fs.existsSync(path.join(streamPath, 'vod.m3u8'));
                if (!hasPlaylist) continue;

                // Calculate total size (rough estimate)
                const files = fs.readdirSync(streamPath);
                let totalSize = 0;
                let segmentCount = 0;

                for (const file of files) {
                    const filePath = path.join(streamPath, file);
                    const fStats = fs.statSync(filePath);
                    totalSize += fStats.size;
                    if (file.endsWith('.ts')) segmentCount++;
                }

                recordings.push({
                    streamId,
                    createdAt: stats.birthtime.toISOString(),
                    lastModified: stats.mtime.toISOString(),
                    sizeBytes: totalSize,
                    segmentCount,
                    // Estimate duration: 4s per segment
                    durationSeconds: segmentCount * 4
                });

            } catch (e) {
                console.warn(`[VOD List] Error processing ${streamId}:`, e);
            }
        }

        // Sort by most recent
        recordings.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

        return NextResponse.json({ recordings });

    } catch (e) {
        console.error("[VOD List] Error:", e);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
