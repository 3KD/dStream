import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(
    request: NextRequest,
    props: { params: Promise<{ id: string; filename: string }> }
) {
    const params = await props.params;
    const { id: streamId, filename } = params;

    // Verbose logging for debugging
    console.log(`[HLS Route] Incoming request: ${streamId}/${filename}`);

    // Security check: unexpected characters in filename
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return new NextResponse('Invalid filename', { status: 400 });
    }

    // Path matching Docker volume
    const filePath = path.join('/tmp/dStream_hls', streamId, filename);

    try {
        // 1. Try serving from disk (Performance: Segments are written to disk)
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            const data = fs.readFileSync(filePath);

            // Determine content type manually
            let contentType = 'application/octet-stream';
            if (filename.endsWith('.m3u8')) contentType = 'application/vnd.apple.mpegurl';
            else if (filename.endsWith('.ts')) contentType = 'video/mp2t';
            else if (filename.endsWith('.mp4')) contentType = 'video/mp4';
            else if (filename.endsWith('.m4s')) contentType = 'video/iso.segment';
            else if (filename.endsWith('.json')) contentType = 'application/json';

            return new NextResponse(data, {
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': stats.size.toString(),
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Credentials': 'true',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                }
            });
        }

        // 2. Fallback: Proxy to MediaMTX (Playlists are often in-memory for live HLS)
        // Note: docker-compose maps host port 8888 to container 8880
        console.log(`[HLS] File not on disk, proxying to MediaMTX: ${streamId}/${filename}`);
        const mediamtxUrl = `http://127.0.0.1:8888/${streamId}/${filename}`;

        const proxyRes = await fetch(mediamtxUrl);
        if (!proxyRes.ok) {
            console.warn(`[HLS] MediaMTX returned ${proxyRes.status} for ${streamId}/${filename}`);
            return new NextResponse(`File not found upstream: ${proxyRes.status}`, { status: 404 });
        }

        const contentType = proxyRes.headers.get('content-type') || 'application/vnd.apple.mpegurl';

        // We use blob/arrayBuffer to forward the body
        const blob = await proxyRes.blob();

        return new NextResponse(blob, {
            headers: {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': 'true',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        });

    } catch (error) {
        console.error(`Error serving HLS file ${streamId}/${filename}:`, error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
