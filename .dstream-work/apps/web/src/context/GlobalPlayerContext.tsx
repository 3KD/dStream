"use client";

import dynamic from "next/dynamic";
import { LoaderCircle } from "lucide-react";
import { createContext, useContext, useState, ReactNode, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  resolveGlobalPlayerHostPlacement,
  type GlobalPlayerHostPlacement
} from "@/lib/playbackLifecycle";

const Player = dynamic(() => import("@/components/Player").then((module) => module.Player), {
  ssr: false,
  loading: () => (
    <div
      data-testid="player-module-loading"
      className="flex h-full w-full items-center justify-center bg-black px-4 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center">
        <LoaderCircle className="mb-3 h-6 w-6 animate-spin text-white" aria-hidden="true" />
        <p className="text-sm font-semibold text-white">Opening player</p>
        <p className="mt-1 text-xs text-neutral-400">Loading the playback engine.</p>
      </div>
    </div>
  )
});

interface GlobalPlayerContextValue {
  playerHost: HTMLDivElement | null;
  registerPortal: (id: string, el: HTMLElement) => void;
  unregisterPortal: (id: string) => void;
  requestPortal: (id: string, props: any) => void;
  clearRequest: (id: string) => void;
  syncPortalPosition: (id: string) => void;
}

const GlobalPlayerContext = createContext<GlobalPlayerContextValue | null>(null);

function applyHostPlacement(host: HTMLElement, placement: GlobalPlayerHostPlacement) {
  host.style.left = placement.left;
  host.style.top = placement.top;
  host.style.width = placement.width;
  host.style.height = placement.height;
  host.style.zIndex = placement.zIndex;
  host.style.pointerEvents = placement.pointerEvents;
}

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
    applyHostPlacement(
      host,
      resolveGlobalPlayerHostPlacement({
        active: false,
        slotId: null,
        targetConnected: false,
        targetRect: null,
        targetPointerEvents: null
      })
    );
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
    if (!host || activeRequestIdRef.current !== id) return;
    const target = portalsRef.current[id];
    if (!target?.isConnected) {
      applyHostPlacement(
        host,
        resolveGlobalPlayerHostPlacement({
          active: false,
          slotId: id,
          targetConnected: false,
          targetRect: null,
          targetPointerEvents: null
        })
      );
      return;
    }

    const rect = target.getBoundingClientRect();
    applyHostPlacement(
      host,
      resolveGlobalPlayerHostPlacement({
        active: true,
        slotId: id,
        targetConnected: target.isConnected,
        targetRect: rect,
        targetPointerEvents: getComputedStyle(target).pointerEvents
      })
    );
  }, []);

  useLayoutEffect(() => {
    const host = playerHostRef.current;
    if (!host || !playerHost) return;
    if (!activeRequest) {
      applyHostPlacement(
        host,
        resolveGlobalPlayerHostPlacement({
          active: false,
          slotId: null,
          targetConnected: false,
          targetRect: null,
          targetPointerEvents: null
        })
      );
      return;
    }

    const target = portalsRef.current[activeRequest.id];
    if (!target?.isConnected) {
      applyHostPlacement(
        host,
        resolveGlobalPlayerHostPlacement({
          active: false,
          slotId: activeRequest.id,
          targetConnected: false,
          targetRect: null,
          targetPointerEvents: null
        })
      );
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

  useLayoutEffect(() => {
    requestPortal(id, playerProps);
  }, [id, playerProps, requestPortal]);

  return <div ref={containerRef} className="w-full h-full relative z-0" data-player-slot={id} />;
}
