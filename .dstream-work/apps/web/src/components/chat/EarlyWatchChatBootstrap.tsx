"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

let bootstrapPromise: Promise<unknown> | null = null;

function isWatchPath(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && pathname.startsWith("/watch/");
}

function startWatchChatBootstrap(): void {
  if (bootstrapPromise) return;
  bootstrapPromise = import("@/lib/chatBootstrap").catch((error) => {
    bootstrapPromise = null;
    console.warn("Early chat bootstrap failed to load.", error);
  });
}

// On a cold direct navigation this module executes before the large watch-page
// client bundle hydrates. Client-side navigations are covered by the effect.
if (typeof window !== "undefined" && isWatchPath(window.location.pathname)) {
  startWatchChatBootstrap();
}

export function EarlyWatchChatBootstrap() {
  const pathname = usePathname();

  useEffect(() => {
    if (isWatchPath(pathname)) startWatchChatBootstrap();
  }, [pathname]);

  return null;
}
