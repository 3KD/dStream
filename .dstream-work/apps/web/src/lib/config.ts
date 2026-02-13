const DEFAULT_NOSTR_RELAYS_DEV = ["ws://localhost:8081"];
const DEFAULT_NOSTR_RELAYS_PROD = ["wss://relay.damus.io", "wss://nos.lol"];
const DEFAULT_NIP05_POLICY = "badge";
export const NOSTR_RELAY_OVERRIDE_STORAGE_KEY = "dstream_nostr_relays_override_v1";

export type Nip05Policy = "off" | "badge" | "require";

export const DEFAULT_NOSTR_RELAYS =
  process.env.NODE_ENV === "development" ? DEFAULT_NOSTR_RELAYS_DEV : DEFAULT_NOSTR_RELAYS_PROD;

function isValidRelayUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "ws:" || u.protocol === "wss:";
  } catch {
    return false;
  }
}

function uniq(strings: string[]): string[] {
  return Array.from(new Set(strings));
}

export function parseRelayList(raw: string | null | undefined): string[] {
  if (!raw) return [];

  const parsed: string[] = (() => {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[")) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) return arr.filter((v) => typeof v === "string") as string[];
      } catch {
        // fall back to CSV
      }
    }

    return trimmed
      .split(/[\n,]+/g)
      .map((relay) => relay.trim())
      .filter(Boolean);
  })();

  return uniq(parsed).filter(isValidRelayUrl);
}

function getRelayOverrideFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseRelayList(window.localStorage.getItem(NOSTR_RELAY_OVERRIDE_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function getNostrRelays(): string[] {
  const override = getRelayOverrideFromStorage();
  if (override.length > 0) return override;

  const relays = parseRelayList(process.env.NEXT_PUBLIC_NOSTR_RELAYS);

  return relays.length > 0 ? relays : DEFAULT_NOSTR_RELAYS;
}

export function getNip05Policy(): Nip05Policy {
  const raw = (process.env.NEXT_PUBLIC_NIP05_POLICY || "").trim().toLowerCase();
  if (raw === "off" || raw === "badge" || raw === "require") return raw;
  return DEFAULT_NIP05_POLICY;
}
