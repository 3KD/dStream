import assert from "node:assert/strict";
import { test } from "node:test";
import { nip19 } from "nostr-tools";
import { parseChatCommand } from "./chatCommands";

const PUBKEY_A = "a".repeat(64);
const PUBKEY_B = "b".repeat(64);

test("parseChatCommand: returns null for plain message", () => {
  assert.equal(parseChatCommand("hello"), null);
});

test("parseChatCommand: parses alias command", () => {
  const npub = nip19.npubEncode(PUBKEY_A);
  const parsed = parseChatCommand(`/name ${npub} Alice Example`);
  assert.ok(parsed?.ok);
  if (!parsed || !parsed.ok) return;
  assert.equal(parsed.command.type, "set_alias");
  if (parsed.command.type !== "set_alias") return;
  assert.equal(parsed.command.targetPubkey, PUBKEY_A);
  assert.equal(parsed.command.alias, "Alice Example");
});

test("parseChatCommand: parses whisper command with recipient list", () => {
  const parsed = parseChatCommand(`/wh(${PUBKEY_A},${PUBKEY_B}) hi there`);
  assert.ok(parsed?.ok);
  if (!parsed || !parsed.ok) return;
  assert.equal(parsed.command.type, "whisper");
  if (parsed.command.type !== "whisper") return;
  assert.deepEqual(parsed.command.recipients, [PUBKEY_A, PUBKEY_B]);
  assert.equal(parsed.command.message, "hi there");
});

test("parseChatCommand: parses mute and unban", () => {
  const mute = parseChatCommand(`/mute ${PUBKEY_A}`);
  assert.ok(mute?.ok);
  if (!mute || !mute.ok) return;
  assert.equal(mute.command.type, "mute");

  const unban = parseChatCommand(`/unban ${PUBKEY_B}`);
  assert.ok(unban?.ok);
  if (!unban || !unban.ok) return;
  assert.equal(unban.command.type, "unban");
});

test("parseChatCommand: rejects invalid command target", () => {
  const parsed = parseChatCommand("/ban nope");
  assert.ok(parsed && !parsed.ok);
});
