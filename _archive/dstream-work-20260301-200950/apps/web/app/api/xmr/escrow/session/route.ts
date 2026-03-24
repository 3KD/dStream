import type { NextRequest } from "next/server";
import { assertStreamIdentity } from "@dstream/protocol";
import {
  createEscrowV3Session,
  hasAllPrepareInfos,
  toEscrowV3SessionResponse,
  touchEscrowV3Session
} from "@/lib/monero/escrowV3SessionStore";
import { getXmrWalletRpcClient } from "@/lib/monero/server";
import { parseHex64Array, validateNip98Auth } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseThreshold(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    const n = Math.trunc(input);
    return n >= 2 ? n : null;
  }
  if (typeof input === "string" && input.trim()) {
    const n = Number(input);
    if (!Number.isFinite(n)) return null;
    const i = Math.trunc(n);
    return i >= 2 ? i : null;
  }
  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = validateNip98Auth(req, "POST");
  if (auth instanceof Response) return auth;

  const client = getXmrWalletRpcClient();
  if (!client) return new Response("xmr wallet rpc not configured", { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const streamPubkey = typeof body?.streamPubkey === "string" ? body.streamPubkey.trim().toLowerCase() : "";
  const streamId = typeof body?.streamId === "string" ? body.streamId.trim() : "";
  try {
    assertStreamIdentity(streamPubkey, streamId);
  } catch (err: any) {
    return new Response(err?.message ?? "invalid stream identity", { status: 400 });
  }

  if (auth.pubkey !== streamPubkey) return new Response("not authorized for stream", { status: 403 });

  const participantPubkeys = parseHex64Array(body?.participantPubkeys);
  if (!participantPubkeys || participantPubkeys.length === 0) {
    return new Response("participantPubkeys must contain at least one valid hex pubkey", { status: 400 });
  }

  const filteredParticipants = participantPubkeys.filter((pubkey) => pubkey !== auth.pubkey);
  if (filteredParticipants.length === 0) {
    return new Response("participantPubkeys must include at least one non-coordinator pubkey", { status: 400 });
  }

  const totalSigners = filteredParticipants.length + 1;
  const threshold = parseThreshold(body?.threshold) ?? totalSigners;
  if (threshold > totalSigners) return new Response(`threshold must be <= ${totalSigners}`, { status: 400 });

  try {
    const prepared = await client.prepareMultisig();
    const session = createEscrowV3Session({
      streamPubkey,
      streamId,
      coordinatorPubkey: auth.pubkey,
      participantPubkeys: filteredParticipants,
      threshold,
      coordinatorPrepareInfo: prepared.multisigInfo
    });
    if (hasAllPrepareInfos(session)) session.phase = "make_ready";
    touchEscrowV3Session(session);
    return Response.json(toEscrowV3SessionResponse(session));
  } catch (err: any) {
    const message = `xmr escrow create error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

