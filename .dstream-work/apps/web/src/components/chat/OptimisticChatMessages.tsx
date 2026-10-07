"use client";

import { useLayoutEffect, useRef } from "react";
import {
  registerOptimisticChatContainer,
  removeOptimisticChatMessages
} from "@/lib/chatOptimistic";

const EMPTY_IDS = new Set<string>();

export function OptimisticChatMessages({
  scopeKey,
  committedIds = EMPTY_IDS
}: {
  scopeKey: string;
  committedIds?: ReadonlySet<string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return registerOptimisticChatContainer(scopeKey, container);
  }, [scopeKey]);

  useLayoutEffect(() => {
    removeOptimisticChatMessages(scopeKey, committedIds);
  }, [committedIds, scopeKey]);

  // The store populates this container synchronously so watch-page reconciliation
  // cannot delay the sender's first visible feedback.
  return <div ref={containerRef} data-testid="optimistic-chat-messages" />;
}
