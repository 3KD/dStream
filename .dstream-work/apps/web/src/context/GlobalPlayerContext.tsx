"use client";

import { createContext, useContext, useState, ReactNode, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Player } from "@/components/Player";

interface GlobalPlayerContextValue {
  playerHost: HTMLDivElement | null;
  registerPortal: (id: string, el: HTMLElement) => void;
  unregisterPortal: (id: string) => void;
  requestPortal: (id: string, props: any) => void;
  clearRequest: (id: string) => void;
  syncPortalPosition: (id: string) => void;
}

const GlobalPlayerContext = createContext<GlobalPlayerContextValue | null>(null);

export function GlobalPlayerProvider({ children }: { children: ReactNode }) {
  const [forceTick, setForceTick] = useState(0);
  const portalsRef = useRef<Record<string, HTMLElement>>({});
  const [activeRequest, setActiveRequest] = useState<{ id: string; props: any } | null>(null);
  const [playerHost, setPlayerHost] = useState<HTMLDivElement | null>(null);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const permanentHostRootRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const host = document.createElement("div");
    host.setAttribute("data-global-player-host", "true");
    host.className = "fixed overflow-hidden";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.width = "1px";
    host.style.height = "1px";
    permanentHostRootRef.current?.appendChild(host);
    playerHostRef.current = host;
    setPlayerHost(host);
    return () => {
      playerHostRef.current = null;
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

  const syncPortalPosition = useCallback((id: string) => {
    const host = playerHostRef.current;
    const target = portalsRef.current[id];
    if (!host || activeRequestIdRef.current !== id || !target?.isConnected) return;

    const rect = target.getBoundingClientRect();
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    host.style.width = `${Math.max(1, rect.width)}px`;
    host.style.height = `${Math.max(1, rect.height)}px`;
    host.style.zIndex = id === "quickplay-dock" ? "9999" : "1";
    host.style.pointerEvents = getComputedStyle(target).pointerEvents;
  }, []);

  useLayoutEffect(() => {
    const host = playerHostRef.current;
    if (!host || !playerHost) return;
    if (!activeRequest) {
      host.style.left = "-10000px";
      host.style.width = "1px";
      host.style.height = "1px";
      return;
    }

    const target = portalsRef.current[activeRequest.id];
    if (!target?.isConnected) {
      host.style.left = "-10000px";
      host.style.width = "1px";
      host.style.height = "1px";
      return;
    }

    const syncPosition = () => syncPortalPosition(activeRequest.id);

    syncPosition();
    const resizeObserver = new ResizeObserver(syncPosition);
    resizeObserver.observe(target);
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    const positionInterval = window.setInterval(syncPosition, 250);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
      window.clearInterval(positionInterval);
    };
  }, [activeRequest, forceTick, playerHost, syncPortalPosition]);

  const contextValue = useMemo(
    () => ({ playerHost, registerPortal, unregisterPortal, requestPortal, clearRequest, syncPortalPosition }),
    [clearRequest, playerHost, registerPortal, requestPortal, syncPortalPosition, unregisterPortal]
  );

  return (
    <GlobalPlayerContext.Provider value={contextValue}>
      {children}
      <div
        ref={permanentHostRootRef}
        data-global-player-root="true"
        className="contents"
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
