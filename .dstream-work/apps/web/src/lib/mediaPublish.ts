import { createHmac, timingSafeEqual } from "node:crypto";
import { parseOriginStreamIdFromPath } from "./playback-access";

const TTL_SEC = 36 * 60 * 60;

function secret(): string {
  const value = process.env.DSTREAM_MEDIA_AUTH_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("Media authorization is not configured.");
  return value;
}

export function equalMediaSecret(value: string): boolean {
  const expected = Buffer.from(secret());
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(`dstream-publish-v1:${payload}`).digest("base64url");
}

export function issuePublishCredential(originStreamId: string): { token: string; expiresAt: number } {
  if (parseOriginStreamIdFromPath([originStreamId]) !== originStreamId) throw new Error("Invalid stream identity.");
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SEC;
  const payload = Buffer.from(JSON.stringify({ originStreamId, expiresAt })).toString("base64url");
  return { token: `${payload}.${signature(payload)}`, expiresAt };
}

export function verifyPublishCredential(token: string, originStreamId: string): boolean {
  try {
    if (token.length > 2048) return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payload, supplied] = parts;
    if (!payload || !supplied) return false;
    const expected = Buffer.from(signature(payload)), actual = Buffer.from(supplied);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    return parsed.originStreamId === originStreamId && Number.isInteger(parsed.expiresAt) && parsed.expiresAt > now && parsed.expiresAt <= now + TTL_SEC;
  } catch { return false; }
}
