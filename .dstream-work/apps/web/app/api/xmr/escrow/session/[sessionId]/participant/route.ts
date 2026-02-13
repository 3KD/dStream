import type { NextRequest } from "next/server";
import {
  getEscrowV3Session,
  hasAllExchangeInfos,
  hasAllPrepareInfos,
  toEscrowV3SessionResponse,
  touchEscrowV3Session
} from "@/lib/monero/escrowV3SessionStore";
import { normalizeMultisigInfo, validateNip98Auth } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Phase = "prepare" | "exchange";

function parsePhase(input: unknown): Phase | null {
  if (input === "prepare") return "prepare";
  if (input === "exchange") return "exchange";
  return null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  const auth = validateNip98Auth(req, "POST");
  if (auth instanceof Response) return auth;

  const { sessionId } = await ctx.params;
  const session = getEscrowV3Session(sessionId);
  if (!session) return new Response("session not found", { status: 404 });

  if (!session.participantPubkeys.includes(auth.pubkey)) {
    return new Response("not authorized for participant action", { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const phase = parsePhase(body?.phase);
  if (!phase) return new Response("phase must be 'prepare' or 'exchange'", { status: 400 });
  const multisigInfo = normalizeMultisigInfo(body?.multisigInfo);
  if (!multisigInfo) return new Response("invalid multisigInfo", { status: 400 });

  if (phase === "prepare") {
    if (session.phase !== "collecting_prepare" && session.phase !== "make_ready") {
      return new Response(`invalid phase transition (${session.phase} -> prepare)`, { status: 409 });
    }
    session.participantPrepareInfos[auth.pubkey] = multisigInfo;
    session.phase = hasAllPrepareInfos(session) ? "make_ready" : "collecting_prepare";
    touchEscrowV3Session(session);
    return Response.json(toEscrowV3SessionResponse(session));
  }

  if (session.phase !== "collecting_exchange" && session.phase !== "exchange_ready") {
    return new Response(`invalid phase transition (${session.phase} -> exchange)`, { status: 409 });
  }
  session.participantExchangeInfos[auth.pubkey] = multisigInfo;
  session.phase = hasAllExchangeInfos(session) ? "exchange_ready" : "collecting_exchange";
  touchEscrowV3Session(session);
  return Response.json(toEscrowV3SessionResponse(session));
}

