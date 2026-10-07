import assert from "node:assert/strict";
import test from "node:test";
import type { Event as NostrEvent } from "nostr-tools/core";
import { createNostrWasmVerifier, loadNostrWasm, type NostrWasmRuntime } from "./nostrWasm";

const validEvent: NostrEvent = {
  kind: 1,
  created_at: 1,
  tags: [],
  content: "dstream wasm verifier",
  pubkey: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  id: "b4ca74adcf5d4036bead03cb67be9cb6ccc1bc1458ad24e1236d9631f7aa738f",
  sig: "f0a51b943eae3549f92a5b85ed2be29ab79b09e36e280a9181df13814d1c96e36084ab5baf653a68e8cb966a2a378441a9f6c2fed7ca2729fea46f17f6532677"
};

test("WASM verifier accepts a valid event and rejects tampering", async () => {
  const runtime = await loadNostrWasm();
  const verify = createNostrWasmVerifier(runtime);

  assert.equal(verify({ ...validEvent }), true);
  assert.equal(verify({ ...validEvent, content: "tampered" }), false);
});

test("WASM verifier rejects malformed events before invoking secp256k1", () => {
  let calls = 0;
  const runtime = {
    verifyEvent() {
      calls += 1;
    }
  } as unknown as NostrWasmRuntime;
  const verify = createNostrWasmVerifier(runtime);

  assert.equal(verify({ ...validEvent, sig: "not-a-signature" }), false);
  assert.equal(calls, 0);
});
