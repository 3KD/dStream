import assert from "node:assert/strict";
import test from "node:test";
import { createCachedEventVerifier, normalizeRelayHealthKey, relayBackoffMs } from "./nostr";

test("relay backoff grows exponentially and caps", () => {
  assert.equal(relayBackoffMs(1), 30_000);
  assert.equal(relayBackoffMs(2), 60_000);
  assert.equal(relayBackoffMs(5), 480_000);
  assert.equal(relayBackoffMs(20), 600_000);
});

test("relay health keys normalize the trailing slash used by nostr-tools", () => {
  assert.equal(normalizeRelayHealthKey("wss://relay.damus.io"), normalizeRelayHealthKey("wss://relay.damus.io/"));
});

test("event verification is reused only for the same event id and signature", () => {
  let calls = 0;
  const verify = createCachedEventVerifier(() => {
    calls += 1;
    return true;
  });
  const event = {
    id: "a".repeat(64),
    sig: "b".repeat(128),
    pubkey: "c".repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: ""
  } as any;

  assert.equal(verify(event), true);
  assert.equal(verify({ ...event }), true);
  assert.equal(calls, 1);

  assert.equal(verify({ ...event, sig: "d".repeat(128) }), true);
  assert.equal(calls, 2);
});

test("event verification cache is bounded", () => {
  let calls = 0;
  const verify = createCachedEventVerifier(() => {
    calls += 1;
    return true;
  }, 2);
  const event = (id: string) => ({
    id: id.repeat(64),
    sig: "f".repeat(128),
    pubkey: "e".repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: ""
  }) as any;

  verify(event("a"));
  verify(event("b"));
  verify(event("c"));
  verify(event("a"));
  assert.equal(calls, 4);
});
