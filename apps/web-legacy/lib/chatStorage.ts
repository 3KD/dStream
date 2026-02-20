"use client";

// IndexedDB Chat Storage
// Each viewer stores their own received messages locally

const DB_NAME = 'dstream_chat';
const DB_VERSION = 1;
const STORE_NAME = 'messages';

interface StoredMessage {
    id: string;
    channel: string;
    user_pubkey: string;
    text: string;
    timestamp: number;
    signature?: string;
    verified?: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('channel', 'channel', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });

    return dbPromise;
}

/**
 * Save a message to local storage
 */
export async function saveMessage(channel: string, msg: Omit<StoredMessage, 'id' | 'channel'>): Promise<void> {
    const db = await getDB();

    const storedMsg: StoredMessage = {
        ...msg,
        id: `${channel}_${msg.timestamp}_${msg.user_pubkey.substring(0, 8)}`,
        channel
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(storedMsg);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

/**
 * Get all messages for a channel, ordered by timestamp
 */
export async function getMessages(channel: string, limit = 100): Promise<StoredMessage[]> {
    const db = await getDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('channel');
        const request = index.getAll(IDBKeyRange.only(channel));

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const messages = request.result as StoredMessage[];
            // Sort by timestamp and limit
            messages.sort((a, b) => a.timestamp - b.timestamp);
            resolve(messages.slice(-limit));
        };
    });
}

/**
 * Clear all messages for a channel
 */
export async function clearChannel(channel: string): Promise<void> {
    const db = await getDB();
    const messages = await getMessages(channel, 10000);

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        let remaining = messages.length;
        if (remaining === 0) {
            resolve();
            return;
        }

        messages.forEach(msg => {
            const request = store.delete(msg.id);
            request.onsuccess = () => {
                remaining--;
                if (remaining === 0) resolve();
            };
            request.onerror = () => reject(request.error);
        });
    });
}

/**
 * Get message count for a channel
 */
export async function getMessageCount(channel: string): Promise<number> {
    const messages = await getMessages(channel, 10000);
    return messages.length;
}

/**
 * Delete a specific message by ID
 */
export async function deleteMessage(id: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}
