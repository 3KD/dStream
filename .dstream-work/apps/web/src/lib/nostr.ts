import { AbstractSimplePool } from "nostr-tools/abstract-pool";
import { verifiedSymbol, type Event as NostrEvent, type VerifiedEvent } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { createNostrWasmVerifier, loadNostrWasm } from "./nostrWasm";

const RELAY_FAILURE_BASE_BACKOFF_MS = 30_000;
const RELAY_FAILURE_MAX_BACKOFF_MS = 10 * 60_000;
const RELAY_FAILURE_DEDUP_MS = 1_000;
const RELAY_SUCCESS_RECONNECT_COOLDOWN_MS = 60_000;
const EVENT_VERIFICATION_CACHE_MAX = 4_096;

type EventVerifier = (event: NostrEvent) => event is VerifiedEvent;
type BaseEventVerifier = (event: NostrEvent) => boolean;

export function createCachedEventVerifier(
  baseVerify: BaseEventVerifier,
  maxEntries = EVENT_VERIFICATION_CACHE_MAX
): EventVerifier {
  const cache = new Map<string, boolean>();
  const capacity = Math.max(1, Math.trunc(maxEntries));

  return (event): event is VerifiedEvent => {
    const id = typeof event?.id === "string" ? event.id : "";
    const signature = typeof event?.sig === "string" ? event.sig : "";
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{128}$/.test(signature)) {
      return baseVerify(event);
    }

    const key = `${id}:${signature}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      event[verifiedSymbol] = cached;
      return cached;
    }

    const verified = baseVerify(event);
    cache.set(key, verified);
    if (cache.size > capacity) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return verified;
  };
}

interface RelayHealth {
  failures: number;
  lastFailureAt: number;
  blockedUntil: number;
}

interface NostrRuntimeState {
  pool: AbstractSimplePool | null;
  poolPromise: Promise<AbstractSimplePool> | null;
  relayHealth: Map<string, RelayHealth>;
}

type DStreamGlobal = typeof globalThis & {
  __dstreamNostrRuntimeV2?: NostrRuntimeState;
};

const dstreamGlobal = globalThis as DStreamGlobal;
const nostrRuntime =
  dstreamGlobal.__dstreamNostrRuntimeV2 ??
  (dstreamGlobal.__dstreamNostrRuntimeV2 = {
    pool: null,
    poolPromise: null,
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

export async function getPool(): Promise<AbstractSimplePool> {
  if (nostrRuntime.pool) return nostrRuntime.pool;
  if (nostrRuntime.poolPromise) return nostrRuntime.poolPromise;

  nostrRuntime.poolPromise = createNostrPool()
    .then((pool) => {
      nostrRuntime.pool = pool;
      return pool;
    })
    .catch((error) => {
      nostrRuntime.poolPromise = null;
      throw error;
    });

  return nostrRuntime.poolPromise;
}

export function getReadyPool(): AbstractSimplePool | null {
  return nostrRuntime.pool;
}

export async function createNostrPool(options?: { sharedRelayHealth?: boolean }): Promise<AbstractSimplePool> {
  const runtime = await loadNostrWasm();
  const sharedRelayHealth = options?.sharedRelayHealth ?? true;
  return new AbstractSimplePool({
    verifyEvent: createCachedEventVerifier(createNostrWasmVerifier(runtime)),
    enableReconnect: false,
    ...(sharedRelayHealth
      ? {
          onRelayConnectionFailure: recordRelayFailure,
          onRelayConnectionSuccess: recordRelaySuccess,
          allowConnectingToRelay: canConnectToRelay
        }
      : {}),
    maxWaitForConnection: 3_000
  });
}

export function subscribeMany(
  relays: string[],
  filters: Filter[],
  handlers: { onevent: (event: any) => void; oneose?: () => void }
): any {
  if (!filters || filters.length === 0) throw new Error("subscribeMany requires at least one filter");

  const activeRelays = relays.filter(canConnectToRelay);
  if (activeRelays.length === 0) {
    queueMicrotask(() => handlers.oneose?.());
    return { close() {} };
  }
  const requests = activeRelays.flatMap((url) => filters.map((filter) => ({ url, filter })));
  let closed = false;
  let closeReason: string | undefined;
  let activeSubscription: { close: (reason?: string) => void } | null = null;

  void getPool()
    .then((pool) => {
      if (closed) return;
      activeSubscription = pool.subscribeMap(requests, handlers);
    })
    .catch(() => {
      if (!closed) queueMicrotask(() => handlers.oneose?.());
    });

  return {
    close(reason?: string) {
      closed = true;
      closeReason = reason;
      activeSubscription?.close(closeReason);
    }
  };
}
