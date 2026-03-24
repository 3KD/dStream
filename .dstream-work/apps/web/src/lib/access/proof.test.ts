import assert from "node:assert/strict";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { test } from "node:test";
import { normalizeProofPubkey, readAccessOperatorPubkeys, verifyAccessProof } from "./proof";

test("access proof: verifies signed proof with scope", () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const now = Math.floor(Date.now() / 1000);

  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: now,
      tags: [
        ["dstream", "access_admin"],
        ["exp", String(now + 300)]
      ],
      content: "",
      pubkey
    } as any,
    secret
  );

  const verified = verifyAccessProof(event, "access_admin");
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.pubkey, pubkey);
});

test("access proof: rejects scope and stale timestamps", () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const now = Math.floor(Date.now() / 1000);

  const wrongScope = finalizeEvent(
    {
      kind: 27235,
      created_at: now,
      tags: [
        ["dstream", "other_scope"],
        ["exp", String(now + 300)]
      ],
      content: "",
      pubkey
    } as any,
    secret
  );
  const scopeResult = verifyAccessProof(wrongScope, "access_admin");
  assert.equal(scopeResult.ok, false);
  if (!scopeResult.ok) assert.equal(scopeResult.status, 401);

  const stale = finalizeEvent(
    {
      kind: 27235,
      created_at: now - 3600,
      tags: [
        ["dstream", "access_admin"],
        ["exp", String(now + 300)]
      ],
      content: "",
      pubkey
    } as any,
    secret
  );
  const staleResult = verifyAccessProof(stale, "access_admin");
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.error, "Signed proof timestamp is stale.");
});

test("access proof: operator list parsing + pubkey normalization", () => {
  process.env.DSTREAM_ACCESS_OPERATOR_PUBKEYS = `\n${"a".repeat(64)},${"A".repeat(64)},bad,${"b".repeat(64)}\n`;
  const parsed = readAccessOperatorPubkeys();
  assert.deepEqual(parsed.sort(), ["a".repeat(64), "b".repeat(64)].sort());

  assert.equal(normalizeProofPubkey("A".repeat(64)), "a".repeat(64));
  assert.equal(normalizeProofPubkey("not-a-key"), null);
});
