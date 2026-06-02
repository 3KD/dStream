"use client";

import { createContext, useContext, useState, ReactNode, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Player } from "@/components/Player";

interface GlobalPlayerContextValue {
  registerPortal: (id: string, el: HTMLElement) => void;
  unregisterPortal: (id: string) => void;
  requestPortal: (id: string, props: any) => void;
  clearRequest: (id: string) => void;
}

const GlobalPlayerContext = createContext<GlobalPlayerContextValue | null>(null);

export function GlobalPlayerProvider({ children }: { children: ReactNode }) {
  const [forceTick, setForceTick] = useState(0);
  const portalsRef = useRef<Record<string, HTMLElement>>({});
  const [activeRequest, setActiveRequest] = useState<{ id: string; props: any } | null>(null);
  const [playerHost, setPlayerHost] = useState<HTMLDivElement | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const fallbackContainerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const host = document.createElement("div");
    host.setAttribute("data-global-player-host", "true");
    host.className = "w-full h-full relative z-0";
    setPlayerHost(host);
    return () => {
      host.remove();
    };
  }, []);

  const registerPortal = useCallback((id: string, el: HTMLElement) => {
    portalsRef.current[id] = el;
    // We only force a render if this newly registered portal is CURRENTLY the active request
    // This allows activeRequest's targetEl to instantly update from fallback -> portal.
    if (activeRequestIdRef.current === id) setForceTick((t) => t + 1);
  }, []);

  const unregisterPortal = useCallback((id: string) => {
    delete portalsRef.current[id];
    // If we literally just destroyed the portal that is currently housing the active player,
    // we MUST force a re-render so it safely moves to fallbackContainerRef immediately.
    if (activeRequestIdRef.current === id) setForceTick((t) => t + 1);
  }, []);

  const requestPortal = useCallback((id: string, props: any) => {
    activeRequestIdRef.current = id;
    setActiveRequest((prev) => {
      if (prev && prev.id === id) {
         // Prevent infinite loops by skipping if nothing materially changed.
         // We do a shallow compare of the props.
         let same = true;
         const k1 = Object.keys(prev.props || {});
         const k2 = Object.keys(props || {});
         if (k1.length !== k2.length) same = false;
         else {
           for (const k of k1) {
             if (prev.props[k] !== props[k]) {
               same = false;
               break;
             }
           }
         }
         if (same) return prev;
      }
      return { id, props };
    });
  }, []);

  const clearRequest = useCallback((id: string) => {
    setActiveRequest((prev) => {
      if (prev?.id === id) return null;
      return prev;
    });
  }, []);

  useLayoutEffect(() => {
    if (!playerHost) return;
    const fallback = fallbackContainerRef.current;
    const target = activeRequest ? portalsRef.current[activeRequest.id] ?? fallback : fallback;
    if (!target) return;
    if (playerHost.parentElement !== target) {
      target.appendChild(playerHost);
    }
  }, [activeRequest, forceTick, playerHost]);

  const contextValue = useMemo(() => ({ registerPortal, unregisterPortal, requestPortal, clearRequest }), [registerPortal, unregisterPortal, requestPortal, clearRequest]);

  return (
    <GlobalPlayerContext.Provider value={contextValue}>
      {children}
      <div
        ref={fallbackContainerRef}
        style={{
          position: "fixed",
          left: -10000,
          top: 0,
          width: 1,
          height: 1,
          overflow: "hidden",
          opacity: 0,
          pointerEvents: "none"
        }}
        aria-hidden="true"
      />
      {playerHost && activeRequest ? createPortal(<Player {...(activeRequest.props || {})} />, playerHost) : null}
    </GlobalPlayerContext.Provider>
  );
}

export function useGlobalPlayer() {
  const context = useContext(GlobalPlayerContext);
  if (!context) throw new Error("useGlobalPlayer must be used within GlobalPlayerProvider");
  return context;
}

export function GlobalPlayerSlot({ id, playerProps }: { id: string; playerProps: any }) {
  const { registerPortal, unregisterPortal, requestPortal } = useGlobalPlayer();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (containerRef.current) {
      registerPortal(id, containerRef.current);
    }
    return () => unregisterPortal(id);
  }, [id, registerPortal, unregisterPortal]);

  useEffect(() => {
    requestPortal(id, playerProps);
  }, [id, playerProps, requestPortal]);

  return <div ref={containerRef} className="w-full h-full relative z-0" data-player-slot={id} />;
}
