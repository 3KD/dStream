import type { NextRequest } from "next/server";
import { getEscrowV3Session, toEscrowV3SessionResponse, touchEscrowV3Session } from "@/lib/monero/escrowV3SessionStore";
import { validateNip98Auth } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isParticipant(pubkey: string, participants: string[]): boolean {
  return participants.includes(pubkey);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  const auth = validateNip98Auth(req, "GET");
  if (auth instanceof Response) return auth;

  const { sessionId } = await ctx.params;
  const session = getEscrowV3Session(sessionId);
  if (!session) return new Response("session not found", { status: 404 });

  if (auth.pubkey !== session.coordinatorPubkey && !isParticipant(auth.pubkey, session.participantPubkeys)) {
    return new Response("not authorized for session", { status: 403 });
  }

  touchEscrowV3Session(session);
  return Response.json(toEscrowV3SessionResponse(session));
}

