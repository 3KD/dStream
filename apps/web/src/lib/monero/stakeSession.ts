import crypto from "node:crypto";
import { getXmrSessionSecret } from "./sessionSecret";

export type StakeSessionV1 = {
  v: 1;
  t: "xmr_stake_session";
  streamPubkey: string;
  streamId: string;
  viewerPubkey: string;
  accountIndex: number;
  addressIndex: number;
  createdAtMs: number;
  nonce: string;
};

function hmac(payloadJson: string): string {
  return crypto.createHmac("sha256", getXmrSessionSecret()).update(payloadJson, "utf8").digest("base64url");
}

export function makeStakeLabel(session: { streamPubkey: string; streamId: string; nonce: string }): string {
  return `dstream_stake:${session.streamPubkey}:${session.streamId}:${session.nonce}`;
}

export function signStakeSession(payload: StakeSessionV1): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const sig = hmac(json);
  return `${b64}.${sig}`;
}

export function verifyStakeSession(token: string): StakeSessionV1 | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;

  let json: string;
  try {
    json = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedSig = hmac(json);
  try {
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expectedSig, "base64url");
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  let obj: any;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }

  if (!obj || typeof obj !== "object") return null;
  if (obj.v !== 1 || obj.t !== "xmr_stake_session") return null;
  if (typeof obj.streamPubkey !== "string" || typeof obj.streamId !== "string") return null;
  if (typeof obj.viewerPubkey !== "string" || !/^[0-9a-f]{64}$/i.test(obj.viewerPubkey)) return null;
  if (typeof obj.accountIndex !== "number" || !Number.isInteger(obj.accountIndex) || obj.accountIndex < 0) return null;
  if (typeof obj.addressIndex !== "number" || !Number.isInteger(obj.addressIndex) || obj.addressIndex < 0) return null;
  if (typeof obj.createdAtMs !== "number" || !Number.isFinite(obj.createdAtMs) || obj.createdAtMs <= 0) return null;
  if (typeof obj.nonce !== "string" || !obj.nonce.trim()) return null;

  return obj as StakeSessionV1;
}
