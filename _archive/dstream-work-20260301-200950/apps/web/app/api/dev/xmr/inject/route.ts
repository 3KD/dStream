import { NextResponse } from "next/server";
import { getXmrWalletRpcAccountIndex, getXmrWalletRpcClient } from "@/lib/monero/server";
import { verifyTipSession } from "@/lib/monero/tipSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function devtoolsEnabled() {
  return process.env.NODE_ENV === "development" || process.env.DSTREAM_DEVTOOLS === "1";
}

function parseNonNegativeInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= 0 ? i : null;
}

export async function POST(req: Request): Promise<Response> {
  if (!devtoolsEnabled()) return new NextResponse("Not Found", { status: 404 });

  const client = getXmrWalletRpcClient();
  if (!client) return new NextResponse("xmr wallet rpc not configured", { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  const amountAtomic = typeof body?.amountAtomic === "string" ? body.amountAtomic.trim() : "";
  if (!/^\d+$/.test(amountAtomic)) return new NextResponse("invalid amountAtomic", { status: 400 });

  const confirmations = parseNonNegativeInt(body?.confirmations) ?? 0;
  const timestampSec = parseNonNegativeInt(body?.timestampSec) ?? Math.floor(Date.now() / 1000);

  const sessionToken = typeof body?.session === "string" ? body.session.trim() : "";
  const session = sessionToken ? verifyTipSession(sessionToken) : null;

  const accountIndex = session ? session.accountIndex : (parseNonNegativeInt(body?.accountIndex) ?? getXmrWalletRpcAccountIndex());
  let addressIndex = session ? session.addressIndex : parseNonNegativeInt(body?.addressIndex);

  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (address && addressIndex === null) {
    try {
      const list = await client.getAddress({ accountIndex });
      const match = list.addresses.find((a) => a.address === address);
      if (match) addressIndex = match.addressIndex;
    } catch {
      // fall through to validation below
    }
  }

  if (addressIndex === null) {
    return new NextResponse("missing addressIndex (or session/address)", { status: 400 });
  }

  try {
    await client.dstreamInjectTransfer({
      accountIndex,
      addressIndex,
      amountAtomic,
      confirmations,
      timestampSec
    });
    return NextResponse.json({ ok: true, accountIndex, addressIndex, amountAtomic, confirmations, timestampSec });
  } catch (err: any) {
    const message = `xmr inject error (${err?.message ?? "unknown"})`;
    return new NextResponse(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
