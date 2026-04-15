"use client";

import { createContext, useContext, useState, ReactNode, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Player } from "@/components/Player";

interface GlobalPlayerContextValue {
  registerPortal: (id: string, el: HTMLElement) => void;
  unregisterPortal: (id: string) => void;
  requestPortal: (id: string, props: any) => void;
}

const GlobalPlayerContext = createContext<GlobalPlayerContextValue | null>(null);

export function GlobalPlayerProvider({ children }: { children: ReactNode }) {
  const [portals, setPortals] = useState<Record<string, HTMLElement>>({});
  const [activeRequest, setActiveRequest] = useState<{ id: string; props: any } | null>(null);
  const fallbackContainerRef = useRef<HTMLDivElement | null>(null);

  const registerPortal = useCallback((id: string, el: HTMLElement) => {
    setPortals((prev) => ({ ...prev, [id]: el }));
  }, []);

  const unregisterPortal = useCallback((id: string) => {
    setPortals((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const requestPortal = useCallback((id: string, props: any) => {
    setActiveRequest((prev) => {
      if (prev && prev.id === id) {
         // Prevent infinite loops by skipping if nothing materially changed.
         // We do a shallow compare of the props.
         let same = true;
         const k1 = Object.keys(prev.props);
         const k2 = Object.keys(props);
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

  // If the active request's portal exists, render it there.
  // Otherwise, render into the fallback persistent container so it NEVER unmounts and wipes the buffer!
  let targetEl = null;
  if (activeRequest && portals[activeRequest.id]) {
    targetEl = portals[activeRequest.id];
  } else if (activeRequest && fallbackContainerRef.current) {
    targetEl = fallbackContainerRef.current;
  }

  const contextValue = useMemo(() => ({ registerPortal, unregisterPortal, requestPortal }), [registerPortal, unregisterPortal, requestPortal]);

  return (
    <GlobalPlayerContext.Provider value={contextValue}>
      {children}
      <div ref={fallbackContainerRef} style={{ display: "none" }} aria-hidden="true" />
      {targetEl && activeRequest && createPortal(<Player {...activeRequest.props} />, targetEl)}
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
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (container) {
      registerPortal(id, container);
      return () => unregisterPortal(id);
    }
  }, [container, id, registerPortal, unregisterPortal]);

  useEffect(() => {
    requestPortal(id, playerProps);
  }, [id, playerProps, requestPortal]);

  return <div ref={setContainer} className="w-full h-full relative z-0" data-player-slot={id} />;
}
