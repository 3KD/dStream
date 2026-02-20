import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; filename: string }> }
) {
    const { id, filename } = await context.params;

    // Security: Validate IDs to prevent traversal
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(id) || !/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
        return new NextResponse("Invalid path", { status: 400 });
    }

    const STORAGE_DIR = '/tmp/dStream_storage';
    const filePath = path.join(STORAGE_DIR, id, filename);

    if (!fs.existsSync(filePath)) {
        return new NextResponse("Not Found", { status: 404 });
    }

    try {
        const fileBuffer = fs.readFileSync(filePath);

        // Determine Content-Type (Manual Map)
        let contentType = 'application/octet-stream';
        if (filename.endsWith('.m3u8')) contentType = 'application/vnd.apple.mpegurl';
        else if (filename.endsWith('.ts')) contentType = 'video/mp2t';
        else if (filename.endsWith('.mp4')) contentType = 'video/mp4';
        else if (filename.endsWith('.json')) contentType = 'application/json';

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache, no-store, must-revalidate' // Dynamic VOD needs fresh playlist
            }
        });

    } catch (e) {
        console.error("[VOD Serve] Error:", e);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
