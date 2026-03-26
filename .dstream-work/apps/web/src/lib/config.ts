const DEFAULT_NOSTR_RELAYS_DEV = ["ws://localhost:8081"];
const DEFAULT_NOSTR_RELAYS_PROD = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
  "wss://nostr.mom",
  "wss://offchain.pub",
  "wss://purplepag.es",
  "wss://relay.nostr.wirednet.jp"
];
const DEFAULT_NIP05_POLICY = "badge";
export const NOSTR_RELAY_OVERRIDE_STORAGE_KEY = "dstream_nostr_relays_override_v1";
export const LOCAL_RELAY_ENABLED_KEY = "dstream_local_relay_enabled_v1";
export const LOCAL_RELAY_URL = "local://self";

export type Nip05Policy = "off" | "badge" | "require";

export const DEFAULT_NOSTR_RELAYS =
  process.env.NODE_ENV === "development" ? DEFAULT_NOSTR_RELAYS_DEV : DEFAULT_NOSTR_RELAYS_PROD;

export function isLocalRelayEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOCAL_RELAY_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function isValidRelayUrl(url: string): boolean {
  if (url === LOCAL_RELAY_URL) return true;
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
    return parseRelayList(window.localStorage.getItem(NOSTR_RELAY_OVERRIDE_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function getNostrRelays(): string[] {
  const configuredRelays = parseRelayList(process.env.NEXT_PUBLIC_NOSTR_RELAYS);
  const override = getRelayOverrideFromStorage();
  let relays: string[];
  if (override.length > 0) {
    relays = uniq([...override, ...configuredRelays, ...DEFAULT_NOSTR_RELAYS]);
  } else if (configuredRelays.length > 0) {
    relays = uniq([...configuredRelays, ...DEFAULT_NOSTR_RELAYS]);
  } else {
    relays = [...DEFAULT_NOSTR_RELAYS];
  }
  if (isLocalRelayEnabled()) {
    relays.unshift(LOCAL_RELAY_URL);
  }
  return relays;
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
