"use client";

import { createContext, useContext, useState, ReactNode, useEffect, useLayoutEffect, useRef } from "react";
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

  const registerPortal = (id: string, el: HTMLElement) => {
    setPortals((prev) => ({ ...prev, [id]: el }));
  };

  const unregisterPortal = (id: string) => {
    setPortals((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const requestPortal = (id: string, props: any) => {
    setActiveRequest({ id, props });
  };

  // If the active request's portal exists, render it there.
  // Otherwise, render into the fallback persistent container so it NEVER unmounts and wipes the buffer!
  let targetEl = null;
  if (activeRequest && portals[activeRequest.id]) {
    targetEl = portals[activeRequest.id];
  } else if (activeRequest && fallbackContainerRef.current) {
    targetEl = fallbackContainerRef.current;
  }

  return (
    <GlobalPlayerContext.Provider value={{ registerPortal, unregisterPortal, requestPortal }}>
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
