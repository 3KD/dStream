import type { NextRequest } from "next/server";
import { assertStreamIdentity } from "@dstream/protocol";
import { validateEvent, verifyEvent } from "nostr-tools";
import { getXmrConfirmationsRequired, getXmrWalletRpcClient } from "@/lib/monero/server";
import { verifyStakeSession } from "@/lib/monero/stakeSession";
import { getStakeTotals } from "@/lib/monero/stakeVerify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseAuthEvent(req: NextRequest): any | null {
  const raw = req.headers.get("authorization") ?? "";
  const match = raw.match(/^Nostr\s+(.+)$/i);
  if (!match?.[1]) return null;
  try {
    const json = Buffer.from(match[1], "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getFirstTagValue(tags: any, key: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    if (!Array.isArray(t)) continue;
    if (t[0] !== key) continue;
    if (typeof t[1] !== "string") continue;
    return t[1];
  }
  return null;
}

function isRecent(createdAtSec: number, maxSkewSec: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - createdAtSec) <= maxSkewSec;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const client = getXmrWalletRpcClient();
  if (!client) return new Response("xmr wallet rpc not configured", { status: 404 });

  const { token } = await ctx.params;
  const session = verifyStakeSession(token);
  if (!session) return new Response("invalid session token", { status: 400 });

  try {
    assertStreamIdentity(session.streamPubkey, session.streamId);
  } catch {
    return new Response("invalid session scope", { status: 400 });
  }

  const authEvent = parseAuthEvent(req);
  if (!authEvent) return new Response("missing NIP-98 auth", { status: 401 });
  if (!validateEvent(authEvent) || !verifyEvent(authEvent)) return new Response("invalid NIP-98 auth", { status: 401 });
  if (authEvent.kind !== 27235) return new Response("invalid NIP-98 kind", { status: 401 });
  if (!isRecent(authEvent.created_at, 60)) return new Response("stale NIP-98 auth", { status: 401 });

  const expectedUrl = req.nextUrl.toString();
  const u = getFirstTagValue(authEvent.tags, "u");
  const method = getFirstTagValue(authEvent.tags, "method");
  if (u !== expectedUrl) return new Response("NIP-98 url mismatch", { status: 401 });
  if ((method ?? "").toUpperCase() !== "GET") return new Response("NIP-98 method mismatch", { status: 401 });

  const viewerPubkey = typeof authEvent?.pubkey === "string" ? authEvent.pubkey.trim().toLowerCase() : "";
  if (viewerPubkey !== session.viewerPubkey) return new Response("not authorized for session", { status: 403 });

  try {
    const confirmationsRequired = getXmrConfirmationsRequired();
    const totals = await getStakeTotals({
      client,
      accountIndex: session.accountIndex,
      addressIndex: session.addressIndex,
      confirmationsRequired
    });

    return Response.json({
      ok: true,
      streamPubkey: session.streamPubkey,
      streamId: session.streamId,
      viewerPubkey: session.viewerPubkey,
      accountIndex: session.accountIndex,
      addressIndex: session.addressIndex,
      confirmationsRequired,
      ...totals
    });
  } catch (err: any) {
    const message = `xmr stake verify error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

