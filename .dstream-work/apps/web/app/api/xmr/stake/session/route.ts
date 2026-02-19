import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { assertStreamIdentity } from "@dstream/protocol";
import { validateEvent, verifyEvent } from "nostr-tools";
import { getXmrConfirmationsRequired, getXmrStakeSessionTtlSec, getXmrWalletRpcAccountIndex, getXmrWalletRpcClient } from "@/lib/monero/server";
import { expireStakeSession, getActiveStakeSessionForViewerStream, markStakeSessionObserved, registerStakeSession } from "@/lib/monero/stakeSessionStore";
import { makeStakeLabel, signStakeSession, type StakeSessionV1 } from "@/lib/monero/stakeSession";
import { getStakeTotals } from "@/lib/monero/stakeVerify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makeNonce(): string {
  return crypto.randomBytes(10).toString("base64url");
}

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

function isHex64(input: string): boolean {
  return /^[0-9a-f]{64}$/i.test(input);
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

  try {
    assertStreamIdentity(streamPubkey, streamId);
  } catch (err: any) {
    return new Response(err?.message ?? "invalid stream identity", { status: 400 });
  }

  const viewerPubkey = typeof authEvent?.pubkey === "string" ? authEvent.pubkey.trim().toLowerCase() : "";
  if (!isHex64(viewerPubkey)) return new Response("invalid viewer pubkey", { status: 400 });

  const accountIndex = getXmrWalletRpcAccountIndex();
  const createdAtMs = Date.now();
  const nonce = makeNonce();
  const label = makeStakeLabel({ streamPubkey, streamId, viewerPubkey, nonce });

  try {
    const existing = getActiveStakeSessionForViewerStream({ viewerPubkey, streamPubkey, streamId });
    if (existing) {
      const ttlMs = getXmrStakeSessionTtlSec() * 1000;
      const ageMs = Date.now() - existing.createdAtMs;

      if (existing.lastObservedAtMs === null && ageMs > ttlMs) {
        const totals = await getStakeTotals({
          client,
          accountIndex: existing.payload.accountIndex,
          addressIndex: existing.payload.addressIndex,
          confirmationsRequired: getXmrConfirmationsRequired()
        });
        if (totals.transferCount > 0) {
          markStakeSessionObserved(existing.token, totals.lastObservedAtMs ?? Date.now());
        } else {
          expireStakeSession(existing.token);
        }
      }
    }

    const reusable = getActiveStakeSessionForViewerStream({ viewerPubkey, streamPubkey, streamId });
    if (reusable) {
      return Response.json({
        ok: true,
        address: reusable.address,
        accountIndex: reusable.payload.accountIndex,
        addressIndex: reusable.payload.addressIndex,
        viewerPubkey,
        session: reusable.token,
        reused: true
      });
    }

    const created = await client.createAddress({ accountIndex, label });
    const payload: StakeSessionV1 = {
      v: 1,
      t: "xmr_stake_session",
      streamPubkey,
      streamId,
      viewerPubkey,
      accountIndex,
      addressIndex: created.addressIndex,
      createdAtMs,
      nonce
    };
    const session = signStakeSession(payload);
    registerStakeSession({
      token: session,
      payload,
      address: created.address
    });
    return Response.json({
      ok: true,
      address: created.address,
      accountIndex,
      addressIndex: created.addressIndex,
      viewerPubkey,
      session,
      reused: false
    });
  } catch (err: any) {
    const message = `xmr stake session error (${err?.message ?? "unknown"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
