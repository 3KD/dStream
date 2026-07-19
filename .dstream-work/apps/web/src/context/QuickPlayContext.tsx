"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface QuickPlayStreamRef {
  streamPubkey: string;
  streamId: string;
  title: string;
  hlsUrl?: string;
  whepUrl?: string;
}

interface QuickPlayContextValue {
  quickPlayStream: QuickPlayStreamRef | null;
  setQuickPlayStream: (next: QuickPlayStreamRef) => void;
  clearQuickPlayStream: () => void;
}

const QuickPlayContext = createContext<QuickPlayContextValue | null>(null);
export const QUICK_PLAY_STORAGE_KEY = "dstream_quick_play_stream_v1";
const STORAGE_KEY = QUICK_PLAY_STORAGE_KEY;

function normalizePlaybackUrl(input: string | undefined): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
  return undefined;
}

function normalizeStreamRef(value: QuickPlayStreamRef): QuickPlayStreamRef {
  return {
    streamPubkey: value.streamPubkey.trim().toLowerCase(),
    streamId: value.streamId.trim(),
    title: value.title.trim() || value.streamId.trim(),
    hlsUrl: normalizePlaybackUrl(value.hlsUrl),
    whepUrl: normalizePlaybackUrl(value.whepUrl)
  };
}

export function QuickPlayProvider({ children }: { children: ReactNode }) {
  const [quickPlayStream, setQuickPlayStreamState] = useState<QuickPlayStreamRef | null>(null);

  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
  }, []);

  const setQuickPlayStream = useCallback((next: QuickPlayStreamRef) => {
    setQuickPlayStreamState(normalizeStreamRef(next));
  }, []);

  const clearQuickPlayStream = useCallback(() => {
    setQuickPlayStreamState(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
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
