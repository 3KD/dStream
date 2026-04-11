import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "dstream-access-settlement-test-"));
process.env.DSTREAM_ACCESS_STORE_PATH = join(tempDir, "access.json");
process.env.DSTREAM_XMR_STAKE_AUTO_GRANT = "1";
delete process.env.DSTREAM_XMR_STAKE_AUTO_GRANT_ACTIONS;
delete process.env.DSTREAM_XMR_STAKE_AUTO_GRANT_TTL_SEC;

test("stake settlement auto-grant: private live access allowed after verified settlement", async () => {
  const { grantVerifiedStakeSettlementAccess } = await import("./settlement");
  const { evaluateAccess } = await import("./evaluator");

  const hostPubkey = "1".repeat(64);
  const viewerPubkey = "2".repeat(64);
  const streamId = "private-access-stream";
  const liveResourceId = `stream:${hostPubkey}:${streamId}:live`;

  const result = grantVerifiedStakeSettlementAccess({
    hostPubkey,
    viewerPubkey,
    streamId,
    sessionToken: "stake-session-token-1",
    confirmedAtomic: "250000000000",
    txid: "a".repeat(64),
    observedAtMs: Date.now()
  });

  assert.equal(result.granted, true);
  assert.equal(result.reason, "granted");
  assert.ok(result.entitlement);

  const decision = evaluateAccess({
    hostPubkey,
    subjectPubkey: viewerPubkey,
    resourceId: liveResourceId,
    action: "watch_live",
    announce: {
      privateStream: true,
      privateVideo: false,
      videoArchiveEnabled: true,
      videoVisibility: "public",
      viewerAllowPubkeys: []
    }
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reasonCode, "allow_paid");
  assert.equal(typeof decision.entitlementId, "string");
});

test("stake settlement auto-grant: repeated settlement check is idempotent", async () => {
  const { grantVerifiedStakeSettlementAccess } = await import("./settlement");
  const { listAccessEntitlements } = await import("./store");

  const hostPubkey = "3".repeat(64);
  const viewerPubkey = "4".repeat(64);
  const streamId = "idempotent-stream";
  const resourceId = `stream:${hostPubkey}:${streamId}:*`;

  const first = grantVerifiedStakeSettlementAccess({
    hostPubkey,
    viewerPubkey,
    streamId,
    sessionToken: "stake-session-token-2",
    confirmedAtomic: "100000000000",
    txid: "b".repeat(64),
    observedAtMs: Date.now()
  });
  const second = grantVerifiedStakeSettlementAccess({
    hostPubkey,
    viewerPubkey,
    streamId,
    sessionToken: "stake-session-token-2",
    confirmedAtomic: "100000000000",
    txid: "b".repeat(64),
    observedAtMs: Date.now()
  });

  assert.equal(first.granted, true);
  assert.equal(second.granted, false);
  assert.equal(second.reason, "existing");
  assert.equal(second.entitlement?.id, first.entitlement?.id);

  const rows = listAccessEntitlements({
    hostPubkey,
    subjectPubkey: viewerPubkey,
    resourceId,
    status: "active",
    limit: 10
  });
  assert.equal(rows.length, 1);
});

test("stake settlement auto-revoke: refund revokes session entitlement", async () => {
  const { grantVerifiedStakeSettlementAccess, revokeVerifiedStakeSettlementAccessBySession } = await import("./settlement");
  const { evaluateAccess } = await import("./evaluator");

  const hostPubkey = "7".repeat(64);
  const viewerPubkey = "8".repeat(64);
  const streamId = "refund-revoke-stream";
  const liveResourceId = `stream:${hostPubkey}:${streamId}:live`;
  const sessionToken = "stake-session-token-refund";

  const granted = grantVerifiedStakeSettlementAccess({
    hostPubkey,
    viewerPubkey,
    streamId,
    sessionToken,
    confirmedAtomic: "100000000000",
    txid: "d".repeat(64),
    observedAtMs: Date.now(),
    accountIndex: 0,
    addressIndex: 17
  });
  assert.equal(granted.granted, true);

  const revoked = revokeVerifiedStakeSettlementAccessBySession({
    hostPubkey,
    viewerPubkey,
    streamId,
    sessionToken
  });
  assert.equal(revoked.revokedCount, 1);
  assert.equal(revoked.entitlementIds[0], granted.entitlement?.id);

  const decision = evaluateAccess({
    hostPubkey,
    subjectPubkey: viewerPubkey,
    resourceId: liveResourceId,
    action: "watch_live",
    announce: {
      privateStream: true,
      privateVideo: false,
      videoArchiveEnabled: true,
      videoVisibility: "public",
      viewerAllowPubkeys: []
    }
  });
  assert.equal(decision.allowed, false);
});

test("stake settlement auto-revoke: slash revokes all matching subaddress entitlements", async () => {
  const { grantVerifiedStakeSettlementAccess, revokeVerifiedStakeSettlementAccessByAddress } = await import("./settlement");
  const { listAccessEntitlements } = await import("./store");

  const hostPubkey = "9".repeat(64);
  const streamId = "slash-revoke-stream";
  const accountIndex = 0;
  const addressIndex = 55;

  const e1 = grantVerifiedStakeSettlementAccess({
    hostPubkey,
    viewerPubkey: "a".repeat(64),
    streamId,
    sessionToken: "stake-session-token-slash-1",
    confirmedAtomic: "200000000000",
    txid: "e".repeat(64),
    observedAtMs: Date.now(),
    accountIndex,
    addressIndex
  });
  const e2 = grantVerifiedStakeSettlementAccess({
    hostPubkey,
    viewerPubkey: "b".repeat(64),
    streamId,
    sessionToken: "stake-session-token-slash-2",
    confirmedAtomic: "200000000000",
    txid: "f".repeat(64),
    observedAtMs: Date.now(),
    accountIndex,
    addressIndex
  });
  const keep = grantVerifiedStakeSettlementAccess({
    hostPubkey,
    viewerPubkey: "c".repeat(64),
    streamId: "different-stream",
    sessionToken: "stake-session-token-slash-3",
    confirmedAtomic: "200000000000",
    txid: "1".repeat(64),
    observedAtMs: Date.now(),
    accountIndex,
    addressIndex
  });

  assert.equal(e1.granted, true);
  assert.equal(e2.granted, true);
  assert.equal(keep.granted, true);

  const revoked = revokeVerifiedStakeSettlementAccessByAddress({
    hostPubkey,
    streamId,
    accountIndex,
    addressIndex
  });
  assert.equal(revoked.revokedCount, 2);

  const activeSameStream = listAccessEntitlements({
    hostPubkey,
    resourceId: `stream:${hostPubkey}:${streamId}:*`,
    status: "active",
    limit: 20
  });
  assert.equal(activeSameStream.length, 0);

  const activeOtherStream = listAccessEntitlements({
    hostPubkey,
    resourceId: `stream:${hostPubkey}:different-stream:*`,
    status: "active",
    limit: 20
  });
  assert.equal(activeOtherStream.length, 1);
  assert.equal(activeOtherStream[0]?.id, keep.entitlement?.id);
});

test("stake settlement auto-grant: disabled flag skips grant", async () => {
  process.env.DSTREAM_XMR_STAKE_AUTO_GRANT = "0";
  const { grantVerifiedStakeSettlementAccess } = await import("./settlement");
  const { listAccessEntitlements } = await import("./store");

  const hostPubkey = "5".repeat(64);
  const viewerPubkey = "6".repeat(64);
  const streamId = "disabled-stream";
  const resourceId = `stream:${hostPubkey}:${streamId}:*`;

  const result = grantVerifiedStakeSettlementAccess({
    hostPubkey,
    viewerPubkey,
    streamId,
    sessionToken: "stake-session-token-3",
    confirmedAtomic: "100000000000",
    txid: "c".repeat(64),
    observedAtMs: Date.now()
  });

  assert.equal(result.granted, false);
  assert.equal(result.reason, "disabled");

  const rows = listAccessEntitlements({
    hostPubkey,
    subjectPubkey: viewerPubkey,
    resourceId,
    status: "all",
    limit: 10
  });
  assert.equal(rows.length, 0);
  process.env.DSTREAM_XMR_STAKE_AUTO_GRANT = "1";
});

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
