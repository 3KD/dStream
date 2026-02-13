import { SimplePool, type Filter } from "nostr-tools";

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
  const p = getPool();
  if (!filters || filters.length === 0) throw new Error("subscribeMany requires at least one filter");

  const requests = relays.flatMap((url) => filters.map((filter) => ({ url, filter })));
  return (p as any).subscribeMap(requests, handlers);
}
