const DEFAULT_NOSTR_RELAYS_DEV: string[] = [];
const DEFAULT_NOSTR_RELAYS_PROD = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.wine",
  "wss://relay.nostr.band",
  "wss://relay.snort.social",
  "wss://nostr.mom",
  "wss://offchain.pub",
  "wss://purplepag.es",
  "wss://relay.nostr.wirednet.jp"
];
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

function isHex64(input: string): boolean {
  return /^[0-9a-f]{64}$/i.test(input.trim());
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
    const rawIds = window.localStorage.getItem(NOSTR_RELAY_OVERRIDE_STORAGE_KEY);
    if (!rawIds) return [];
    const relayList = parseRelayList(rawIds);
    const cleansed = relayList.filter((r) => !r.includes("localhost") && !r.includes("127.0.0.1"));
    if (cleansed.length !== relayList.length) {
      window.localStorage.setItem(NOSTR_RELAY_OVERRIDE_STORAGE_KEY, JSON.stringify(cleansed));
    }
    return cleansed;
  } catch {
    return [];
  }
}

export function getNostrRelays(): string[] {
  const configuredRelays = parseRelayList(process.env.NEXT_PUBLIC_NOSTR_RELAYS);
  const override = getRelayOverrideFromStorage();
  
  let base = DEFAULT_NOSTR_RELAYS;
  if (configuredRelays.length > 0) base = [...configuredRelays, ...base];
  if (override.length > 0) base = [...override, ...base];

  if (process.env.NODE_ENV === "production") {
    base = base.filter((r) => !r.includes("localhost") && !r.includes("127.0.0.1"));
  }

  return uniq(base);
}

export function getNip05Policy(): Nip05Policy {
  const raw = (process.env.NEXT_PUBLIC_NIP05_POLICY || "").trim().toLowerCase();
  if (raw === "off" || raw === "badge" || raw === "require") return raw;
  return DEFAULT_NIP05_POLICY;
}

export function getDiscoveryOperatorPubkeys(): string[] {
  const raw = (process.env.NEXT_PUBLIC_DISCOVERY_OPERATOR_PUBKEYS ?? "").trim();
  if (!raw) return [];
  return uniq(
    raw
      .split(/[\n,]+/g)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => isHex64(value))
  );
}
