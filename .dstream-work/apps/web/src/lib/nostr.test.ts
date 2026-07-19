import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRelayHealthKey, relayBackoffMs } from "./nostr";

test("relay backoff grows exponentially and caps", () => {
  assert.equal(relayBackoffMs(1), 30_000);
  assert.equal(relayBackoffMs(2), 60_000);
  assert.equal(relayBackoffMs(5), 480_000);
  assert.equal(relayBackoffMs(20), 600_000);
});

test("relay health keys normalize the trailing slash used by nostr-tools", () => {
  assert.equal(normalizeRelayHealthKey("wss://relay.damus.io"), normalizeRelayHealthKey("wss://relay.damus.io/"));
});
