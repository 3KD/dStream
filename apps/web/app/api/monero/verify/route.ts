import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { paymentId } = body;

        if (!paymentId) {
            return new NextResponse("Missing paymentId", { status: 400 });
        }

        console.log(`[Proxy] Verifying payment ${paymentId} via xmrchain.net`);

        // Server-side fetch avoids CORS
        const response = await fetch(`https://xmrchain.net/api/search/${paymentId}`);

        if (!response.ok) {
            return NextResponse.json({ verified: false, error: 'Payment not found upstream' });
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (e: any) {
        console.error("[Proxy] Verification error:", e);
        return new NextResponse(`Internal Error: ${e.message}`, { status: 500 });
    }
}
