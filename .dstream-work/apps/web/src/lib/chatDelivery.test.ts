import assert from "node:assert/strict";
import test from "node:test";

import { startChatDelivery, updateChatDeliveryStatus, type ChatDeliveryStatus } from "./chatDelivery";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("chat delivery starts without awaiting relay acknowledgement", async () => {
  const relay = deferred<boolean>();
  const statuses: ChatDeliveryStatus[] = ["sending"];

  const result = startChatDelivery(() => relay.promise, (status) => statuses.push(status));

  assert.equal(result, undefined);
  assert.deepEqual(statuses, ["sending"]);

  relay.resolve(true);
  await relay.promise;
  await Promise.resolve();
  assert.deepEqual(statuses, ["sending", "sent"]);
});

test("chat delivery reports relay rejection and errors as failed", async () => {
  const rejectedStatuses: ChatDeliveryStatus[] = [];
  startChatDelivery(() => Promise.resolve(false), (status) => rejectedStatuses.push(status));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(rejectedStatuses, ["failed"]);

  const failedStatuses: ChatDeliveryStatus[] = [];
  startChatDelivery(() => Promise.reject(new Error("offline")), (status) => failedStatuses.push(status));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(failedStatuses, ["failed"]);
});

test("chat delivery status updates only the matching optimistic message", () => {
  const messages = [
    { id: "first", content: "one" },
    { id: "second", content: "two", deliveryStatus: "sending" as const }
  ];

  const updated = updateChatDeliveryStatus(messages, "second", "failed");
  assert.notEqual(updated, messages);
  assert.equal(updated[0], messages[0]);
  assert.deepEqual(updated[1], { id: "second", content: "two", deliveryStatus: "failed" });
  assert.equal(updateChatDeliveryStatus(updated, "missing", "sent"), updated);
});
