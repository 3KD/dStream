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
  const labelPrefix = `dstream_tip:${streamPubkey}:${streamId}:`;

  try {
    const addr = await client.getAddress({ accountIndex });
    const indices = new Set<number>();
    for (const a of addr.addresses) {
      if (!a.label) continue;
      if (!a.label.startsWith(labelPrefix)) continue;
      indices.add(a.addressIndex);
    }

    if (indices.size === 0) return Response.json({ ok: true, tips: [] });

    const incoming = await client.getIncomingTransfers();
    const tips = incoming
      .filter((t) => t.subaddrIndex.major === accountIndex && indices.has(t.subaddrIndex.minor))
      .map((t) => {
        const observedAtMs = (t.timestampSec ?? Math.floor(Date.now() / 1000)) * 1000;
        const confirmed = t.confirmations >= confirmationsRequired;
        return {
          amountAtomic: t.amountAtomic,
          confirmations: t.confirmations,
          confirmed,
          observedAtMs,
          txid: t.txid ?? null,
          addressIndex: t.subaddrIndex.minor
        };
      })
      .sort((a, b) => b.observedAtMs - a.observedAtMs);

    const byAddressIndex = new Map<
      number,
      {
        transferCount: number;
        totalAtomic: bigint;
        confirmedAtomic: bigint;
        observedAtMs: number;
        txid: string | null;
      }
    >();

    let totalAtomic = 0n;
    let confirmedAtomic = 0n;

    for (const tip of tips) {
      const amount = toBigInt(tip.amountAtomic);
      totalAtomic += amount;
      if (tip.confirmed) confirmedAtomic += amount;

      const agg =
        byAddressIndex.get(tip.addressIndex) ??
        {
          transferCount: 0,
          totalAtomic: 0n,
          confirmedAtomic: 0n,
          observedAtMs: 0,
          txid: null
        };
      agg.transferCount += 1;
      agg.totalAtomic += amount;
      if (tip.confirmed) agg.confirmedAtomic += amount;
      if (tip.observedAtMs >= agg.observedAtMs) {
        agg.observedAtMs = tip.observedAtMs;
        agg.txid = tip.txid ?? agg.txid;
      }
      byAddressIndex.set(tip.addressIndex, agg);
    }

    const groups = Array.from(byAddressIndex.entries())
      .map(([addressIndex, value]) => ({
        addressIndex,
        transferCount: value.transferCount,
        totalAtomic: value.totalAtomic.toString(),
        confirmedAtomic: value.confirmedAtomic.toString(),
        observedAtMs: value.observedAtMs || null,
        txid: value.txid
      }))
      .sort((a, b) => (b.observedAtMs ?? 0) - (a.observedAtMs ?? 0));

    return Response.json({
      ok: true,
      tips,
      aggregates: {
        groupCount: groups.length,
        totals: {
          transferCount: tips.length,
          totalAtomic: totalAtomic.toString(),
          confirmedAtomic: confirmedAtomic.toString()
        },
        groups
      }
    });
  } catch (err: any) {
    const message = `xmr tip list error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
