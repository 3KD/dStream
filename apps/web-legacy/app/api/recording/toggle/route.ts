import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
    try {
        const { streamId, enabled } = await req.json();

        if (!streamId) {
            return new NextResponse("Missing streamId", { status: 400 });
        }

        // HLS Directory matches docker-compose volume
        const hlsBaseDir = '/tmp/dStream_hls';
        const streamDir = path.join(hlsBaseDir, streamId);

        // Ensure directory exists (it might be created by MediaMTX shortly, but we create it now to set the flag)
        if (!fs.existsSync(streamDir)) {
            fs.mkdirSync(streamDir, { recursive: true });
        }

        const flagFile = path.join(streamDir, '.record');

        if (enabled) {
            fs.writeFileSync(flagFile, Date.now().toString());
            console.log(`[Recording] Enabled for stream: ${streamId}`);
        } else {
            if (fs.existsSync(flagFile)) {
                fs.unlinkSync(flagFile);
            }
            console.log(`[Recording] Disabled for stream: ${streamId}`);
        }

        return NextResponse.json({ success: true, recording: !!enabled });
    } catch (e) {
        console.error("[Recording] API Error:", e);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
