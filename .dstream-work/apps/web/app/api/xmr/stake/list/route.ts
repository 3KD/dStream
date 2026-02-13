import type { NextRequest } from "next/server";
import { assertStreamIdentity } from "@dstream/protocol";
import { validateEvent, verifyEvent } from "nostr-tools";
import { getXmrConfirmationsRequired, getXmrWalletRpcAccountIndex, getXmrWalletRpcClient } from "@/lib/monero/server";

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

function toBigInt(amountAtomic: string): bigint {
  if (!/^\d+$/.test(amountAtomic)) return 0n;
  try {
    return BigInt(amountAtomic);
  } catch {
    return 0n;
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

  const streamPubkey = typeof body?.streamPubkey === "string" ? body.streamPubkey.trim().toLowerCase() : "";
  const streamId = typeof body?.streamId === "string" ? body.streamId.trim() : "";
  try {
    assertStreamIdentity(streamPubkey, streamId);
  } catch (err: any) {
    return new Response(err?.message ?? "invalid stream identity", { status: 400 });
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

  if (authEvent.pubkey !== streamPubkey) return new Response("not authorized for stream", { status: 403 });

  const accountIndex = getXmrWalletRpcAccountIndex();
  const confirmationsRequired = getXmrConfirmationsRequired();
  const labelPrefix = `dstream_stake:${streamPubkey}:${streamId}:`;

  try {
    const addr = await client.getAddress({ accountIndex });
    const indices = new Set<number>();
    for (const a of addr.addresses) {
      if (!a.label) continue;
      if (!a.label.startsWith(labelPrefix)) continue;
      indices.add(a.addressIndex);
    }

    if (indices.size === 0) return Response.json({ ok: true, stakes: [] });

  const incoming = await client.getIncomingTransfers();

  const byIndex = new Map<
    number,
    {
      total: bigint;
      confirmed: bigint;
      transferCount: number;
      confirmationsMax: number;
      lastObservedAtMs: number;
      lastTxid: string | null;
    }
  >();

    for (const t of incoming) {
      if (t.subaddrIndex.major !== accountIndex) continue;
      if (!indices.has(t.subaddrIndex.minor)) continue;
      if (t.spent === true) continue;
      const idx = t.subaddrIndex.minor;
      const item =
        byIndex.get(idx) ??
        {
          total: 0n,
          confirmed: 0n,
          transferCount: 0,
          confirmationsMax: 0,
          lastObservedAtMs: 0,
          lastTxid: null
        };

      const amt = toBigInt(t.amountAtomic);
      item.total += amt;
      if (t.confirmations >= confirmationsRequired) item.confirmed += amt;
      item.transferCount += 1;
      item.confirmationsMax = Math.max(item.confirmationsMax, t.confirmations);

      const observedAtMs = (t.timestampSec ?? Math.floor(Date.now() / 1000)) * 1000;
      if (observedAtMs >= item.lastObservedAtMs) {
        item.lastObservedAtMs = observedAtMs;
        item.lastTxid = t.txid ?? item.lastTxid;
      }

      byIndex.set(idx, item);
    }

    const stakes = Array.from(byIndex.entries())
      .map(([addressIndex, v]) => ({
        addressIndex,
        transferCount: v.transferCount,
        totalAtomic: v.total.toString(),
        confirmedAtomic: v.confirmed.toString(),
        confirmationsMax: v.confirmationsMax,
        observedAtMs: v.lastObservedAtMs || null,
        txid: v.lastTxid
      }))
      .sort((a, b) => (b.observedAtMs ?? 0) - (a.observedAtMs ?? 0));

    let totalAtomic = 0n;
    let confirmedAtomic = 0n;
    let transferCount = 0;

    for (const stake of stakes) {
      totalAtomic += toBigInt(stake.totalAtomic);
      confirmedAtomic += toBigInt(stake.confirmedAtomic);
      transferCount += stake.transferCount;
    }

    return Response.json({
      ok: true,
      stakes,
      confirmationsRequired,
      aggregates: {
        groupCount: stakes.length,
        totals: {
          transferCount,
          totalAtomic: totalAtomic.toString(),
          confirmedAtomic: confirmedAtomic.toString()
        },
        groups: stakes.map((s) => ({
          addressIndex: s.addressIndex,
          transferCount: s.transferCount,
          totalAtomic: s.totalAtomic,
          confirmedAtomic: s.confirmedAtomic,
          observedAtMs: s.observedAtMs,
          txid: s.txid
        }))
      }
    });
  } catch (err: any) {
    const message = `xmr stake list error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
