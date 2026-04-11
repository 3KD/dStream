"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

function isValidStreamRef(input: unknown): input is QuickPlayStreamRef {
  if (!input || typeof input !== "object") return false;
  const value = input as Partial<QuickPlayStreamRef>;
  if (typeof value.streamPubkey !== "string" || value.streamPubkey.trim().length === 0) return false;
  if (typeof value.streamId !== "string" || value.streamId.trim().length === 0) return false;
  if (typeof value.title !== "string") return false;
  if (value.hlsUrl !== undefined && typeof value.hlsUrl !== "string") return false;
  if (value.whepUrl !== undefined && typeof value.whepUrl !== "string") return false;
  return true;
}

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
  const quickPlayStreamRef = useRef<QuickPlayStreamRef | null>(null);

  const persistQuickPlay = useCallback((next: QuickPlayStreamRef | null) => {
    try {
      if (!next) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ data: next, savedAt: Date.now() }));
    } catch {
      // ignore storage failures
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      
      let payload = parsed;
      if (parsed && typeof parsed === "object" && "data" in parsed && typeof parsed.savedAt === "number") {
        const age = Date.now() - parsed.savedAt;
        if (age > 20 * 60 * 1000) {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        payload = parsed.data;
      }

      if (!isValidStreamRef(payload)) return;
      setQuickPlayStreamState(normalizeStreamRef(payload));
    } catch {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    quickPlayStreamRef.current = quickPlayStream;
    persistQuickPlay(quickPlayStream);
  }, [persistQuickPlay, quickPlayStream]);

  useEffect(() => {
    const flushNow = () => persistQuickPlay(quickPlayStreamRef.current);
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      flushNow();
    };

    window.addEventListener("pagehide", flushNow);
    window.addEventListener("beforeunload", flushNow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      window.removeEventListener("beforeunload", flushNow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persistQuickPlay]);

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

  useEffect(() => {
    if (!quickPlayStream) return;
    
    let lastActive = Date.now();
    const updateActivity = () => {
      lastActive = Date.now();
    };

    window.addEventListener("mousemove", updateActivity);
    window.addEventListener("keydown", updateActivity);
    window.addEventListener("touchstart", updateActivity);
    window.addEventListener("scroll", updateActivity);

    const interval = setInterval(() => {
      if (Date.now() - lastActive > 20 * 60 * 1000) {
        clearQuickPlayStream();
        if (window.location.pathname.startsWith("/watch")) {
           window.location.href = "/";
        }
      }
    }, 60000);

    return () => {
      window.removeEventListener("mousemove", updateActivity);
      window.removeEventListener("keydown", updateActivity);
      window.removeEventListener("touchstart", updateActivity);
      window.removeEventListener("scroll", updateActivity);
      clearInterval(interval);
    };
  }, [quickPlayStream, clearQuickPlayStream]);

  return <QuickPlayContext.Provider value={value}>{children}</QuickPlayContext.Provider>;
}

export function useQuickPlay() {
  const context = useContext(QuickPlayContext);
  if (!context) throw new Error("useQuickPlay must be used within QuickPlayProvider");
  return context;
}
