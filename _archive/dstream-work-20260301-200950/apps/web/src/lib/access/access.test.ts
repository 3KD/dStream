import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "dstream-access-test-"));
process.env.DSTREAM_ACCESS_STORE_PATH = join(tempDir, "access.json");

test("access evaluator: paid entitlement allows private live watch", async () => {
  const { grantAccessEntitlement } = await import("./store");
  const { evaluateAccess } = await import("./evaluator");

  const hostPubkey = "a".repeat(64);
  const subjectPubkey = "b".repeat(64);
  const streamId = "test-stream-private";
  const resourceId = `stream:${hostPubkey}:${streamId}:live`;

  grantAccessEntitlement({
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions: ["watch_live"],
    source: "purchase_verified"
  });

  const decision = evaluateAccess({
    hostPubkey,
    subjectPubkey,
    resourceId,
    action: "watch_live",
    announce: {
      privateStream: true,
      privateVod: false,
      vodArchiveEnabled: true,
      vodVisibility: "public",
      viewerAllowPubkeys: []
    }
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reasonCode, "allow_paid");
});

test("access evaluator: explicit deny overrides paid entitlement", async () => {
  const { grantAccessEntitlement, upsertAccessDenyRule } = await import("./store");
  const { evaluateAccess } = await import("./evaluator");

  const hostPubkey = "c".repeat(64);
  const subjectPubkey = "d".repeat(64);
  const streamId = "test-stream-deny";
  const resourceId = `stream:${hostPubkey}:${streamId}:live`;

  grantAccessEntitlement({
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions: ["watch_live"],
    source: "purchase_verified"
  });
  upsertAccessDenyRule({
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions: ["watch_live"],
    reason: "blocked"
  });

  const decision = evaluateAccess({
    hostPubkey,
    subjectPubkey,
    resourceId,
    action: "watch_live",
    announce: {
      privateStream: false,
      privateVod: false,
      vodArchiveEnabled: true,
      vodVisibility: "public",
      viewerAllowPubkeys: []
    }
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "deny_explicit");
});

test("access evaluator: private stream requires identity when no subject pubkey", async () => {
  const { evaluateAccess } = await import("./evaluator");
  const hostPubkey = "e".repeat(64);
  const streamId = "test-stream-identity";
  const resourceId = `stream:${hostPubkey}:${streamId}:live`;

  const decision = evaluateAccess({
    hostPubkey,
    resourceId,
    action: "watch_live",
    announce: {
      privateStream: true,
      privateVod: false,
      vodArchiveEnabled: true,
      vodVisibility: "public",
      viewerAllowPubkeys: []
    }
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "deny_identity_required");
});

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

