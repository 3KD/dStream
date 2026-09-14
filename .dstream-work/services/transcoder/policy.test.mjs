import assert from "node:assert/strict";
import test from "node:test";

import { restartDecision, restartDelayMs } from "./policy.mjs";

test("restart delay grows exponentially and is capped", () => {
  assert.equal(restartDelayMs(1, 2_000, 60_000), 2_000);
  assert.equal(restartDelayMs(2, 2_000, 60_000), 4_000);
  assert.equal(restartDelayMs(7, 2_000, 60_000), 60_000);
  assert.equal(restartDelayMs(20, 2_000, 60_000), 60_000);
});

test("a sustained run resets the failure sequence", () => {
  assert.deepEqual(
    restartDecision({
      failureCount: 5,
      runDurationMs: 120_000,
      resetAfterMs: 120_000,
      baseMs: 2_000,
      maxMs: 60_000,
      circuitFailures: 8,
      circuitCooldownMs: 300_000
    }),
    { failureCount: 1, delayMs: 2_000, circuitOpen: false }
  );
});

test("repeated failures open a cooldown circuit", () => {
  assert.deepEqual(
    restartDecision({
      failureCount: 7,
      runDurationMs: 500,
      resetAfterMs: 120_000,
      baseMs: 2_000,
      maxMs: 60_000,
      circuitFailures: 8,
      circuitCooldownMs: 300_000
    }),
    { failureCount: 0, delayMs: 300_000, circuitOpen: true }
  );
});
