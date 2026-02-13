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
  if (session.phase !== "signed" && session.phase !== "submitted") {
    return new Response(`invalid phase transition (${session.phase} -> submit)`, { status: 409 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const explicitTxDataHex = normalizeTxDataHex(body?.txDataHex);
  const txDataHex = explicitTxDataHex ?? session.signedTxDataHex;
  if (!txDataHex) return new Response("txDataHex missing (provide body.txDataHex or sign first)", { status: 400 });

  try {
    const out = await client.submitMultisig({ txDataHex });
    session.submittedTxids = out.txids;
    session.phase = "submitted";
    touchEscrowV3Session(session);
    return Response.json(toEscrowV3SessionResponse(session));
  } catch (err: any) {
    const message = `xmr escrow submit error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

