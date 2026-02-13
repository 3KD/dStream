import type { NextRequest } from "next/server";
import { getEscrowV3Session, toEscrowV3SessionResponse, touchEscrowV3Session } from "@/lib/monero/escrowV3SessionStore";
import { getXmrWalletRpcClient } from "@/lib/monero/server";
import { normalizeTxDataHex, validateNip98Auth } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  const auth = validateNip98Auth(req, "POST");
  if (auth instanceof Response) return auth;

  const client = getXmrWalletRpcClient();
  if (!client) return new Response("xmr wallet rpc not configured", { status: 404 });

  const { sessionId } = await ctx.params;
  const session = getEscrowV3Session(sessionId);
  if (!session) return new Response("session not found", { status: 404 });
  if (auth.pubkey !== session.coordinatorPubkey) return new Response("not authorized for coordinator action", { status: 403 });
  if (session.phase !== "exchanged" && session.phase !== "signed") {
    return new Response(`invalid phase transition (${session.phase} -> sign)`, { status: 409 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const txDataHex = normalizeTxDataHex(body?.txDataHex);
  if (!txDataHex) return new Response("invalid txDataHex", { status: 400 });

  try {
    const out = await client.signMultisig({ txDataHex });
    session.signedTxDataHex = out.txDataHex;
    session.signedTxids = out.txids;
    session.phase = "signed";
    touchEscrowV3Session(session);
    return Response.json({
      ...toEscrowV3SessionResponse(session),
      signedTxDataHex: out.txDataHex
    });
  } catch (err: any) {
    const message = `xmr escrow sign error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

