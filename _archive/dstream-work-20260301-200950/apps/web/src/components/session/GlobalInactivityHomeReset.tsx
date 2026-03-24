"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { QUICK_PLAY_STORAGE_KEY, useQuickPlay } from "@/context/QuickPlayContext";

const LAST_VISIT_STORAGE_KEY = "dstream_last_visit_at_ms_v1";
const INACTIVITY_RESET_MS = 20 * 60 * 1000;

function readLastVisitAtMs(): number | null {
  try {
    const raw = localStorage.getItem(LAST_VISIT_STORAGE_KEY);
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  } catch {
    return null;
  }
}

function writeLastVisitAtMs(value: number) {
  try {
    localStorage.setItem(LAST_VISIT_STORAGE_KEY, String(value));
  } catch {
    // ignore
  }
}

export function GlobalInactivityHomeReset() {
  const router = useRouter();
  const pathname = usePathname();
  const { clearQuickPlayStream } = useQuickPlay();
  const redirectingRef = useRef(false);

  const clearPlayers = useCallback(() => {
    clearQuickPlayStream();
    try {
      localStorage.removeItem(QUICK_PLAY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [clearQuickPlayStream]);

  const markVisitedNow = useCallback(() => {
    writeLastVisitAtMs(Date.now());
  }, []);

  const resetIfInactive = useCallback(() => {
    const nowMs = Date.now();
    const lastVisitAtMs = readLastVisitAtMs();
    const inactive = typeof lastVisitAtMs === "number" && nowMs - lastVisitAtMs >= INACTIVITY_RESET_MS;
    writeLastVisitAtMs(nowMs);
    if (!inactive || redirectingRef.current) return;

    clearPlayers();
    if (pathname !== "/") {
      redirectingRef.current = true;
      router.replace("/");
      setTimeout(() => {
        redirectingRef.current = false;
      }, 1200);
    }
  }, [clearPlayers, pathname, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    resetIfInactive();
  }, [pathname, resetIfInactive]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"];
    const onActivity = () => markVisitedNow();
    const onVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        resetIfInactive();
      }
    };

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, onActivity, { passive: true });
    });
    window.addEventListener("focus", onVisibilityOrFocus);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);

    const visibleHeartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        markVisitedNow();
      }
    }, 60_000);

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, onActivity);
      });
      window.removeEventListener("focus", onVisibilityOrFocus);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      clearInterval(visibleHeartbeat);
    };
  }, [markVisitedNow, resetIfInactive]);

  return null;
}
