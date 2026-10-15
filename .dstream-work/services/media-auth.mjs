import { createHmac, timingSafeEqual } from "node:crypto";

const TTL = 36 * 60 * 60;
const validPath = (path) => typeof path === "string" && /^[a-f0-9]{64}--[a-zA-Z0-9][a-zA-Z0-9_-]{0,135}$/.test(path);
const validScope = (role, action, path) => validPath(path) && (role === "manifest" || role === "transcoder") &&
  (action === "read" || (action === "publish" && role === "transcoder" && /__r[0-9]{3,4}p$/.test(path)));
const mac = (secret, payload) => createHmac("sha256", secret).update(`dstream-media-service-v1:${payload}`).digest("base64url");

export function issueMediaServiceCredential(secret, role, path, action) {
  if (typeof secret !== "string" || secret.length < 32 || !validScope(role, action, path)) throw new Error("Invalid media service credential scope.");
  const payload = Buffer.from(JSON.stringify({ role, path, action, expiresAt: Math.floor(Date.now() / 1000) + TTL })).toString("base64url");
  return `${payload}.${mac(secret, payload)}`;
}

export function verifyMediaServiceCredential(token, path, action, secrets) {
  try {
    if (typeof token !== "string" || token.length > 2048) return false;
    const parts = token.split("."); if (parts.length !== 2) return false;
    const [payload, supplied] = parts;
    const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!validScope(claim.role, action, path) || claim.action !== action || claim.path !== path) return false;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(claim.expiresAt) || claim.expiresAt <= now || claim.expiresAt > now + TTL) return false;
    const secret = secrets[claim.role]; if (typeof secret !== "string" || secret.length < 32) return false;
    const expected = Buffer.from(mac(secret, payload)), actual = Buffer.from(supplied);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

function serviceToken(url, action) {
  const secret = process.env.DSTREAM_MEDIA_SERVICE_SECRET?.trim();
  if (!secret) return null; // Legacy development stacks may have no origin authorization.
  const path = decodeURIComponent(new URL(url).pathname.split("/")[1] ?? "");
  return issueMediaServiceCredential(secret, process.env.DSTREAM_MEDIA_SERVICE_ROLE, path, action);
}

export function mediaServiceReadHeaders(url) {
  const token = serviceToken(url, "read");
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function mediaServicePublishUrl(url) {
  const token = serviceToken(url, "publish"); if (!token) return url;
  const target = new URL(url); target.searchParams.set("pipeline", token); return target.href;
}
