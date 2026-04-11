import type { NextRequest } from "next/server";
import { assertStreamIdentity } from "@dstream/protocol";
import { getXmrConfirmationsRequired, getXmrWalletRpcClient } from "@/lib/monero/server";
import { verifyTipSession } from "@/lib/monero/tipSession";
import { findLatestIncomingTip } from "@/lib/monero/tipVerify";
import { getLatestStreamAnnounce } from "@/lib/server/streamAnnounceLookup";
import { resolveVideoPolicy } from "@/lib/videoPolicy";
import { signVideoAccessToken } from "@/lib/video/accessToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseAtomic(input: string | undefined): bigint | null {
  if (!input || !/^\d+$/.test(input)) return null;
  try {
    const value = BigInt(input);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
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

  const tipSessionToken = typeof body?.tipSession === "string" ? body.tipSession.trim() : "";
  const tipSession = verifyTipSession(tipSessionToken);
  if (!tipSession) return new Response("invalid tip session token", { status: 400 });

  try {
    assertStreamIdentity(tipSession.streamPubkey, tipSession.streamId);
  } catch {
    return new Response("invalid session scope", { status: 400 });
  }

  const announce = await getLatestStreamAnnounce(tipSession.streamPubkey, tipSession.streamId);
  if (!announce) return new Response("stream announce not found", { status: 404 });

  const policy = resolveVideoPolicy(announce);
  if (announce.status !== "ended") {
    return new Response("stream replay not yet available", { status: 409 });
  }
  if (policy.mode !== "paid") {
    return new Response("stream replay is not paywalled", { status: 409 });
  }

  const currency = (policy.currency ?? "xmr").toLowerCase();
  if (currency !== "xmr") return new Response("unsupported Video currency", { status: 409 });
  const playlistId = (policy.playlistId ?? "").trim() || undefined;
  const accessScope = policy.accessScope === "playlist" && playlistId ? "playlist" : "stream";

  const requiredAtomic = parseAtomic(policy.priceAtomic);
  if (requiredAtomic === null) return new Response("invalid Video price policy", { status: 409 });

  try {
    const match = await findLatestIncomingTip({
      client,
      accountIndex: tipSession.accountIndex,
      addressIndex: tipSession.addressIndex,
      confirmationsRequired: getXmrConfirmationsRequired()
    });

    if (!match || !match.confirmed) {
      return Response.json(
        {
          ok: false,
          unlocked: false,
          reason: "payment_not_confirmed",
          requiredAtomic: requiredAtomic.toString(),
          amountAtomic: match?.amountAtomic ?? null,
          confirmed: match?.confirmed ?? false
        },
        { status: 402 }
      );
    }

    const paidAtomic = parseAtomic(match.amountAtomic);
    if (paidAtomic === null || paidAtomic < requiredAtomic) {
      return Response.json(
        {
          ok: false,
          unlocked: false,
          reason: "amount_insufficient",
          requiredAtomic: requiredAtomic.toString(),
          amountAtomic: match.amountAtomic,
          confirmed: true
        },
        { status: 402 }
      );
    }

    const accessSeconds = policy.accessSeconds && policy.accessSeconds > 0 ? policy.accessSeconds : 24 * 60 * 60;
    const expiresAtMs = Date.now() + accessSeconds * 1000;
    const token = signVideoAccessToken({
      v: 1,
      t: "dstream_video_access",
      streamPubkey: tipSession.streamPubkey,
      streamId: tipSession.streamId,
      accessScope,
      playlistId,
      expMs: expiresAtMs
    });

    return Response.json({
      ok: true,
      unlocked: true,
      token,
      accessScope,
      playlistId: playlistId ?? null,
      expiresAtMs,
      accessSeconds,
      requiredAtomic: requiredAtomic.toString(),
      amountAtomic: match.amountAtomic,
      txid: match.txid ?? null
    });
  } catch (err: any) {
    return new Response(`video unlock error (${err?.message ?? "unknown"})`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
}
