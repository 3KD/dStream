import type { NextRequest } from "next/server";
import {
  getEscrowV3Session,
  hasAllPrepareInfos,
  toEscrowV3SessionResponse,
  touchEscrowV3Session
} from "@/lib/monero/escrowV3SessionStore";
import { getXmrWalletRpcClient } from "@/lib/monero/server";
import { validateNip98Auth } from "../../../_lib";

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
  if (session.phase !== "collecting_prepare" && session.phase !== "make_ready") {
    return new Response(`invalid phase transition (${session.phase} -> make)`, { status: 409 });
  }
  if (!hasAllPrepareInfos(session)) return new Response("participants still pending prepare info", { status: 409 });

  try {
    const infos = session.participantPubkeys.map((pubkey) => session.participantPrepareInfos[pubkey]).filter(Boolean);
    const out = await client.makeMultisig({
      multisigInfo: infos,
      threshold: session.threshold
    });

    session.walletAddress = out.address ?? session.walletAddress;
    session.coordinatorExchangeInfo = out.multisigInfo ?? null;
    session.exchangeRound = out.multisigInfo ? 1 : 0;
    session.participantExchangeInfos = {};
    session.phase = out.multisigInfo ? "collecting_exchange" : "exchanged";
    touchEscrowV3Session(session);
    return Response.json(toEscrowV3SessionResponse(session));
  } catch (err: any) {
    const message = `xmr escrow make error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

