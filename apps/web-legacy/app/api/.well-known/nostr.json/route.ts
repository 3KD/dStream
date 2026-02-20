import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // Always run on request

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const name = searchParams.get('name') || '_';

    // 1. Load NIP-05 map from Environment Variable (JSON string)
    //    Format: '{"erik": "hexpubkey", "admin": "hexpubkey"}'
    const envMap = process.env.NIP05_MAP ? JSON.parse(process.env.NIP05_MAP) : {};

    // 2. Fallback / Hardcoded for Admin (replace with your actual pubkey later)
    //    You can add this to your .env.local: NIP05_MAP='{"admin":"..."}'
    const names: Record<string, string> = {
        ...envMap
    };

    // If the requested name exists, return it
    if (names[name]) {
        return NextResponse.json({
            names: {
                [name]: names[name]
            }
        }, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*', // NIP-05 requires CORS
                'Cache-Control': 'no-store, max-age=0'
            }
        });
    }

    // Default response (empty or 404 behavior, but NIP-05 prefers 200 with empty names if not found)
    return NextResponse.json({
        names: {}
    }, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*'
        }
    });
}
