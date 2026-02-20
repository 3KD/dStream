
import { NextResponse } from 'next/server';
import { getNip05Names, setNip05Name } from '@/lib/nip05Store';

export async function POST(request: Request) {
    try {
        const { name, pubkey } = await request.json();

        if (!name || !pubkey) {
            return NextResponse.json({ error: "Missing name or pubkey" }, { status: 400 });
        }

        const validNameRegex = /^[a-zA-Z0-9-_]+$/;
        if (!validNameRegex.test(name)) {
            return NextResponse.json({ error: "Invalid name format" }, { status: 400 });
        }

        const currentNames = await getNip05Names();
        if (currentNames[name] && currentNames[name] !== pubkey) {
            return NextResponse.json({ error: "Name already taken" }, { status: 409 });
        }

        await setNip05Name(name, pubkey);
        return NextResponse.json({ success: true, nip05: `${name}@${request.headers.get('host')}` });
    } catch (e) {
        console.error("NIP-05 Register Error", e);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
