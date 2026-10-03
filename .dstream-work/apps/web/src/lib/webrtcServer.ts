import { createHmac, randomBytes } from "node:crypto";

const DEFAULT_TTL_SEC = 600;
const MIN_TTL_SEC = 60;
const MAX_TTL_SEC = 86_400;

export type IssuedTurnCredentials = {
  iceServer: {
    urls: string | string[];
    username: string;
    credential: string;
  };
  expiresAt: number;
};

export function parseTurnUrls(raw: string | undefined): string[] {
  const value = String(raw ?? "").trim();
  if (!value) return [];

  let entries: unknown[];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      entries = value.split(",");
    }
  } else {
    entries = value.split(",");
  }

  return Array.from(
    new Set(
      entries
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => /^(?:turn|turns):[^\s@]+$/i.test(entry))
    )
  ).slice(0, 8);
}

export function parseTurnCredentialTtl(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SEC;
  return Math.max(MIN_TTL_SEC, Math.min(MAX_TTL_SEC, parsed));
}

export function issueTurnCredentials(opts: {
  urls: string[];
  sharedSecret: string;
  ttlSec?: number;
  nowSec?: number;
  nonce?: string;
}): IssuedTurnCredentials {
  const urls = opts.urls.filter((url) => /^(?:turn|turns):[^\s@]+$/i.test(url));
  if (urls.length === 0) throw new Error("TURN URLs are not configured.");

  const sharedSecret = opts.sharedSecret.trim();
  if (sharedSecret.length < 32) throw new Error("TURN shared secret is not configured securely.");

  const nowSec = Math.floor(opts.nowSec ?? Date.now() / 1000);
  const ttlSec = Math.max(MIN_TTL_SEC, Math.min(MAX_TTL_SEC, opts.ttlSec ?? DEFAULT_TTL_SEC));
  const expiresAt = nowSec + ttlSec;
  const nonce = opts.nonce?.trim() || randomBytes(8).toString("hex");
  const username = `${expiresAt}:${nonce}`;
  const credential = createHmac("sha1", sharedSecret).update(username).digest("base64");

  return {
    iceServer: {
      urls: urls.length === 1 ? urls[0]! : urls,
      username,
      credential
    },
    expiresAt
  };
}
