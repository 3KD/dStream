import { decode as decodeNip19, npubEncode } from "nostr-tools/nip19";

function isHexPubkey(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test(input);
}

export function pubkeyParamToHex(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  if (isHexPubkey(raw)) return raw.toLowerCase();

  if (raw.startsWith("npub")) {
    try {
      const decoded = decodeNip19(raw);
      if (decoded.type === "npub" && typeof decoded.data === "string" && isHexPubkey(decoded.data)) {
        return decoded.data.toLowerCase();
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export function pubkeyHexToNpub(hex: string): string | null {
  const raw = (hex ?? "").trim();
  if (!isHexPubkey(raw)) return null;
  try {
    return npubEncode(raw.toLowerCase());
  } catch {
    return null;
  }
}
