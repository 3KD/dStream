import assert from "node:assert/strict";
import test from "node:test";

import {
  addOptimisticChatMessage,
  clearOptimisticChatMessages,
  getOptimisticChatMessages,
  removeOptimisticChatMessages
} from "./chatOptimistic";

const SCOPE = `${"a".repeat(64)}:stream`;

test("optimistic chat store publishes pending rows and removes committed ids", () => {
  clearOptimisticChatMessages(SCOPE);
  const message = {
    id: "local-1",
    scopeKey: SCOPE,
    content: "pending",
    createdAt: 1
  };

  addOptimisticChatMessage(message);
  addOptimisticChatMessage(message);
  assert.deepEqual(getOptimisticChatMessages(SCOPE), [message]);

  removeOptimisticChatMessages(SCOPE, new Set([message.id]));
  assert.deepEqual(getOptimisticChatMessages(SCOPE), []);

  clearOptimisticChatMessages(SCOPE);
});
