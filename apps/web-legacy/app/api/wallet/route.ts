
import { NextResponse } from 'next/server';
import { monero } from '@/lib/moneroRpc';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { action, ...params } = body;

        let result;
        switch (action) {
            case 'balance':
                result = await monero.getBalance();
                break;
            case 'address':
                result = await monero.getAddress();
                break;
            case 'create':
                result = await monero.createWallet(params.filename, params.password);
                break;
            case 'open':
                result = await monero.openWallet(params.filename, params.password);
                break;
            default:
                return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }

        return NextResponse.json({ success: true, result });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
