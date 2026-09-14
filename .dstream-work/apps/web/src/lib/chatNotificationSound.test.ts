import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_NOTIFICATION_SOUND_STORAGE_KEY,
  collectNewChatNotificationMessages,
  readChatNotificationSoundPreference,
  writeChatNotificationSoundPreference,
  type ChatNotificationMessage
} from "./chatNotificationSound";

function message(id: string, pubkey: string, createdAt: number): ChatNotificationMessage {
  return { id, pubkey, createdAt, content: id };
}

test("chat notification preference defaults on and persists explicit choices", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  } as unknown as Storage;

  assert.equal(readChatNotificationSoundPreference(storage), true);
  writeChatNotificationSoundPreference(storage, false);
  assert.equal(values.get(CHAT_NOTIFICATION_SOUND_STORAGE_KEY), "off");
  assert.equal(readChatNotificationSoundPreference(storage), false);
  writeChatNotificationSoundPreference(storage, true);
  assert.equal(readChatNotificationSoundPreference(storage), true);
});

test("chat notifications exclude history, the viewer, and duplicate relay delivery", () => {
  const seenIds = new Set<string>();
  const activeSinceMs = 10_500;
  const messages = [
    message("history", "other", 9),
    message("self", "viewer", 11),
    message("incoming", "other", 11)
  ];

  assert.deepEqual(
    collectNewChatNotificationMessages({ messages, seenIds, viewerPubkey: "VIEWER", activeSinceMs }).map(
      (item) => item.id
    ),
    ["incoming"]
  );
  assert.deepEqual(
    collectNewChatNotificationMessages({ messages, seenIds, viewerPubkey: "viewer", activeSinceMs }),
    []
  );
  assert.deepEqual(Array.from(seenIds), ["history", "self", "incoming"]);
});

test("chat notifications include messages from the mounting second", () => {
  const seenIds = new Set<string>();
  const messages = [message("same-second", "other", 10)];

  assert.equal(
    collectNewChatNotificationMessages({ messages, seenIds, viewerPubkey: null, activeSinceMs: 10_750 }).length,
    1
  );
});
