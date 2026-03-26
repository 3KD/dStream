/**
 * Pairing API for mobile app ↔ home server.
 *
 * GET  /api/pair          — Generate a new pair token + QR payload.
 * POST /api/pair          — Confirm pairing (mobile sends back the token).
 *
 * Gated by DSTREAM_PAIR_SECRET. If unset, pairing is disabled (404).
 */

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// In-memory token store (no DB needed — tokens are short-lived)
// ---------------------------------------------------------------------------

interface PairToken {
  token: string;
  createdAt: number;
}

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ACTIVE_TOKENS = 10; // Cap to prevent memory exhaustion
const tokens = new Map<string, PairToken>();

// Rate limiting: max 6 token generations per minute per IP.
const rateLimitWindow = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 6;
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitWindow.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimitWindow.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

function cleanExpiredTokens() {
  const now = Date.now();
  for (const [key, entry] of tokens) {
    if (now - entry.createdAt > TOKEN_TTL_MS) tokens.delete(key);
  }
  // Clean stale rate limit entries.
  for (const [ip, entry] of rateLimitWindow) {
    if (now >= entry.resetAt) rateLimitWindow.delete(ip);
  }
}

function getPairSecret(): string | null {
  return process.env.DSTREAM_PAIR_SECRET?.trim() || null;
}

function getRelays(): string[] {
  const raw = process.env.NEXT_PUBLIC_NOSTR_RELAYS?.trim();
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter((v: unknown) => typeof v === "string");
  } catch { /* */ }
  return raw
    .split(/[\n,]+/g)
    .map((r) => r.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// GET — generate pair payload
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  if (!getPairSecret()) {
    return NextResponse.json({ error: "Pairing disabled" }, { status: 404 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many pairing requests. Try again in a minute." }, { status: 429 });
  }

  cleanExpiredTokens();

  // Cap active tokens to prevent memory exhaustion.
  if (tokens.size >= MAX_ACTIVE_TOKENS) {
    return NextResponse.json({ error: "Too many active pairing tokens. Wait for some to expire." }, { status: 429 });
  }

  const token = randomBytes(32).toString("hex");
  tokens.set(token, { token, createdAt: Date.now() });

  // Derive edge URL from the incoming request's origin.
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("host") || "localhost:5656";
  const edgeUrl = `${proto}://${host}`;

  const relays = getRelays();
  // Include the local relay if the server runs one on the same host.
  const localRelay = `ws://${host.split(":")[0]}:8081`;
  const allRelays = relays.includes(localRelay) ? relays : [localRelay, ...relays];

  const payload = {
    v: 1,
    t: "dstream-pair",
    edge: edgeUrl,
    relays: allRelays,
    tok: token,
  };

  return NextResponse.json(payload);
}

// ---------------------------------------------------------------------------
// POST — confirm pairing
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (!getPairSecret()) {
    return NextResponse.json({ error: "Pairing disabled" }, { status: 404 });
  }

  cleanExpiredTokens();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tok = typeof body?.tok === "string" ? body.tok.trim() : "";
  if (!tok) {
    return NextResponse.json({ error: "Missing tok" }, { status: 400 });
  }

  const entry = tokens.get(tok);
  if (!entry) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 403 });
  }

  // Invalidate token after use.
  tokens.delete(tok);

  return NextResponse.json({ ok: true });
}
