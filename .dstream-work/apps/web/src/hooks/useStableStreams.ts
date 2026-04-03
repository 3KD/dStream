"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Stabilizes a stream list for rendering so cards don't pop in/out or rearrange.
 *
 * Guarantees:
 * - Existing cards never change position (data updates in-place)
 * - New streams are appended at the end
 * - Removed streams linger for `removalDelayMs` before disappearing
 * - If a removed stream reappears within the grace period, it stays put
 *
 * Pass a custom `keyFn` to control identity (e.g. canonical stream key).
 * The default uses `pubkey:streamId`.
 */

interface StreamLike {
  pubkey: string;
  streamId: string;
}

function defaultKey(s: StreamLike): string {
  return `${s.pubkey}:${s.streamId}`;
}

export function useStableStreams<T extends StreamLike>(
  streams: T[],
  {
    removalDelayMs = 8000,
    keyFn = defaultKey,
  }: { removalDelayMs?: number; keyFn?: (s: T) => string } = {}
): T[] {
  const orderRef = useRef<string[]>([]);
  const dataRef = useRef<Map<string, T>>(new Map());
  const removalTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingRemovalKeys = useRef<Set<string>>(new Set());

  const [, setVersion] = useState(0);
  const rerender = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    const currentKeys = new Set(streams.map(keyFn));
    const currentMap = new Map(streams.map((s) => [keyFn(s), s]));
    const prevOrderSet = new Set(orderRef.current);
    let changed = false;

    // 1. Cancel pending removals for streams that came back
    for (const key of currentKeys) {
      if (removalTimers.current.has(key)) {
        clearTimeout(removalTimers.current.get(key)!);
        removalTimers.current.delete(key);
        pendingRemovalKeys.current.delete(key);
      }
    }

    // 2. Update data for existing streams (position stays the same)
    for (const key of orderRef.current) {
      const fresh = currentMap.get(key);
      if (fresh) {
        // Only mark changed if the data reference actually differs
        if (dataRef.current.get(key) !== fresh) {
          dataRef.current.set(key, fresh);
          changed = true;
        }
      }
    }

    // 3. Append genuinely new streams at the end
    for (const s of streams) {
      const key = keyFn(s);
      if (!prevOrderSet.has(key)) {
        orderRef.current.push(key);
        dataRef.current.set(key, s);
        changed = true;
      }
    }

    // 4. Schedule removals for streams that disappeared
    for (const key of orderRef.current) {
      if (!currentKeys.has(key) && !pendingRemovalKeys.current.has(key)) {
        pendingRemovalKeys.current.add(key);
        removalTimers.current.set(
          key,
          setTimeout(() => {
            orderRef.current = orderRef.current.filter((k) => k !== key);
            dataRef.current.delete(key);
            removalTimers.current.delete(key);
            pendingRemovalKeys.current.delete(key);
            rerender();
          }, removalDelayMs)
        );
        changed = true;
      }
    }

    if (changed) rerender();
  }, [streams, removalDelayMs, rerender, keyFn]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of removalTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Build output from stable order
  return orderRef.current
    .map((key) => dataRef.current.get(key))
    .filter((s): s is T => s !== undefined);
}
