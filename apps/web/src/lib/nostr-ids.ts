import { nip19 } from "nostr-tools";

function isHexPubkey(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test(input);
}

export function pubkeyParamToHex(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  if (isHexPubkey(raw)) return raw.toLowerCase();

  if (raw.startsWith("npub")) {
    try {
      const decoded = nip19.decode(raw);
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
    return nip19.npubEncode(raw.toLowerCase());
  } catch {
    return null;
  }
}

