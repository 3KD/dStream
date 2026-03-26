/**
 * Local watch history tracker.
 *
 * Stores viewing sessions in IndexedDB. Never transmitted — stays on device.
 * Used by the recommendation algorithm for topic matching and recency signals.
 */

import type { WatchHistoryEntry } from "./types";

const DB_NAME = "dstream_watch_history_v1";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const MAX_ENTRIES = 500;

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true });
        store.createIndex("streamKey", "streamKey", { unique: false });
        store.createIndex("watchedAt", "watchedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Record a watch session. */
export async function recordWatch(entry: WatchHistoryEntry): Promise<void> {
  if (entry.durationSec < 3) return; // Ignore accidental clicks.
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.add(entry);

    // Evict oldest if over cap.
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result <= MAX_ENTRIES) return;
      const cursor = store.openCursor();
      let deleted = 0;
      const toDelete = countReq.result - MAX_ENTRIES;
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || deleted >= toDelete) return;
        c.delete();
        deleted++;
        c.continue();
      };
    };

    db.close();
  } catch {
    // IndexedDB unavailable — silently skip.
  }
}

/** Get recent watch history, newest first. */
export async function getWatchHistory(limit = 200): Promise<WatchHistoryEntry[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("watchedAt");
      const entries: WatchHistoryEntry[] = [];

      const cursor = index.openCursor(null, "prev"); // newest first
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || entries.length >= limit) {
          db.close();
          resolve(entries);
          return;
        }
        entries.push(c.value as WatchHistoryEntry);
        c.continue();
      };
      cursor.onerror = () => {
        db.close();
        resolve([]);
      };
    });
  } catch {
    return [];
  }
}

/** Get topic frequency map from watch history. */
export async function getTopicFrequencies(): Promise<Map<string, number>> {
  const history = await getWatchHistory(200);
  const freq = new Map<string, number>();
  for (const entry of history) {
    // Weight by watch duration (longer watches = stronger signal).
    const weight = Math.min(entry.durationSec / 60, 10); // cap at 10 min
    for (const topic of entry.topics) {
      freq.set(topic, (freq.get(topic) ?? 0) + weight);
    }
  }
  return freq;
}

/** Count total entries. */
export async function getWatchHistoryCount(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => {
        db.close();
        resolve(req.result);
      };
      req.onerror = () => {
        db.close();
        resolve(0);
      };
    });
  } catch {
    return 0;
  }
}

/** Clear all watch history. */
export async function clearWatchHistory(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    db.close();
  } catch {
    // ignore
  }
}
