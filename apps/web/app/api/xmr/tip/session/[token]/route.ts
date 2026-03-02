import type { NextRequest } from "next/server";
import { assertStreamIdentity } from "@dstream/protocol";
import { getXmrConfirmationsRequired, getXmrWalletRpcClient } from "@/lib/monero/server";
import { verifyTipSession } from "@/lib/monero/tipSession";
import { findLatestIncomingTip } from "@/lib/monero/tipVerify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const client = getXmrWalletRpcClient();
  if (!client) return new Response("xmr wallet rpc not configured", { status: 404 });

  const { token } = await ctx.params;
  const session = verifyTipSession(token);
  if (!session) return new Response("invalid session token", { status: 400 });

  try {
    assertStreamIdentity(session.streamPubkey, session.streamId);
  } catch {
    return new Response("invalid session scope", { status: 400 });
  }

  try {
    const confirmationsRequired = getXmrConfirmationsRequired();
    const match = await findLatestIncomingTip({
      client,
      accountIndex: session.accountIndex,
      addressIndex: session.addressIndex,
      confirmationsRequired
    });

    return Response.json({
      ok: true,
      streamPubkey: session.streamPubkey,
      streamId: session.streamId,
      accountIndex: session.accountIndex,
      addressIndex: session.addressIndex,
      found: !!match,
      amountAtomic: match?.amountAtomic ?? null,
      confirmed: match?.confirmed ?? null,
      confirmations: match?.confirmations ?? null,
      observedAtMs: match?.observedAtMs ?? null,
      txid: match?.txid ?? null
    });
  } catch (err: any) {
    const message = `xmr tip verify error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

