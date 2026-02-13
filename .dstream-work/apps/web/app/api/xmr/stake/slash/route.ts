import type { NextRequest } from "next/server";
import { assertStreamIdentity } from "@dstream/protocol";
import { validateEvent, verifyEvent } from "nostr-tools";
import { getXmrStakeSlashMinAgeSec, getXmrWalletRpcAccountIndex, getXmrWalletRpcClient } from "@/lib/monero/server";

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

function parseAddressIndex(input: any): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    const n = Math.trunc(input);
    return n >= 0 ? n : null;
  }
  if (typeof input === "string" && input.trim()) {
    const n = Number(input);
    if (!Number.isFinite(n)) return null;
    const i = Math.trunc(n);
    return i >= 0 ? i : null;
  }
  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const client = getXmrWalletRpcClient();
  if (!client) return new Response("xmr wallet rpc not configured", { status: 404 });

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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const streamPubkey = typeof body?.streamPubkey === "string" ? body.streamPubkey.trim().toLowerCase() : "";
  const streamId = typeof body?.streamId === "string" ? body.streamId.trim() : "";
  const addressIndex = parseAddressIndex(body?.addressIndex);
  if (addressIndex === null) return new Response("invalid addressIndex", { status: 400 });

  try {
    assertStreamIdentity(streamPubkey, streamId);
  } catch (err: any) {
    return new Response(err?.message ?? "invalid stream identity", { status: 400 });
  }

  const broadcasterPubkey = typeof authEvent.pubkey === "string" ? authEvent.pubkey.trim().toLowerCase() : "";
  if (broadcasterPubkey !== streamPubkey) return new Response("not authorized for stream", { status: 403 });

  const accountIndex = getXmrWalletRpcAccountIndex();
  const slashMinAgeSec = getXmrStakeSlashMinAgeSec();

  try {
    const incoming = await client.getIncomingTransfers();
    const matches = incoming.filter((t) => t.subaddrIndex.major === accountIndex && t.subaddrIndex.minor === addressIndex);
    const lastTimestampSec = matches.reduce((best, t) => Math.max(best, t.timestampSec ?? 0), 0);
    const now = Math.floor(Date.now() / 1000);
    if (lastTimestampSec > 0 && now - lastTimestampSec < slashMinAgeSec) {
      const waitSec = slashMinAgeSec - (now - lastTimestampSec);
      return new Response(`slash window not reached (wait ${waitSec}s)`, { status: 409 });
    }

    const balance = await client.getBalance({ accountIndex, addressIndices: [addressIndex] });
    const sub = balance.perSubaddress.find((s) => s.addressIndex === addressIndex);
    const unlockedAtomic = sub?.unlockedAtomic ?? "0";
    if (unlockedAtomic === "0") {
      return Response.json({
        ok: true,
        action: "slash",
        settled: false,
        reason: "no_unlocked_balance",
        amountAtomic: "0",
        txids: [],
        addressIndex
      });
    }

    const destinationAddressRaw = typeof body?.destinationAddress === "string" ? body.destinationAddress.trim() : "";
    const destinationAddress = destinationAddressRaw || (await client.getAddress({ accountIndex })).address;
    if (!destinationAddress) return new Response("destination address unavailable", { status: 502 });

    const sweep = await client.sweepAll({
      accountIndex,
      addressIndex,
      address: destinationAddress
    });

    return Response.json({
      ok: true,
      action: "slash",
      settled: true,
      amountAtomic: sweep.amountAtomic,
      txids: sweep.txids,
      addressIndex,
      destinationAddress,
      slashMinAgeSec,
      lastObservedAtMs: lastTimestampSec > 0 ? lastTimestampSec * 1000 : null
    });
  } catch (err: any) {
    const message = `xmr slash error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
