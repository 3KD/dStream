import crypto from "node:crypto";
import { getXmrSessionSecret } from "@/lib/monero/sessionSecret";

export type VideoAccessTokenV1 = {
  v: 1;
  t: "dstream_video_access";
  streamPubkey: string;
  streamId: string;
  accessScope?: "stream" | "playlist";
  playlistId?: string;
  expMs: number;
};

function hmac(payloadJson: string): string {
  return crypto.createHmac("sha256", getXmrSessionSecret()).update(payloadJson, "utf8").digest("base64url");
}

export function signVideoAccessToken(payload: VideoAccessTokenV1): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const sig = hmac(json);
  return `${b64}.${sig}`;
}

export function verifyVideoAccessToken(token: string): VideoAccessTokenV1 | null {
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
  if (obj.v !== 1 || obj.t !== "dstream_video_access") return null;
  if (typeof obj.streamPubkey !== "string" || !/^[0-9a-f]{64}$/i.test(obj.streamPubkey)) return null;
  if (typeof obj.streamId !== "string" || !obj.streamId.trim()) return null;
  if (obj.accessScope !== undefined && obj.accessScope !== "stream" && obj.accessScope !== "playlist") return null;
  if (obj.playlistId !== undefined && (typeof obj.playlistId !== "string" || !obj.playlistId.trim())) return null;
  if (typeof obj.expMs !== "number" || !Number.isFinite(obj.expMs) || obj.expMs <= 0) return null;

  return {
    ...(obj as VideoAccessTokenV1),
    accessScope: obj.accessScope === "playlist" ? "playlist" : "stream",
    playlistId: typeof obj.playlistId === "string" && obj.playlistId.trim() ? obj.playlistId.trim() : undefined
  };
}
