"use client";

import { createContext, useContext, useState, ReactNode, useLayoutEffect, useRef, useCallback, useMemo } from "react";
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
  const portalsRef = useRef<Record<string, HTMLElement>>({});
  const [activeRequest, setActiveRequest] = useState<{ id: string; props: any } | null>(null);
  const [playerHost, setPlayerHost] = useState<HTMLDivElement | null>(null);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const permanentHostRootRef = useRef<HTMLDivElement | null>(null);

  const parkPlayerHost = useCallback(() => {
    const host = playerHostRef.current;
    const root = permanentHostRootRef.current;
    if (!host || !root) return;
    if (host.parentElement !== root) root.appendChild(host);
    host.style.position = "fixed";
    host.style.inset = "auto";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.width = "1px";
    host.style.height = "1px";
    host.style.zIndex = "-1";
    host.style.pointerEvents = "none";
  }, []);

  const mountPlayerHost = useCallback((id: string) => {
    const host = playerHostRef.current;
    const target = portalsRef.current[id];
    if (!host || activeRequestIdRef.current !== id || !target?.isConnected) return false;
    if (host.parentElement !== target) target.appendChild(host);
    host.style.position = "absolute";
    host.style.inset = "0";
    host.style.left = "0";
    host.style.top = "0";
    host.style.width = "100%";
    host.style.height = "100%";
    host.style.zIndex = "1";
    host.style.pointerEvents = getComputedStyle(target).pointerEvents;
    return true;
  }, []);

  useLayoutEffect(() => {
    const host = document.createElement("div");
    host.setAttribute("data-global-player-host", "true");
    host.className = "overflow-hidden";
    permanentHostRootRef.current?.appendChild(host);
    playerHostRef.current = host;
    parkPlayerHost();
    setPlayerHost(host);
    return () => {
      playerHostRef.current = null;
      host.remove();
    };
  }, [parkPlayerHost]);

  const registerPortal = useCallback((id: string, el: HTMLElement) => {
    portalsRef.current[id] = el;
    if (activeRequestIdRef.current === id) mountPlayerHost(id);
  }, [mountPlayerHost]);

  const unregisterPortal = useCallback((id: string) => {
    const target = portalsRef.current[id];
    if (activeRequestIdRef.current === id && playerHostRef.current?.parentElement === target) {
      parkPlayerHost();
    }
    delete portalsRef.current[id];
  }, [parkPlayerHost]);

  const requestPortal = useCallback((id: string, props: any) => {
    activeRequestIdRef.current = id;
    mountPlayerHost(id);
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
  }, [mountPlayerHost]);

  const clearRequest = useCallback((id: string) => {
    if (activeRequestIdRef.current === id) {
      activeRequestIdRef.current = null;
      parkPlayerHost();
    }
    setActiveRequest((prev) => {
      if (prev?.id === id) return null;
      return prev;
    });
  }, [parkPlayerHost]);

  const syncPortalPosition = useCallback((id: string) => {
    mountPlayerHost(id);
  }, [mountPlayerHost]);

  useLayoutEffect(() => {
    if (!playerHost) return;
    if (!activeRequest) {
      parkPlayerHost();
      return;
    }
    if (!mountPlayerHost(activeRequest.id)) parkPlayerHost();
  }, [activeRequest, mountPlayerHost, parkPlayerHost, playerHost]);

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
      {playerHost && activeRequest ? createPortal(<Player {...activeRequest.props} />, playerHost) : null}
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

  useLayoutEffect(() => {
    requestPortal(id, playerProps);
  }, [id, playerProps, requestPortal]);

  return <div ref={containerRef} className="w-full h-full relative z-0" data-player-slot={id} />;
}
