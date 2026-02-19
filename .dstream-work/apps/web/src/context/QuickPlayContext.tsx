"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface QuickPlayStreamRef {
  streamPubkey: string;
  streamId: string;
  title: string;
}

interface QuickPlayContextValue {
  quickPlayStream: QuickPlayStreamRef | null;
  setQuickPlayStream: (next: QuickPlayStreamRef) => void;
  clearQuickPlayStream: () => void;
}

const QuickPlayContext = createContext<QuickPlayContextValue | null>(null);
const STORAGE_KEY = "dstream_quick_play_stream_v1";

function isValidStreamRef(input: unknown): input is QuickPlayStreamRef {
  if (!input || typeof input !== "object") return false;
  const value = input as Partial<QuickPlayStreamRef>;
  if (typeof value.streamPubkey !== "string" || value.streamPubkey.trim().length === 0) return false;
  if (typeof value.streamId !== "string" || value.streamId.trim().length === 0) return false;
  if (typeof value.title !== "string") return false;
  return true;
}

function normalizeStreamRef(value: QuickPlayStreamRef): QuickPlayStreamRef {
  return {
    streamPubkey: value.streamPubkey.trim().toLowerCase(),
    streamId: value.streamId.trim(),
    title: value.title.trim() || value.streamId.trim()
  };
}

export function QuickPlayProvider({ children }: { children: ReactNode }) {
  const [quickPlayStream, setQuickPlayStreamState] = useState<QuickPlayStreamRef | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!isValidStreamRef(parsed)) return;
      setQuickPlayStreamState(normalizeStreamRef(parsed));
    } catch {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    try {
      if (!quickPlayStream) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(quickPlayStream));
    } catch {
      // ignore storage failures
    }
  }, [quickPlayStream]);

  const setQuickPlayStream = useCallback((next: QuickPlayStreamRef) => {
    setQuickPlayStreamState(normalizeStreamRef(next));
  }, []);

  const clearQuickPlayStream = useCallback(() => {
    setQuickPlayStreamState(null);
  }, []);

  const value = useMemo<QuickPlayContextValue>(
    () => ({
      quickPlayStream,
      setQuickPlayStream,
      clearQuickPlayStream
    }),
    [clearQuickPlayStream, quickPlayStream, setQuickPlayStream]
  );

  return <QuickPlayContext.Provider value={value}>{children}</QuickPlayContext.Provider>;
}

export function useQuickPlay() {
  const context = useContext(QuickPlayContext);
  if (!context) throw new Error("useQuickPlay must be used within QuickPlayProvider");
  return context;
}
