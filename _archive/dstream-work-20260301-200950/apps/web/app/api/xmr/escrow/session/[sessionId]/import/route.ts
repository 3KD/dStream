import type { NextRequest } from "next/server";
import { getEscrowV3Session, toEscrowV3SessionResponse, touchEscrowV3Session } from "@/lib/monero/escrowV3SessionStore";
import { getXmrWalletRpcClient } from "@/lib/monero/server";
import { validateNip98Auth } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeInfos(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

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
    return new Response(`invalid phase transition (${session.phase} -> import)`, { status: 409 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const infos = normalizeInfos(body?.infos);
  if (infos.length === 0) return new Response("infos must include at least one entry", { status: 400 });

  try {
    const out = await client.importMultisigInfo({ infos });
    session.importedOutputs += out.outputsImported;
    touchEscrowV3Session(session);
    return Response.json({
      ...toEscrowV3SessionResponse(session),
      importedNow: out.outputsImported
    });
  } catch (err: any) {
    const message = `xmr escrow import error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

