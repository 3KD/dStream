import { assertStreamIdentity } from "./nostr";

function bytesToBase64Url(bytes: Uint8Array): string {
  // Node.js
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  // Browser
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function deriveSwarmId(input: { streamPubkey: string; streamId: string; rendition?: string }): Promise<string> {
  assertStreamIdentity(input.streamPubkey, input.streamId);
  const rendition = input.rendition ?? "default";

  const payload = `${input.streamPubkey}:${input.streamId}:${rendition}`;
  const subtle = (globalThis as any).crypto?.subtle;
  if (!subtle?.digest) throw new Error("WebCrypto subtle.digest unavailable");

  const bytes = new TextEncoder().encode(payload);
  const digest = await subtle.digest("SHA-256", bytes);
  return bytesToBase64Url(new Uint8Array(digest));
}

