import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AccessAction } from "./types";

const TOKEN_TTL_SEC_DEFAULT = 15 * 60;
const TOKEN_TTL_SEC_MAX = 60 * 60;

export interface AccessTokenPayload {
  v: 1;
  host: string;
  res: string;
  sub: string;
  act: AccessAction[];
  src: string;
  iat: number;
  exp: number;
  jti: string;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function getTokenSecret(): Buffer {
  const raw = (process.env.DSTREAM_ACCESS_TOKEN_SECRET ?? process.env.DSTREAM_PLAYBACK_ACCESS_SECRET ?? "").trim();
  if (raw) return Buffer.from(raw, "utf8");
  if (process.env.NODE_ENV === "production") {
    throw new Error("DSTREAM_ACCESS_TOKEN_SECRET is required in production. Set it in .env.");
  }
  // Dev-only: generate a per-process random secret so tokens can't be forged with known keys.
  const { randomBytes } = require("crypto");
  const devSecret = randomBytes(32);
  process.env.DSTREAM_ACCESS_TOKEN_SECRET = devSecret.toString("hex");
  return devSecret;
}

function signPayload(payloadEncoded: string): string {
  return createHmac("sha256", getTokenSecret()).update(payloadEncoded).digest("base64url");
}

function safeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function encodePayload(payload: AccessTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string): AccessTokenPayload | null {
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<AccessTokenPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== 1) return null;
    if (typeof parsed.host !== "string" || !parsed.host) return null;
    if (typeof parsed.res !== "string" || !parsed.res) return null;
    if (typeof parsed.sub !== "string") return null;
    if (!Array.isArray(parsed.act) || parsed.act.length === 0) return null;
    if (typeof parsed.src !== "string" || !parsed.src) return null;
    if (typeof parsed.iat !== "number" || !Number.isInteger(parsed.iat)) return null;
    if (typeof parsed.exp !== "number" || !Number.isInteger(parsed.exp)) return null;
    if (typeof parsed.jti !== "string" || !parsed.jti) return null;
    return parsed as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function issueAccessToken(input: {
  hostPubkey: string;
  resourceId: string;
  subjectPubkey?: string;
  actions: AccessAction[];
  sourceCode: string;
  ttlSec?: number;
}): { token: string; expiresAtSec: number; payload: AccessTokenPayload } {
  const issuedAtSec = nowSec();
  const ttlSec = Math.max(30, Math.min(input.ttlSec ?? TOKEN_TTL_SEC_DEFAULT, TOKEN_TTL_SEC_MAX));
  const expiresAtSec = issuedAtSec + ttlSec;
  const payload: AccessTokenPayload = {
    v: 1,
    host: input.hostPubkey.trim().toLowerCase(),
    res: input.resourceId.trim(),
    sub: (input.subjectPubkey ?? "").trim().toLowerCase(),
    act: input.actions,
    src: input.sourceCode.slice(0, 120),
    iat: issuedAtSec,
    exp: expiresAtSec,
    jti: randomBytes(10).toString("base64url")
  };
  const payloadEncoded = encodePayload(payload);
  const signature = signPayload(payloadEncoded);
  return {
    token: `${payloadEncoded}.${signature}`,
    expiresAtSec,
    payload
  };
}

export function verifyAccessToken(rawToken: string | null | undefined): { ok: true; payload: AccessTokenPayload } | { ok: false; error: string } {
  const token = (rawToken ?? "").trim();
  if (!token) return { ok: false, error: "missing token" };
  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) return { ok: false, error: "malformed token" };
  const expected = signPayload(payloadEncoded);
  if (!safeEquals(signature, expected)) return { ok: false, error: "invalid token signature" };
  const payload = decodePayload(payloadEncoded);
  if (!payload) return { ok: false, error: "invalid token payload" };
  const now = nowSec();
  if (payload.exp <= now) return { ok: false, error: "token expired" };
  if (payload.iat > now + 30) return { ok: false, error: "token issued in the future" };
  return { ok: true, payload };
}

