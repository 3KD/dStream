import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "dstream-video-packages-test-"));
process.env.DSTREAM_ACCESS_STORE_PATH = join(tempDir, "access.json");
process.env.DSTREAM_Video_PACKAGE_STORE_PATH = join(tempDir, "video-packages.json");

test("video packages: upsert + list + disable", async () => {
  const { listVideoAccessPackages, upsertVideoAccessPackage, disableVideoAccessPackage } = await import("./packages");

  const hostPubkey = "1".repeat(64);
  const created = upsertVideoAccessPackage({
    hostPubkey,
    streamId: "video-alpha",
    title: "Monthly all-Video",
    paymentAsset: "xmr",
    paymentAmount: "0.35",
    durationHours: 24 * 30
  });
  assert.equal(created.status, "active");
  assert.equal(created.resourceId, `stream:${hostPubkey}:video-alpha:video:*`);

  const listed = listVideoAccessPackages({ hostPubkey, includeDisabled: true, includeUnlisted: true, limit: 20 });
  assert.equal(listed.length >= 1, true);
  assert.equal(listed.find((row) => row.id === created.id)?.title, "Monthly all-Video");

  const disabled = disableVideoAccessPackage({ packageId: created.id, hostPubkey });
  assert.equal(disabled.status, "disabled");

  const activeOnly = listVideoAccessPackages({ hostPubkey, includeDisabled: false, includeUnlisted: true, limit: 20 });
  assert.equal(activeOnly.some((row) => row.id === created.id), false);
});

test("video packages: purchase grants watch_video and is idempotent by sourceRef", async () => {
  const { grantVideoPackagePurchaseAccess, upsertVideoAccessPackage } = await import("./packages");
  const { evaluateAccess } = await import("./evaluator");

  const hostPubkey = "2".repeat(64);
  const viewerPubkey = "3".repeat(64);
  const streamId = "video-beta";

  const pkg = upsertVideoAccessPackage({
    hostPubkey,
    streamId,
    title: "Episode pass",
    playlistId: "season1",
    paymentAsset: "btc",
    paymentAmount: "0.0005",
    durationHours: 24 * 7,
    metadata: {
      paymentSession: {
        operatorEndpoint: "https://operator.example/lightning"
      }
    }
  });

  const sourceRef = "tx:abc123";
  const first = grantVideoPackagePurchaseAccess({
    packageId: pkg.id,
    viewerPubkey,
    source: "purchase_verified",
    sourceRef
  });
  assert.equal(first.granted, true);
  assert.equal(first.purchase.status, "granted");
  assert.equal(first.entitlement.sourceRef, sourceRef);
  assert.equal(first.entitlement.actions.includes("watch_video"), true);

  const second = grantVideoPackagePurchaseAccess({
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
    resourceId: `stream:${hostPubkey}:${streamId}:video:season1:*`,
    action: "watch_video",
    announce: {
      privateStream: false,
      privateVideo: true,
      videoArchiveEnabled: true,
      videoVisibility: "private",
      viewerAllowPubkeys: []
    }
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reasonCode, "allow_paid");
});

test("video packages: resource id helper + package lookup + purchase listing", async () => {
  const {
    buildVideoAccessResourceCandidates,
    buildVideoFileResourceId,
    buildVideoPackageResourceId,
    getVideoAccessPackageById,
    listVideoPackagePurchases,
    upsertVideoAccessPackage,
    grantVideoPackagePurchaseAccess
  } = await import("./packages");

  const hostPubkey = "4".repeat(64);
  const streamId = "video-gamma";
  const playlistId = "season2";
  const relativePath = "season2/episode01.mp4";
  const viewerPubkey = "5".repeat(64);
  const resourceId = buildVideoPackageResourceId(hostPubkey, streamId, playlistId);
  const fileResourceId = buildVideoFileResourceId(hostPubkey, streamId, relativePath);
  assert.equal(resourceId, `stream:${hostPubkey}:${streamId}:video:${playlistId}:*`);
  assert.equal(fileResourceId.startsWith(`stream:${hostPubkey}:${streamId}:video:file:`), true);
  const candidateResources = buildVideoAccessResourceCandidates({
    hostPubkey,
    streamId,
    relativePath
  });
  assert.deepEqual(candidateResources.slice(0, 2), [fileResourceId, resourceId]);

  const created = upsertVideoAccessPackage({
    hostPubkey,
    streamId,
    relativePath,
    title: "Season pass",
    paymentAsset: "xmr",
    paymentAmount: "0.2",
    durationHours: 48
  });
  const found = getVideoAccessPackageById(created.id);
  assert.ok(found);
  if (!found) return;
  assert.equal(found.resourceId, fileResourceId);
  assert.equal(found.relativePath, relativePath);

  const grant = grantVideoPackagePurchaseAccess({
    packageId: created.id,
    viewerPubkey,
    source: "purchase_verified",
    sourceRef: "purchase:season2:001"
  });
  assert.equal(grant.purchase.status, "granted");

  const purchases = listVideoPackagePurchases({
    hostPubkey,
    viewerPubkey,
    packageId: created.id,
    limit: 10
  });
  assert.equal(purchases.length >= 1, true);
  assert.equal(purchases[0]?.packageId, created.id);
});

test("video packages: verified settlement derives canonical source and persists settlement metadata", async () => {
  const { grantVideoPackagePurchaseAccess, listVideoPackagePurchases, upsertVideoAccessPackage } = await import("./packages");

  const hostPubkey = "d".repeat(64);
  const viewerPubkey = "e".repeat(64);
  const pkg = upsertVideoAccessPackage({
    hostPubkey,
    streamId: "video-settlement",
    title: "Verified settlement package",
    paymentAsset: "btc",
    paymentRailId: "lightning",
    paymentAmount: "0.0005",
    durationHours: 24,
    metadata: {
      paymentSession: {
        operatorEndpoint: "https://operator.example/lightning"
      }
    }
  });

  const grant = grantVideoPackagePurchaseAccess({
    packageId: pkg.id,
    viewerPubkey,
    source: "purchase_verified",
    verifiedSettlement: {
      version: 1,
      railId: "lightning",
      asset: "btc",
      settlementKind: "purchase",
      settlementRef: "invoice:ln-settlement",
      txRef: "ln-settlement",
      confirmed: true,
      observedAtMs: Date.now(),
      verifier: "external_verifier"
    }
  });

  assert.equal(grant.entitlement.sourceRef, "settlement:v1:lightning:invoice:ln-settlement");
  assert.equal(grant.purchase.settlementRef, "invoice:ln-settlement");
  assert.equal(grant.purchase.verifiedSettlement?.railId, "lightning");

  const purchases = listVideoPackagePurchases({
    hostPubkey,
    viewerPubkey,
    packageId: pkg.id,
    limit: 10
  });
  assert.equal(purchases[0]?.verifiedSettlement?.settlementRef, "invoice:ln-settlement");
});

test("video packages: payment targets round-trip through package storage", async () => {
  const { getVideoAccessPackageById, upsertVideoAccessPackage } = await import("./packages");

  const hostPubkey = "f".repeat(64);
  const created = upsertVideoAccessPackage({
    hostPubkey,
    streamId: "video-targets",
    title: "Targeted package",
    paymentAsset: "eth",
    paymentRailId: "evm",
    paymentAmount: "0.25",
    paymentTarget: {
      version: 1,
      railId: "evm",
      asset: "eth",
      destination: "0x1111111111111111111111111111111111111111",
      network: "ethereum",
      label: "Primary treasury",
      amount: "0.25",
      amountAtomic: "250000000000000000"
    },
    durationHours: 72,
    metadata: {
      paymentSession: {
        operatorEndpoint: "https://operator.example/evm"
      }
    }
  });

  const found = getVideoAccessPackageById(created.id);
  assert.ok(found);
  if (!found) return;
  assert.equal(found.paymentRailId, "evm");
  assert.deepEqual(found.paymentTarget, {
    version: 1,
    railId: "evm",
    asset: "eth",
    destination: "0x1111111111111111111111111111111111111111",
    network: "ethereum",
    label: "Primary treasury",
    amount: "0.25",
    amountAtomic: "250000000000000000",
    contractAddress: undefined,
    reference: undefined,
    metadata: {}
  });
});

test("video packages: purchase stats aggregate by package id", async () => {
  const { listVideoPackagePurchaseStats, upsertVideoAccessPackage, grantVideoPackagePurchaseAccess } = await import("./packages");
  const hostPubkey = "7".repeat(64);
  const streamId = "video-epsilon";
  const packageA = upsertVideoAccessPackage({
    hostPubkey,
    streamId,
    title: "Stats A",
    paymentAsset: "xmr",
    paymentAmount: "0.11",
    durationHours: 24
  });
  const packageB = upsertVideoAccessPackage({
    hostPubkey,
    streamId,
    title: "Stats B",
    paymentAsset: "xmr",
    paymentAmount: "0.22",
    durationHours: 24
  });
  const viewerA = "8".repeat(64);
  const viewerB = "9".repeat(64);

  grantVideoPackagePurchaseAccess({
    packageId: packageA.id,
    viewerPubkey: viewerA,
    source: "purchase_verified",
    sourceRef: "stats:a:1",
    metadata: { operatorOverride: true }
  });
  grantVideoPackagePurchaseAccess({
    packageId: packageA.id,
    viewerPubkey: viewerB,
    source: "purchase_unverified",
    sourceRef: "stats:a:2",
    metadata: { unverifiedFallback: true }
  });
  grantVideoPackagePurchaseAccess({
    packageId: packageA.id,
    viewerPubkey: viewerA,
    source: "purchase_verified",
    sourceRef: "stats:a:1"
  });
  grantVideoPackagePurchaseAccess({
    packageId: packageB.id,
    viewerPubkey: viewerA,
    source: "purchase_verified",
    sourceRef: "stats:b:1"
  });

  const stats = listVideoPackagePurchaseStats({ hostPubkey, packageIds: [packageA.id, packageB.id], limit: 200 });
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

test("video packages: rejects mixed playlist + relative path scope", async () => {
  const { upsertVideoAccessPackage } = await import("./packages");
  const hostPubkey = "6".repeat(64);
  assert.throws(
    () =>
      upsertVideoAccessPackage({
        hostPubkey,
        streamId: "video-delta",
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

test("video packages: non-xmr paid packages require operator sessions unless legacy fallback is explicitly enabled", async () => {
  const { upsertVideoAccessPackage } = await import("./packages");
  const hostPubkey = "a".repeat(64);

  assert.throws(
    () =>
      upsertVideoAccessPackage({
        hostPubkey,
        streamId: "video-operator-required",
        title: "Missing operator",
        paymentAsset: "eth",
        paymentRailId: "evm",
        paymentAmount: "0.1",
        paymentTarget: {
          version: 1,
          railId: "evm",
          asset: "eth",
          destination: "0x1111111111111111111111111111111111111111",
          network: "ethereum"
        },
        durationHours: 24
      }),
    /require a node-operator session endpoint/
  );

  assert.throws(
    () =>
      upsertVideoAccessPackage({
        hostPubkey,
        streamId: "video-operator-unsafe-endpoint",
        title: "Unsafe operator",
        paymentAsset: "eth",
        paymentRailId: "evm",
        paymentAmount: "0.1",
        paymentTarget: {
          version: 1,
          railId: "evm",
          asset: "eth",
          destination: "0x1111111111111111111111111111111111111111",
          network: "ethereum"
        },
        durationHours: 24,
        metadata: {
          paymentSession: {
            operatorEndpoint: "https://user:pass@operator.example/evm"
          }
        }
      }),
    /must not embed credentials/
  );

  const previous = process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS;
  process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS = "1";
  try {
    const legacy = upsertVideoAccessPackage({
      hostPubkey,
      streamId: "video-operator-required-dev",
      title: "Legacy dev fallback",
      paymentAsset: "eth",
      paymentRailId: "evm",
      paymentAmount: "0.1",
      paymentTarget: {
        version: 1,
        railId: "evm",
        asset: "eth",
        destination: "0x1111111111111111111111111111111111111111",
        network: "ethereum"
      },
      durationHours: 24,
      metadata: {
        paymentSession: {
          proofMode: "client_tx_ref"
        }
      }
    });
    assert.equal(legacy.paymentRailId, "evm");
  } finally {
    if (previous === undefined) delete process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS;
    else process.env.DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS = previous;
  }
});

test("video package policy: normalize + metadata defaults", async () => {
  const { getVideoPurchasePolicyFromMetadata, getVideoPurchasePolicyLabel, normalizeVideoPurchasePolicy } = await import(
    "./videoPackagePolicy"
  );

  assert.equal(normalizeVideoPurchasePolicy("verified_only"), "verified_only");
  assert.equal(normalizeVideoPurchasePolicy("unverified_ok"), "unverified_ok");
  assert.equal(normalizeVideoPurchasePolicy(""), "verified_only");
  assert.equal(getVideoPurchasePolicyFromMetadata({ purchasePolicy: "verified_only" }), "verified_only");
  assert.equal(getVideoPurchasePolicyFromMetadata({}), "verified_only");
  assert.equal(getVideoPurchasePolicyLabel("verified_only"), "Verified settlement only");
});

test("video checkout helpers: verification labels + error normalization", async () => {
  const { formatVideoCheckoutVerificationMode, normalizeVideoPurchaseErrorMessage } = await import("./videoCheckout");
  assert.equal(formatVideoCheckoutVerificationMode("verified_settlement"), "verified settlement");
  assert.equal(formatVideoCheckoutVerificationMode("stake_verified"), "verified stake settlement");
  assert.equal(formatVideoCheckoutVerificationMode("operator_override"), "host operator confirmation");
  assert.equal(
    normalizeVideoPurchaseErrorMessage("This package requires verified settlement.", "verified_only"),
    "This package requires verified settlement. Use verified stake flow or host confirmation."
  );
  assert.equal(
    normalizeVideoPurchaseErrorMessage("verification failed", "operator_or_verified"),
    "Verification failed. Ask host operator to confirm purchase or complete verified settlement."
  );
});

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
