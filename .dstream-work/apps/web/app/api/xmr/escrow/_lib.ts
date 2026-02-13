import type { NextRequest } from "next/server";
import { validateEvent, verifyEvent } from "nostr-tools";

export function parseAuthEvent(req: NextRequest): any | null {
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

export function getFirstTagValue(tags: any, key: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (!Array.isArray(tag)) continue;
    if (tag[0] !== key) continue;
    if (typeof tag[1] !== "string") continue;
    return tag[1];
  }
  return null;
}

export function isRecent(createdAtSec: number, maxSkewSec: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - createdAtSec) <= maxSkewSec;
}

export function isHex64(input: string): boolean {
  return /^[0-9a-f]{64}$/i.test(input);
}

export function parseHex64Array(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out = input
    .map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""))
    .filter(Boolean);
  if (out.some((v) => !isHex64(v))) return null;
  return Array.from(new Set(out));
}

export function validateNip98Auth(req: NextRequest, expectedMethod: "GET" | "POST"): { pubkey: string } | Response {
  const authEvent = parseAuthEvent(req);
  if (!authEvent) return new Response("missing NIP-98 auth", { status: 401 });
  if (!validateEvent(authEvent) || !verifyEvent(authEvent)) return new Response("invalid NIP-98 auth", { status: 401 });
  if (authEvent.kind !== 27235) return new Response("invalid NIP-98 kind", { status: 401 });
  if (!isRecent(authEvent.created_at, 60)) return new Response("stale NIP-98 auth", { status: 401 });

  const expectedUrl = req.nextUrl.toString();
  const u = getFirstTagValue(authEvent.tags, "u");
  const method = getFirstTagValue(authEvent.tags, "method");
  if (u !== expectedUrl) return new Response("NIP-98 url mismatch", { status: 401 });
  if ((method ?? "").toUpperCase() !== expectedMethod) return new Response("NIP-98 method mismatch", { status: 401 });

  const pubkey = typeof authEvent.pubkey === "string" ? authEvent.pubkey.trim().toLowerCase() : "";
  if (!isHex64(pubkey)) return new Response("invalid auth pubkey", { status: 401 });
  return { pubkey };
}

export function normalizeMultisigInfo(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value ? value : null;
}

export function normalizeTxDataHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  if (!/^[0-9a-f]+$/i.test(value)) return null;
  return value.toLowerCase();
}

