import assert from "node:assert/strict";
import { test } from "node:test";
import { canEnableP2pAssist, isP2pStakeSatisfied, normalizeStakeRequiredAtomic } from "./stakeGate";

const THREE_XMR_ATOMIC = "3000000000000";

test("P2P stake gate: 3 XMR must be fully confirmed", () => {
  assert.equal(normalizeStakeRequiredAtomic(THREE_XMR_ATOMIC), THREE_XMR_ATOMIC);
  assert.equal(isP2pStakeSatisfied(THREE_XMR_ATOMIC, null), false);
  assert.equal(isP2pStakeSatisfied(THREE_XMR_ATOMIC, "2999999999999"), false);
  assert.equal(isP2pStakeSatisfied(THREE_XMR_ATOMIC, THREE_XMR_ATOMIC), true);
});

test("P2P stake gate: confirmed stake still requires the connected signing identity", () => {
  assert.equal(
    canEnableP2pAssist({
      hasSignalIdentity: true,
      hasConnectedIdentity: false,
      hasNip04: false,
      requiredAtomic: THREE_XMR_ATOMIC,
      confirmedAtomic: THREE_XMR_ATOMIC
    }),
    false
  );
  assert.equal(
    canEnableP2pAssist({
      hasSignalIdentity: true,
      hasConnectedIdentity: true,
      hasNip04: true,
      requiredAtomic: THREE_XMR_ATOMIC,
      confirmedAtomic: THREE_XMR_ATOMIC
    }),
    true
  );
});

test("P2P stake gate: streams without a stake allow an ephemeral signal identity", () => {
  assert.equal(
    canEnableP2pAssist({
      hasSignalIdentity: true,
      hasConnectedIdentity: false,
      hasNip04: false,
      requiredAtomic: null,
      confirmedAtomic: null
    }),
    true
  );
});
