import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { assertStreamIdentity } from "@dstream/protocol";
import { getXmrWalletRpcAccountIndex, getXmrWalletRpcClient } from "@/lib/monero/server";
import { makeTipLabel, signTipSession, type TipSessionV1 } from "@/lib/monero/tipSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makeNonce(): string {
  return crypto.randomBytes(10).toString("base64url");
}

export async function POST(req: NextRequest): Promise<Response> {
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

  const accountIndex = getXmrWalletRpcAccountIndex();
  const createdAtMs = Date.now();
  const nonce = makeNonce();
  const label = makeTipLabel({ streamPubkey, streamId, nonce });

  try {
    const created = await client.createAddress({ accountIndex, label });
    const payload: TipSessionV1 = {
      v: 1,
      t: "xmr_tip_session",
      streamPubkey,
      streamId,
      accountIndex,
      addressIndex: created.addressIndex,
      createdAtMs,
      nonce
    };
    const session = signTipSession(payload);
    return Response.json({
      ok: true,
      address: created.address,
      accountIndex,
      addressIndex: created.addressIndex,
      session
    });
  } catch (err: any) {
    const message = `xmr tip session error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

