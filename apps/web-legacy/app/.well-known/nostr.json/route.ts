
import { NextResponse } from 'next/server';
import { getNip05Names } from '@/lib/nip05Store';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name'); // Optional filter

    const names = await getNip05Names();

    // CORS headers are critical for NIP-05
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (name) {
        // Return only specific name if requested (though standard usually asks for all or filters client side, strictly specific query is allowed)
        if (names[name]) {
            return NextResponse.json({ names: { [name]: names[name] } }, { headers });
        }
        return NextResponse.json({ names: {} }, { headers });
    }

    return NextResponse.json({ names }, { headers });
}
