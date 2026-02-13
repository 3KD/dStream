import type { NextRequest } from "next/server";
import { assertStreamIdentity, parseP2PBytesReceiptEvent } from "@dstream/protocol";
import { validateEvent, verifyEvent } from "nostr-tools";
import {
  getXmrRefundFullServedBytes,
  getXmrRefundMaxReceiptAgeSec,
  getXmrRefundMaxReceipts,
  getXmrRefundMaxServedBytesPerReceipt,
  getXmrRefundMinServedBytes,
  getXmrRefundMinSessionAgeSec,
  getXmrWalletRpcClient
} from "@/lib/monero/server";
import { evaluateRefundPolicy, type RefundContributionReceipt } from "@/lib/monero/refundPolicy";
import { verifyStakeSession } from "@/lib/monero/stakeSession";

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

function normalizeMoneroAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const address = input.trim();
  if (!address) return null;
  if (address.length < 20) return null;
  if (!/^[0-9A-Za-z]+$/.test(address)) return null;
  return address;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
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
  if ((method ?? "").toUpperCase() !== "POST") return new Response("NIP-98 method mismatch", { status: 401 });

  const viewerPubkey = typeof authEvent.pubkey === "string" ? authEvent.pubkey.trim().toLowerCase() : "";
  if (viewerPubkey !== session.viewerPubkey) return new Response("not authorized for session", { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const refundAddress = normalizeMoneroAddress(body?.refundAddress);
  if (!refundAddress) return new Response("invalid refundAddress", { status: 400 });

  const receipts = Array.isArray(body?.receipts) ? body.receipts : [];
  const parsedReceipts: RefundContributionReceipt[] = [];
  for (const raw of receipts) {
    if (!validateEvent(raw) || !verifyEvent(raw)) return new Response("invalid receipt signature", { status: 400 });
    const parsed = parseP2PBytesReceiptEvent(raw, {
      streamPubkey: session.streamPubkey,
      streamId: session.streamId
    });
    if (!parsed) return new Response("invalid receipt scope", { status: 400 });
    parsedReceipts.push({
      id: parsed.raw.id ?? null,
      pubkey: parsed.pubkey,
      fromPubkey: parsed.fromPubkey,
      servedBytes: parsed.servedBytes,
      observedAtMs: parsed.observedAtMs,
      createdAtSec: parsed.createdAt,
      sessionId: parsed.sessionId ?? null
    });
  }

  const minServedBytes = getXmrRefundMinServedBytes();
  const fullServedBytes = getXmrRefundFullServedBytes();
  const refundPolicy = evaluateRefundPolicy({
    receipts: parsedReceipts,
    viewerPubkey: session.viewerPubkey,
    sessionToken: token,
    sessionCreatedAtMs: session.createdAtMs,
    nowMs: Date.now(),
    cfg: {
      minServedBytes,
      fullServedBytes,
      maxReceipts: getXmrRefundMaxReceipts(),
      maxReceiptAgeSec: getXmrRefundMaxReceiptAgeSec(),
      maxServedBytesPerReceipt: getXmrRefundMaxServedBytesPerReceipt(),
      minSessionAgeSec: getXmrRefundMinSessionAgeSec()
    }
  });

  if (!refundPolicy.ok) {
    return new Response(
      `refund threshold not met (servedBytes=${refundPolicy.servedBytes}, required=${minServedBytes}, reason=${refundPolicy.reason ?? "unknown"})`,
      { status: 403 }
    );
  }

  try {
    const balance = await client.getBalance({
      accountIndex: session.accountIndex,
      addressIndices: [session.addressIndex]
    });
    const sub = balance.perSubaddress.find((s) => s.addressIndex === session.addressIndex);
    const unlockedAtomic = sub?.unlockedAtomic ?? "0";
    if (unlockedAtomic === "0") {
      return Response.json({
        ok: true,
        action: "refund",
        settled: false,
        reason: "no_unlocked_balance",
        amountAtomic: "0",
        txids: [],
        servedBytes: refundPolicy.servedBytes,
        minServedBytes,
        fullServedBytes,
        creditPercentBps: refundPolicy.creditPercentBps,
        acceptedReceipts: refundPolicy.acceptedReceipts,
        rejectedReceipts: refundPolicy.rejectedReceipts
      });
    }

    const sweep = await client.sweepAll({
      accountIndex: session.accountIndex,
      addressIndex: session.addressIndex,
      address: refundAddress
    });

    return Response.json({
      ok: true,
      action: "refund",
      settled: true,
      amountAtomic: sweep.amountAtomic,
      txids: sweep.txids,
      destinationAddress: refundAddress,
      servedBytes: refundPolicy.servedBytes,
      minServedBytes,
      fullServedBytes,
      creditPercentBps: refundPolicy.creditPercentBps,
      acceptedReceipts: refundPolicy.acceptedReceipts,
      rejectedReceipts: refundPolicy.rejectedReceipts
    });
  } catch (err: any) {
    const message = `xmr refund error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
