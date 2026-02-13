import type { NextRequest } from "next/server";
import {
  getEscrowV3Session,
  hasAllExchangeInfos,
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

  if (session.phase !== "collecting_exchange" && session.phase !== "exchange_ready") {
    return new Response(`invalid phase transition (${session.phase} -> exchange)`, { status: 409 });
  }
  if (!hasAllExchangeInfos(session)) return new Response("participants still pending exchange info", { status: 409 });

  try {
    const infos = session.participantPubkeys.map((pubkey) => session.participantExchangeInfos[pubkey]).filter(Boolean);
    const out = await client.exchangeMultisigKeys({ multisigInfo: infos });
    session.walletAddress = out.address ?? session.walletAddress;
    session.coordinatorExchangeInfo = out.multisigInfo ?? null;
    session.participantExchangeInfos = {};
    session.exchangeRound = out.multisigInfo ? session.exchangeRound + 1 : session.exchangeRound;
    session.phase = out.multisigInfo ? "collecting_exchange" : "exchanged";
    touchEscrowV3Session(session);
    return Response.json(toEscrowV3SessionResponse(session));
  } catch (err: any) {
    const detail = String(err?.message ?? "");
    if (/kex is already complete/i.test(detail)) {
      session.coordinatorExchangeInfo = null;
      session.participantExchangeInfos = {};
      session.phase = "exchanged";
      touchEscrowV3Session(session);
      return Response.json(toEscrowV3SessionResponse(session));
    }
    const message = `xmr escrow exchange error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
