import { SimplePool, type Filter } from "nostr-tools";

const RELAY_FAILURE_BASE_BACKOFF_MS = 30_000;
const RELAY_FAILURE_MAX_BACKOFF_MS = 10 * 60_000;
const RELAY_FAILURE_DEDUP_MS = 1_000;
const RELAY_SUCCESS_RECONNECT_COOLDOWN_MS = 60_000;

interface RelayHealth {
  failures: number;
  lastFailureAt: number;
  blockedUntil: number;
}

interface NostrRuntimeState {
  pool: SimplePool | null;
  relayHealth: Map<string, RelayHealth>;
}

type DStreamGlobal = typeof globalThis & {
  __dstreamNostrRuntime?: NostrRuntimeState;
};

const dstreamGlobal = globalThis as DStreamGlobal;
const nostrRuntime =
  dstreamGlobal.__dstreamNostrRuntime ??
  (dstreamGlobal.__dstreamNostrRuntime = {
    pool: null,
    relayHealth: new Map<string, RelayHealth>()
  });
const relayHealth = nostrRuntime.relayHealth;

export function normalizeRelayHealthKey(url: string): string {
  const value = url.trim();
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

export function relayBackoffMs(failures: number): number {
  const exponent = Math.max(0, Math.min(5, Math.trunc(failures) - 1));
  return Math.min(RELAY_FAILURE_MAX_BACKOFF_MS, RELAY_FAILURE_BASE_BACKOFF_MS * 2 ** exponent);
}

function recordRelayFailure(url: string): void {
  const key = normalizeRelayHealthKey(url);
  const now = Date.now();
  const previous = relayHealth.get(key);
  if (previous && now - previous.lastFailureAt < RELAY_FAILURE_DEDUP_MS) return;
  const failures = (previous?.failures ?? 0) + 1;
  relayHealth.set(key, {
    failures,
    lastFailureAt: now,
    blockedUntil: now + relayBackoffMs(failures)
  });
}

function recordRelaySuccess(url: string): void {
  const key = normalizeRelayHealthKey(url);
  const previous = relayHealth.get(key);
  relayHealth.set(key, {
    failures: previous?.failures ?? 0,
    lastFailureAt: previous?.lastFailureAt ?? 0,
    blockedUntil: Date.now() + RELAY_SUCCESS_RECONNECT_COOLDOWN_MS
  });
}

function isRelayConnected(key: string): boolean {
  const statuses = nostrRuntime.pool?.listConnectionStatus();
  if (!statuses) return false;
  for (const [url, connected] of statuses) {
    if (connected && normalizeRelayHealthKey(url) === key) return true;
  }
  return false;
}

function canConnectToRelay(url: string): boolean {
  const key = normalizeRelayHealthKey(url);
  if (isRelayConnected(key)) return true;
  return (relayHealth.get(key)?.blockedUntil ?? 0) <= Date.now();
}

export function getPool(): SimplePool {
  if (!nostrRuntime.pool) {
    nostrRuntime.pool = new SimplePool({
      enableReconnect: false,
      onRelayConnectionFailure: recordRelayFailure,
      onRelayConnectionSuccess: recordRelaySuccess,
      allowConnectingToRelay: canConnectToRelay,
      maxWaitForConnection: 3_000
    } as any);
  }
  return nostrRuntime.pool;
}

export function subscribeMany(
  relays: string[],
  filters: Filter[],
  handlers: { onevent: (event: any) => void; oneose?: () => void }
): any {
  const p = getPool();
  if (!filters || filters.length === 0) throw new Error("subscribeMany requires at least one filter");

  const activeRelays = relays.filter(canConnectToRelay);
  if (activeRelays.length === 0) {
    queueMicrotask(() => handlers.oneose?.());
    return { close() {} };
  }
  const requests = activeRelays.flatMap((url) => filters.map((filter) => ({ url, filter })));
  return (p as any).subscribeMap(requests, handlers);
}
