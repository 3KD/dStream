import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "dstream-access-store-test-"));
process.env.DSTREAM_ACCESS_STORE_PATH = join(tempDir, "access.json");

test("access store: grant + revoke entitlement lifecycle", async () => {
  const { grantAccessEntitlement, revokeAccessEntitlement, listAccessEntitlements } = await import("./store");

  const hostPubkey = "1".repeat(64);
  const subjectPubkey = "2".repeat(64);
  const resourceId = `stream:${hostPubkey}:unit-test:live`;
  const granted = grantAccessEntitlement({
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions: ["watch_live"],
    source: "manual_grant"
  });
  assert.equal(granted.status, "active");

  const active = listAccessEntitlements({ hostPubkey, subjectPubkey, resourceId, status: "active", limit: 10 });
  assert.equal(active.length, 1);

  const revoked = revokeAccessEntitlement({ entitlementId: granted.id, revokeReason: "unit-test" });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revokeReason, "unit-test");

  const postRevokeActive = listAccessEntitlements({ hostPubkey, subjectPubkey, resourceId, status: "active", limit: 10 });
  assert.equal(postRevokeActive.length, 0);
});

test("access store: deny rules list excludes expired entries", async () => {
  const { listAccessDenyRules, upsertAccessDenyRule } = await import("./store");
  const now = Math.floor(Date.now() / 1000);

  const hostPubkey = "3".repeat(64);
  const subjectPubkey = "4".repeat(64);
  const resourceId = `stream:${hostPubkey}:unit-test:live`;

  upsertAccessDenyRule({
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions: ["watch_live"],
    reason: "expired",
    startsAtSec: now - 100,
    expiresAtSec: now - 10
  });

  upsertAccessDenyRule({
    hostPubkey,
    subjectPubkey,
    resourceId,
    actions: ["watch_live"],
    reason: "active",
    startsAtSec: now - 50,
    expiresAtSec: now + 300
  });

  const rows = listAccessDenyRules({ hostPubkey, subjectPubkey, resourceId, limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.reason, "active");
});

test("access store: append + query audit records", async () => {
  const { appendAccessAuditRecord, listAccessAudit } = await import("./store");
  const hostPubkey = "5".repeat(64);
  const subjectPubkey = "6".repeat(64);
  const resourceId = `stream:${hostPubkey}:audit-test:live`;

  const created = appendAccessAuditRecord({
    hostPubkey,
    subjectPubkey,
    resourceId,
    action: "watch_live",
    allowed: false,
    reasonCode: "deny_private_allowlist",
    requestId: "audit-request-1",
    metadata: { source: "unit-test" }
  });
  assert.equal(created.reasonCode, "deny_private_allowlist");

  const rows = listAccessAudit({ hostPubkey, subjectPubkey, resourceId, limit: 10 });
  assert.equal(rows.length >= 1, true);
  assert.equal(rows[0]?.requestId, "audit-request-1");
});

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
