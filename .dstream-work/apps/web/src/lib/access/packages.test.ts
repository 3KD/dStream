import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "dstream-vod-packages-test-"));
process.env.DSTREAM_ACCESS_STORE_PATH = join(tempDir, "access.json");
process.env.DSTREAM_VOD_PACKAGE_STORE_PATH = join(tempDir, "vod-packages.json");

test("vod packages: upsert + list + disable", async () => {
  const { listVodAccessPackages, upsertVodAccessPackage, disableVodAccessPackage } = await import("./packages");

  const hostPubkey = "1".repeat(64);
  const created = upsertVodAccessPackage({
    hostPubkey,
    streamId: "vod-alpha",
    title: "Monthly all-VOD",
    paymentAsset: "xmr",
    paymentAmount: "0.35",
    durationHours: 24 * 30
  });
  assert.equal(created.status, "active");
  assert.equal(created.resourceId, `stream:${hostPubkey}:vod-alpha:vod:*`);

  const listed = listVodAccessPackages({ hostPubkey, includeDisabled: true, includeUnlisted: true, limit: 20 });
  assert.equal(listed.length >= 1, true);
  assert.equal(listed.find((row) => row.id === created.id)?.title, "Monthly all-VOD");

  const disabled = disableVodAccessPackage({ packageId: created.id, hostPubkey });
  assert.equal(disabled.status, "disabled");

  const activeOnly = listVodAccessPackages({ hostPubkey, includeDisabled: false, includeUnlisted: true, limit: 20 });
  assert.equal(activeOnly.some((row) => row.id === created.id), false);
});

test("vod packages: purchase grants watch_vod and is idempotent by sourceRef", async () => {
  const { grantVodPackagePurchaseAccess, upsertVodAccessPackage } = await import("./packages");
  const { evaluateAccess } = await import("./evaluator");

  const hostPubkey = "2".repeat(64);
  const viewerPubkey = "3".repeat(64);
  const streamId = "vod-beta";

  const pkg = upsertVodAccessPackage({
    hostPubkey,
    streamId,
    title: "Episode pass",
    playlistId: "season1",
    paymentAsset: "btc",
    paymentAmount: "0.0005",
    durationHours: 24 * 7
  });

  const sourceRef = "tx:abc123";
  const first = grantVodPackagePurchaseAccess({
    packageId: pkg.id,
    viewerPubkey,
    source: "purchase_verified",
    sourceRef
  });
  assert.equal(first.granted, true);
  assert.equal(first.purchase.status, "granted");
  assert.equal(first.entitlement.sourceRef, sourceRef);
  assert.equal(first.entitlement.actions.includes("watch_vod"), true);

  const second = grantVodPackagePurchaseAccess({
    packageId: pkg.id,
    viewerPubkey,
    source: "purchase_verified",
    sourceRef
  });
  assert.equal(second.granted, false);
  assert.equal(second.purchase.status, "existing");
  assert.equal(second.entitlement.id, first.entitlement.id);

  const decision = evaluateAccess({
    hostPubkey,
    subjectPubkey: viewerPubkey,
    resourceId: `stream:${hostPubkey}:${streamId}:vod:season1:*`,
    action: "watch_vod",
    announce: {
      privateStream: false,
      privateVod: true,
      vodArchiveEnabled: true,
      vodVisibility: "private",
      viewerAllowPubkeys: []
    }
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reasonCode, "allow_paid");
});

test("vod packages: resource id helper + package lookup + purchase listing", async () => {
  const {
    buildVodAccessResourceCandidates,
    buildVodFileResourceId,
    buildVodPackageResourceId,
    getVodAccessPackageById,
    listVodPackagePurchases,
    upsertVodAccessPackage,
    grantVodPackagePurchaseAccess
  } = await import("./packages");

  const hostPubkey = "4".repeat(64);
  const streamId = "vod-gamma";
  const playlistId = "season2";
  const relativePath = "season2/episode01.mp4";
  const viewerPubkey = "5".repeat(64);
  const resourceId = buildVodPackageResourceId(hostPubkey, streamId, playlistId);
  const fileResourceId = buildVodFileResourceId(hostPubkey, streamId, relativePath);
  assert.equal(resourceId, `stream:${hostPubkey}:${streamId}:vod:${playlistId}:*`);
  assert.equal(fileResourceId.startsWith(`stream:${hostPubkey}:${streamId}:vod:file:`), true);
  const candidateResources = buildVodAccessResourceCandidates({
    hostPubkey,
    streamId,
    relativePath
  });
  assert.deepEqual(candidateResources.slice(0, 2), [fileResourceId, resourceId]);

  const created = upsertVodAccessPackage({
    hostPubkey,
    streamId,
    relativePath,
    title: "Season pass",
    paymentAsset: "xmr",
    paymentAmount: "0.2",
    durationHours: 48
  });
  const found = getVodAccessPackageById(created.id);
  assert.ok(found);
  if (!found) return;
  assert.equal(found.resourceId, fileResourceId);
  assert.equal(found.relativePath, relativePath);

  const grant = grantVodPackagePurchaseAccess({
    packageId: created.id,
    viewerPubkey,
    source: "purchase_verified",
    sourceRef: "purchase:season2:001"
  });
  assert.equal(grant.purchase.status, "granted");

  const purchases = listVodPackagePurchases({
    hostPubkey,
    viewerPubkey,
    packageId: created.id,
    limit: 10
  });
  assert.equal(purchases.length >= 1, true);
  assert.equal(purchases[0]?.packageId, created.id);
});

test("vod packages: purchase stats aggregate by package id", async () => {
  const { listVodPackagePurchaseStats, upsertVodAccessPackage, grantVodPackagePurchaseAccess } = await import("./packages");
  const hostPubkey = "7".repeat(64);
  const streamId = "vod-epsilon";
  const packageA = upsertVodAccessPackage({
    hostPubkey,
    streamId,
    title: "Stats A",
    paymentAsset: "xmr",
    paymentAmount: "0.11",
    durationHours: 24
  });
  const packageB = upsertVodAccessPackage({
    hostPubkey,
    streamId,
    title: "Stats B",
    paymentAsset: "xmr",
    paymentAmount: "0.22",
    durationHours: 24
  });
  const viewerA = "8".repeat(64);
  const viewerB = "9".repeat(64);

  grantVodPackagePurchaseAccess({
    packageId: packageA.id,
    viewerPubkey: viewerA,
    source: "purchase_verified",
    sourceRef: "stats:a:1",
    metadata: { operatorOverride: true }
  });
  grantVodPackagePurchaseAccess({
    packageId: packageA.id,
    viewerPubkey: viewerB,
    source: "purchase_unverified",
    sourceRef: "stats:a:2",
    metadata: { unverifiedFallback: true }
  });
  grantVodPackagePurchaseAccess({
    packageId: packageA.id,
    viewerPubkey: viewerA,
    source: "purchase_verified",
    sourceRef: "stats:a:1"
  });
  grantVodPackagePurchaseAccess({
    packageId: packageB.id,
    viewerPubkey: viewerA,
    source: "purchase_verified",
    sourceRef: "stats:b:1"
  });

  const stats = listVodPackagePurchaseStats({ hostPubkey, packageIds: [packageA.id, packageB.id], limit: 200 });
  assert.equal(stats[packageA.id]?.totalPurchases, 3);
  assert.equal(stats[packageA.id]?.grantedPurchases, 2);
  assert.equal(stats[packageA.id]?.existingPurchases, 1);
  assert.equal(stats[packageA.id]?.verifiedPurchases, 2);
  assert.equal(stats[packageA.id]?.unverifiedPurchases, 1);
  assert.equal(stats[packageA.id]?.operatorOverridePurchases, 1);
  assert.equal(stats[packageA.id]?.unverifiedFallbackPurchases, 1);
  assert.equal(stats[packageA.id]?.uniqueViewerCount, 2);
  assert.equal(stats[packageB.id]?.totalPurchases, 1);
  assert.equal(stats[packageB.id]?.grantedPurchases, 1);
});

test("vod packages: rejects mixed playlist + relative path scope", async () => {
  const { upsertVodAccessPackage } = await import("./packages");
  const hostPubkey = "6".repeat(64);
  assert.throws(
    () =>
      upsertVodAccessPackage({
        hostPubkey,
        streamId: "vod-delta",
        playlistId: "season-a",
        relativePath: "season-a/ep-01.mp4",
        title: "Invalid mixed scope",
        paymentAsset: "xmr",
        paymentAmount: "0.1",
        durationHours: 24
      }),
    /Only one package scope is allowed/
  );
});

test("vod package policy: normalize + metadata defaults", async () => {
  const { getVodPurchasePolicyFromMetadata, getVodPurchasePolicyLabel, normalizeVodPurchasePolicy } = await import(
    "./vodPackagePolicy"
  );

  assert.equal(normalizeVodPurchasePolicy("verified_only"), "verified_only");
  assert.equal(normalizeVodPurchasePolicy("unverified_ok"), "unverified_ok");
  assert.equal(normalizeVodPurchasePolicy(""), "operator_or_verified");
  assert.equal(getVodPurchasePolicyFromMetadata({ purchasePolicy: "verified_only" }), "verified_only");
  assert.equal(getVodPurchasePolicyFromMetadata({}), "operator_or_verified");
  assert.equal(getVodPurchasePolicyLabel("operator_or_verified"), "Verified or operator override");
});

test("vod checkout helpers: verification labels + error normalization", async () => {
  const { formatVodCheckoutVerificationMode, normalizeVodPurchaseErrorMessage } = await import("./vodCheckout");
  assert.equal(formatVodCheckoutVerificationMode("stake_verified"), "verified stake settlement");
  assert.equal(formatVodCheckoutVerificationMode("operator_override"), "host operator confirmation");
  assert.equal(
    normalizeVodPurchaseErrorMessage("This package requires verified settlement.", "verified_only"),
    "This package requires verified settlement. Use verified stake flow or host confirmation."
  );
  assert.equal(
    normalizeVodPurchaseErrorMessage("verification failed", "operator_or_verified"),
    "Verification failed. Ask host operator to confirm purchase or complete verified settlement."
  );
});

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
