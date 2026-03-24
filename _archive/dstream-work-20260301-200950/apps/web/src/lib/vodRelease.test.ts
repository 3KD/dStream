import assert from "node:assert/strict";
import { test } from "node:test";
import type { VodAccessPackage } from "./access/client";
import type { AccessEntitlement } from "./access/types";
import {
  buildVodEntitlementCoverage,
  buildVodPricingCoverage,
  inferVodReleasePlaylistKeyFromRelativePath,
  normalizeVodReleasePlaylistKey,
  summarizeVodRelease,
  type VodReleaseEntryInput
} from "./vodRelease";

function packageRow(input: Partial<VodAccessPackage> & Pick<VodAccessPackage, "id">): VodAccessPackage {
  return {
    id: input.id,
    hostPubkey: input.hostPubkey ?? "a".repeat(64),
    streamId: input.streamId ?? "stream-main",
    resourceId: input.resourceId ?? `stream:${"a".repeat(64)}:stream-main:vod:*`,
    title: input.title ?? input.id,
    paymentAsset: input.paymentAsset ?? "xmr",
    paymentAmount: input.paymentAmount ?? "0.1",
    durationHours: input.durationHours ?? 24,
    status: input.status ?? "active",
    visibility: input.visibility ?? "public",
    metadata: input.metadata ?? {},
    createdAtSec: input.createdAtSec ?? 1,
    updatedAtSec: input.updatedAtSec ?? 1,
    description: input.description,
    paymentRailId: input.paymentRailId,
    playlistId: input.playlistId,
    relativePath: input.relativePath
  };
}

function entitlementRow(input: Partial<AccessEntitlement> & Pick<AccessEntitlement, "id" | "resourceId">): AccessEntitlement {
  return {
    id: input.id,
    hostPubkey: input.hostPubkey ?? "a".repeat(64),
    subjectPubkey: input.subjectPubkey ?? "b".repeat(64),
    resourceId: input.resourceId,
    actions: input.actions ?? ["watch_vod"],
    source: input.source ?? "purchase_verified",
    sourceRef: input.sourceRef,
    status: input.status ?? "active",
    startsAtSec: input.startsAtSec ?? 1,
    expiresAtSec: input.expiresAtSec,
    revokedAtSec: input.revokedAtSec,
    revokeReason: input.revokeReason,
    metadata: input.metadata ?? {},
    createdAtSec: input.createdAtSec ?? 1,
    updatedAtSec: input.updatedAtSec ?? 1
  };
}

test("vod release: playlist key normalization and inference", () => {
  assert.equal(normalizeVodReleasePlaylistKey(""), "__root__");
  assert.equal(normalizeVodReleasePlaylistKey(" __root__ "), "__root__");
  assert.equal(normalizeVodReleasePlaylistKey("season-1"), "season-1");
  assert.equal(inferVodReleasePlaylistKeyFromRelativePath("season-1/ep-01.mp4"), "season-1");
  assert.equal(inferVodReleasePlaylistKeyFromRelativePath("ep-01.mp4"), "ep-01.mp4");
  assert.equal(inferVodReleasePlaylistKeyFromRelativePath(""), "__root__");
});

test("vod release: summary flags private published rows missing pricing", () => {
  const entries: VodReleaseEntryInput[] = [
    { relativePath: "season1/ep1.mp4", playlistId: "season1", visibility: "private", published: true },
    { relativePath: "season1/ep2.mp4", playlistId: "season1", visibility: "public", published: true },
    { relativePath: "teaser.mp4", visibility: "private", published: false }
  ];
  const coverage = buildVodPricingCoverage(entries, []);
  const summary = summarizeVodRelease(entries, coverage);
  assert.equal(summary.totalEntries, 3);
  assert.equal(summary.publishedEntries, 2);
  assert.equal(summary.privatePublishedEntries, 1);
  assert.equal(summary.privatePublishedCoveredEntries, 0);
  assert.equal(summary.privatePublishedMissingEntries, 1);
  assert.deepEqual(summary.privatePublishedMissingRelativePaths, ["season1/ep1.mp4"]);
});

test("vod release: playlist and stream packages provide coverage, disabled is ignored", () => {
  const entries: VodReleaseEntryInput[] = [
    { relativePath: "season1/ep1.mp4", playlistId: "season1", visibility: "private", published: true },
    { relativePath: "season2/ep2.mp4", playlistId: "season2", visibility: "private", published: true },
    { relativePath: "random.mp4", visibility: "private", published: true }
  ];
  const packages: VodAccessPackage[] = [
    packageRow({ id: "playlist-season1", playlistId: "season1", resourceId: `stream:${"a".repeat(64)}:stream-main:vod:season1:*` }),
    packageRow({ id: "stream-wide-disabled", status: "disabled" }),
    packageRow({ id: "stream-wide", status: "active" })
  ];
  const coverage = buildVodPricingCoverage(entries, packages);
  assert.equal(coverage["season1/ep1.mp4"]?.hasActiveCoverage, true);
  assert.equal(coverage["season2/ep2.mp4"]?.hasActiveCoverage, true);
  assert.equal(coverage["random.mp4"]?.hasActiveCoverage, true);
  assert.equal(coverage["season2/ep2.mp4"]?.matchingActivePackageIds.includes("stream-wide"), true);
  assert.equal(coverage["season2/ep2.mp4"]?.matchingActivePackageIds.includes("stream-wide-disabled"), false);

  const summary = summarizeVodRelease(entries, coverage);
  assert.equal(summary.privatePublishedMissingEntries, 0);
  assert.equal(summary.privatePublishedCoveredEntries, 3);
});

test("vod release: file scoped package only unlocks exact file", () => {
  const entries: VodReleaseEntryInput[] = [
    { relativePath: "season3/ep1.mp4", visibility: "private", published: true },
    { relativePath: "season3/ep2.mp4", visibility: "private", published: true }
  ];
  const packages: VodAccessPackage[] = [
    packageRow({
      id: "file-ep1",
      relativePath: "season3/ep1.mp4",
      resourceId: `stream:${"a".repeat(64)}:stream-main:vod:file:ep1`
    })
  ];
  const coverage = buildVodPricingCoverage(entries, packages);
  assert.equal(coverage["season3/ep1.mp4"]?.hasActiveCoverage, true);
  assert.equal(coverage["season3/ep2.mp4"]?.hasActiveCoverage, false);

  const summary = summarizeVodRelease(entries, coverage);
  assert.equal(summary.privatePublishedMissingEntries, 1);
  assert.deepEqual(summary.privatePublishedMissingRelativePaths, ["season3/ep2.mp4"]);
});

test("vod release: entitlement coverage maps stream + playlist + file scope", () => {
  const hostPubkey = "a".repeat(64);
  const streamId = "stream-main";
  const entries: VodReleaseEntryInput[] = [
    { relativePath: "season1/ep1.mp4", playlistId: "season1", visibility: "private", published: true },
    { relativePath: "season2/ep2.mp4", playlistId: "season2", visibility: "private", published: true }
  ];
  const coverage = buildVodEntitlementCoverage(
    entries,
    [
      entitlementRow({
        id: "stream-all",
        resourceId: `stream:${hostPubkey}:${streamId}:vod:*`,
        subjectPubkey: "1".repeat(64)
      }),
      entitlementRow({
        id: "playlist-season1",
        resourceId: `stream:${hostPubkey}:${streamId}:vod:season1:*`,
        subjectPubkey: "2".repeat(64)
      }),
      entitlementRow({
        id: "file-ep2",
        resourceId: `stream:${hostPubkey}:${streamId}:vod:file:${Buffer.from("season2/ep2.mp4", "utf8").toString("base64url")}`,
        subjectPubkey: "3".repeat(64)
      })
    ],
    { hostPubkey, streamId, nowSec: 100 }
  );

  assert.equal(coverage["season1/ep1.mp4"]?.hasActiveEntitlement, true);
  assert.equal(coverage["season1/ep1.mp4"]?.streamEntitlementCount, 1);
  assert.equal(coverage["season1/ep1.mp4"]?.playlistEntitlementCount, 1);
  assert.equal(coverage["season1/ep1.mp4"]?.fileEntitlementCount, 0);
  assert.equal(coverage["season2/ep2.mp4"]?.streamEntitlementCount, 1);
  assert.equal(coverage["season2/ep2.mp4"]?.playlistEntitlementCount, 0);
  assert.equal(coverage["season2/ep2.mp4"]?.fileEntitlementCount, 1);
});

test("vod release: entitlement coverage ignores inactive/non-watch_vod rows", () => {
  const hostPubkey = "a".repeat(64);
  const streamId = "stream-main";
  const entries: VodReleaseEntryInput[] = [{ relativePath: "ep.mp4", visibility: "private", published: true }];
  const coverage = buildVodEntitlementCoverage(
    entries,
    [
      entitlementRow({
        id: "wrong-action",
        resourceId: `stream:${hostPubkey}:${streamId}:vod:*`,
        actions: ["chat_send"]
      }),
      entitlementRow({
        id: "future",
        resourceId: `stream:${hostPubkey}:${streamId}:vod:*`,
        startsAtSec: 1000
      }),
      entitlementRow({
        id: "expired",
        resourceId: `stream:${hostPubkey}:${streamId}:vod:*`,
        expiresAtSec: 90
      }),
      entitlementRow({
        id: "revoked",
        resourceId: `stream:${hostPubkey}:${streamId}:vod:*`,
        status: "revoked"
      }),
      entitlementRow({
        id: "valid",
        resourceId: `stream:${hostPubkey}:${streamId}:vod:*`,
        actions: ["*"],
        subjectPubkey: "4".repeat(64)
      })
    ],
    { hostPubkey, streamId, nowSec: 100 }
  );

  assert.equal(coverage["ep.mp4"]?.matchingEntitlementIds.length, 1);
  assert.deepEqual(coverage["ep.mp4"]?.matchingEntitlementIds, ["valid"]);
  assert.deepEqual(coverage["ep.mp4"]?.uniqueSubjectPubkeys, ["4".repeat(64)]);
});
