/**
 * Lightweight in-app Nostr relay.
 *
 * Stores the owner's events in-memory (backed by IndexedDB) so they survive
 * app restarts and remain available even when remote relays are unreachable.
 *
 * This is NOT a network relay — it never binds a port. It plugs into the
 * publish/subscribe paths alongside SimplePool as a parallel local target.
 */

import { matchFilter, type Event as NostrEvent, type Filter } from "nostr-tools";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = "dstream_local_relay_v1";
const DB_VERSION = 1;
const STORE_NAME = "events";
const MAX_EVENTS = 2000;

/** Kinds the local relay accepts. Everything else is silently dropped. */
const ALLOWED_KINDS = new Set([
  0,     // user metadata
  4,     // encrypted DMs
  1311,  // stream chat
  8108,  // P2P signal
  10312, // presence (NIP-53 aligned)
  30311, // stream announce
  39313, // manifest root
  39314, // XMR receipt
  39315, // guild
  39317, // stream mod action
  39318, // stream mod role
  39319, // guild membership
  39320, // guild role
]);

export const LOCAL_RELAY_URL = "local://self";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Subscription {
  id: number;
  filters: Filter[];
  onEvent: (event: NostrEvent) => void;
}

export interface LocalRelayStats {
  eventCount: number;
  kinds: Record<number, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isReplaceable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

function replaceableKey(event: NostrEvent): string {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// LocalRelay
// ---------------------------------------------------------------------------

export class LocalRelay {
  private ownerPubkey: string;
  private events = new Map<string, NostrEvent>();
  /** Maps replaceable key → event id for quick lookup during replacement. */
  private replaceableIndex = new Map<string, string>();
  private db: IDBDatabase | null = null;
  private subs = new Map<number, Subscription>();
  private nextSubId = 1;

  constructor(ownerPubkey: string) {
    this.ownerPubkey = ownerPubkey.toLowerCase();
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    try {
      this.db = await openDB();
      await this.loadFromDB();
    } catch {
      // IndexedDB unavailable (e.g. private browsing) — run in-memory only.
    }
  }

  async destroy(): Promise<void> {
    this.subs.clear();
    this.events.clear();
    this.replaceableIndex.clear();
    this.db?.close();
    this.db = null;
  }

  // -----------------------------------------------------------------------
  // Publish
  // -----------------------------------------------------------------------

  publish(event: NostrEvent): { ok: boolean; message?: string } {
    if (!event || !event.id) return { ok: false, message: "invalid event" };
    if (event.pubkey.toLowerCase() !== this.ownerPubkey) {
      return { ok: false, message: "not owner" };
    }
    if (!ALLOWED_KINDS.has(event.kind)) {
      return { ok: false, message: "kind not accepted" };
    }

    // Replaceable event logic: keep only the latest per (kind, pubkey, d-tag).
    if (isReplaceable(event.kind)) {
      const rKey = replaceableKey(event);
      const existingId = this.replaceableIndex.get(rKey);
      if (existingId) {
        const existing = this.events.get(existingId);
        if (existing && existing.created_at >= event.created_at) {
          return { ok: true, message: "duplicate: have newer" };
        }
        // Remove old version.
        this.events.delete(existingId);
        this.deleteFromDB(existingId);
      }
      this.replaceableIndex.set(rKey, event.id);
    } else if (this.events.has(event.id)) {
      return { ok: true, message: "duplicate" };
    }

    this.events.set(event.id, event);
    this.persistToDB(event);
    this.evictIfNeeded();
    this.notifySubscribers(event);
    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // Query / Subscribe
  // -----------------------------------------------------------------------

  query(filters: Filter[]): NostrEvent[] {
    const results: NostrEvent[] = [];
    for (const event of this.events.values()) {
      for (const filter of filters) {
        if (matchFilter(filter, event)) {
          results.push(event);
          break;
        }
      }
    }
    // Sort newest first, apply limit from first filter that has one.
    results.sort((a, b) => b.created_at - a.created_at);
    const limit = filters.find((f) => f.limit !== undefined)?.limit;
    if (limit !== undefined && results.length > limit) {
      results.length = limit;
    }
    return results;
  }

  subscribe(
    filters: Filter[],
    onEvent: (event: NostrEvent) => void
  ): { close: () => void } {
    const id = this.nextSubId++;
    this.subs.set(id, { id, filters, onEvent });

    // Emit existing matches immediately.
    const existing = this.query(filters);
    for (const event of existing) {
      try {
        onEvent(event);
      } catch {
        // subscriber error — ignore
      }
    }

    return {
      close: () => {
        this.subs.delete(id);
      },
    };
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  getStats(): LocalRelayStats {
    const kinds: Record<number, number> = {};
    for (const event of this.events.values()) {
      kinds[event.kind] = (kinds[event.kind] ?? 0) + 1;
    }
    return { eventCount: this.events.size, kinds };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private notifySubscribers(event: NostrEvent): void {
    for (const sub of this.subs.values()) {
      for (const filter of sub.filters) {
        if (matchFilter(filter, event)) {
          try {
            sub.onEvent(event);
          } catch {
            // ignore
          }
          break;
        }
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.events.size <= MAX_EVENTS) return;

    // Collect non-replaceable events sorted oldest first.
    const candidates = [...this.events.values()]
      .filter((e) => !isReplaceable(e.kind))
      .sort((a, b) => a.created_at - b.created_at);

    const toRemove = this.events.size - MAX_EVENTS;
    for (let i = 0; i < toRemove && i < candidates.length; i++) {
      this.events.delete(candidates[i].id);
      this.deleteFromDB(candidates[i].id);
    }

    // If still over (unlikely — all replaceable), evict oldest replaceable.
    if (this.events.size > MAX_EVENTS) {
      const remaining = [...this.events.values()].sort(
        (a, b) => a.created_at - b.created_at
      );
      const extra = this.events.size - MAX_EVENTS;
      for (let i = 0; i < extra; i++) {
        const ev = remaining[i];
        this.events.delete(ev.id);
        if (isReplaceable(ev.kind)) {
          const rKey = replaceableKey(ev);
          if (this.replaceableIndex.get(rKey) === ev.id) {
            this.replaceableIndex.delete(rKey);
          }
        }
        this.deleteFromDB(ev.id);
      }
    }
  }

  // -----------------------------------------------------------------------
  // IndexedDB persistence
  // -----------------------------------------------------------------------

  private async loadFromDB(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = request.result as NostrEvent[];
        for (const event of rows) {
          if (event.pubkey.toLowerCase() !== this.ownerPubkey) continue;
          if (!ALLOWED_KINDS.has(event.kind)) continue;

          if (isReplaceable(event.kind)) {
            const rKey = replaceableKey(event);
            const existingId = this.replaceableIndex.get(rKey);
            if (existingId) {
              const existing = this.events.get(existingId);
              if (existing && existing.created_at >= event.created_at) continue;
              this.events.delete(existingId);
            }
            this.replaceableIndex.set(rKey, event.id);
          }
          this.events.set(event.id, event);
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private persistToDB(event: NostrEvent): void {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(event);
    } catch {
      // IndexedDB write failure — event stays in memory.
    }
  }

  private deleteFromDB(eventId: string): void {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(eventId);
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: LocalRelay | null = null;

export function getLocalRelay(): LocalRelay | null {
  return instance;
}

export async function initLocalRelay(ownerPubkey: string): Promise<LocalRelay> {
  if (instance) {
    await instance.destroy();
  }
  instance = new LocalRelay(ownerPubkey);
  await instance.init();
  return instance;
}

export async function destroyLocalRelay(): Promise<void> {
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}
