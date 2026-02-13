import { NextResponse } from "next/server";
import { getXmrWalletRpcClient } from "@/lib/monero/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function devtoolsEnabled() {
  return process.env.NODE_ENV === "development" || process.env.DSTREAM_DEVTOOLS === "1";
}

export async function POST(): Promise<Response> {
  if (!devtoolsEnabled()) return new NextResponse("Not Found", { status: 404 });

  const client = getXmrWalletRpcClient();
  if (!client) return new NextResponse("xmr wallet rpc not configured", { status: 404 });

  try {
    await client.dstreamReset();
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const message = `xmr reset error (${err?.message ?? "unknown"})`;
    return new NextResponse(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

