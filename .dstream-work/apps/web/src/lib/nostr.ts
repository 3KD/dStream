import { SimplePool, type Filter } from "nostr-tools";
import { LOCAL_RELAY_URL } from "@/lib/config";
import { getLocalRelay } from "@/lib/relay/localRelay";

let pool: SimplePool | null = null;

export function getPool(): SimplePool {
  if (!pool) pool = new SimplePool();
  return pool;
}

export function subscribeMany(
  relays: string[],
  filters: Filter[],
  handlers: { onevent: (event: any) => void; oneose?: () => void }
): any {
  if (!filters || filters.length === 0) throw new Error("subscribeMany requires at least one filter");

  const remoteRelays = relays.filter((r) => r !== LOCAL_RELAY_URL);
  const useLocal = relays.includes(LOCAL_RELAY_URL);

  // Remote subscription via SimplePool.
  let remoteSub: any = null;
  if (remoteRelays.length > 0) {
    const p = getPool();
    const requests = remoteRelays.flatMap((url) => filters.map((filter) => ({ url, filter })));
    remoteSub = (p as any).subscribeMap(requests, handlers);
  }

  // Local relay subscription.
  let localSub: { close: () => void } | null = null;
  if (useLocal) {
    const relay = getLocalRelay();
    if (relay) {
      localSub = relay.subscribe(filters, handlers.onevent);
    }
  }

  return {
    close: () => {
      remoteSub?.close?.();
      localSub?.close();
    },
  };
}
