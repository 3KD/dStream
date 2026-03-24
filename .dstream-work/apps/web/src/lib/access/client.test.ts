import assert from "node:assert/strict";
import { test } from "node:test";
import type { NostrEvent } from "@dstream/protocol";
import {
  buildAccessAdminProof,
  buildAccessProof,
  buildAccessPurchaseProof,
  buildAccessViewerProof,
  deleteVodCatalogEntryClient,
  disableVodAccessPackageClient,
  grantAccessEntitlementClient,
  listAccessAuditClient,
  listAccessDenyRulesClient,
  listAccessEntitlementsClient,
  listVodCatalogEntriesClient,
  listVodAccessPackagesClient,
  processVodCatalogHostEntriesClient,
  listVodPackageViewerStatusClient,
  listVodPlaylistCatalogClient,
  purchaseVodAccessPackageClient,
  revokeAccessEntitlementClient,
  upsertVodCatalogEntryClient,
  upsertAccessDenyRuleClient,
  upsertVodAccessPackageClient
} from "./client";

const now = Math.floor(Date.now() / 1000);
const sampleHost = "a".repeat(64);
const sampleViewer = "b".repeat(64);
const sampleProofEvent: NostrEvent = {
  id: "1".repeat(64),
  sig: "2".repeat(128),
  kind: 27235,
  pubkey: sampleHost,
  created_at: now,
  tags: [
    ["dstream", "access_admin"],
    ["exp", String(now + 300)]
  ],
  content: ""
};

const samplePackage = {
  id: "pkg-1",
  hostPubkey: sampleHost,
  streamId: "stream-1",
  resourceId: `stream:${sampleHost}:stream-1:vod:*`,
  title: "Package",
  paymentAsset: "xmr",
  paymentAmount: "0.10",
  durationHours: 24,
  status: "active",
  visibility: "public",
  metadata: {},
  createdAtSec: now,
  updatedAtSec: now
};

const sampleEntitlement = {
  id: "ent-1",
  hostPubkey: sampleHost,
  subjectPubkey: sampleViewer,
  resourceId: `stream:${sampleHost}:stream-1:vod:*`,
  actions: ["watch_vod"],
  source: "purchase_verified",
  status: "active",
  startsAtSec: now,
  metadata: {},
  createdAtSec: now,
  updatedAtSec: now
};

const sampleDenyRule = {
  id: "deny-1",
  hostPubkey: sampleHost,
  subjectPubkey: sampleViewer,
  resourceId: `stream:${sampleHost}:stream-1:live`,
  actions: ["watch_live"],
  startsAtSec: now,
  createdAtSec: now,
  updatedAtSec: now
};

const sampleAudit = {
  id: "audit-1",
  atSec: now,
  hostPubkey: sampleHost,
  subjectPubkey: sampleViewer,
  resourceId: `stream:${sampleHost}:stream-1:live`,
  action: "watch_live",
  allowed: true,
  reasonCode: "allow_public",
  metadata: {}
};

const sampleVodCatalogEntry = {
  id: "vod-entry-1",
  originStreamId: `${sampleHost}--stream-1`,
  hostPubkey: sampleHost,
  streamId: "stream-1",
  relativePath: "season-1/episode-1.mp4",
  title: "Episode 1",
  description: "Pilot",
  playlistId: "season-1",
  visibility: "public",
  thumbnailUrl: "https://cdn.example.com/thumbs/ep1.jpg",
  tags: ["pilot"],
  publishedAtSec: now,
  createdAtSec: now,
  updatedAtSec: now
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("access client: proof builders produce expected tags", async () => {
  const signer = async (event: Omit<NostrEvent, "id" | "sig">): Promise<NostrEvent> => ({
    ...event,
    id: "f".repeat(64),
    sig: "e".repeat(128)
  });

  const adminProof = await buildAccessAdminProof(signer, sampleHost, sampleHost, 120);
  assert.ok(adminProof);
  if (!adminProof) return;
  assert.equal(adminProof.kind, 27235);
  assert.equal(adminProof.tags.some((tag) => tag[0] === "dstream" && tag[1] === "access_admin"), true);
  assert.equal(adminProof.tags.some((tag) => tag[0] === "host" && tag[1] === sampleHost), true);

  const purchaseProof = await buildAccessPurchaseProof(signer, sampleViewer, { hostPubkey: sampleHost, packageId: "pkg-1", ttlSec: 300 });
  assert.ok(purchaseProof);
  if (!purchaseProof) return;
  assert.equal(purchaseProof.tags.some((tag) => tag[0] === "dstream" && tag[1] === "access_purchase"), true);
  assert.equal(purchaseProof.tags.some((tag) => tag[0] === "pkg" && tag[1] === "pkg-1"), true);

  const viewerProof = await buildAccessViewerProof(signer, sampleViewer, sampleHost, 300);
  assert.ok(viewerProof);
  if (!viewerProof) return;
  assert.equal(viewerProof.tags.some((tag) => tag[0] === "dstream" && tag[1] === "access_viewer"), true);
  assert.equal(viewerProof.tags.some((tag) => tag[0] === "host" && tag[1] === sampleHost), true);

  const genericProof = await buildAccessProof(undefined, sampleHost, { scope: "access_admin" });
  assert.equal(genericProof, null);
});

test("access client: API wrappers parse success responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith(`/api/vod/catalog/${encodeURIComponent(sampleHost)}/`)) {
      if (url.endsWith("/entries/process")) {
        return jsonResponse({
          ok: true,
          hostPubkey: sampleHost,
          actorPubkey: sampleHost,
          scanned: 2,
          processed: 2,
          ready: 2,
          failed: 0,
          skipped: 0,
          streamCount: 1,
          streams: [
            {
              originStreamId: `${sampleHost}--stream-1`,
              scanned: 2,
              processed: 2,
              ready: 2,
              failed: 0,
              skipped: 0,
              errors: []
            }
          ],
          errors: []
        });
      }
      if (url.includes("/entries/list")) {
        return jsonResponse({
          ok: true,
          rows: [
            {
              relativePath: "season-1/episode-1.mp4",
              fileName: "episode-1.mp4",
              fileSizeBytes: 1024,
              fileModifiedAtMs: now * 1000,
              fileUrl: `/api/vod/file/${sampleHost}--stream-1/season-1/episode-1.mp4`,
              metadata: sampleVodCatalogEntry
            }
          ],
          count: 1,
          originStreamId: `${sampleHost}--stream-1`,
          actorPubkey: sampleHost,
          isAdmin: true
        });
      }
      if (url.includes("/entries/upsert")) {
        return jsonResponse({
          ok: true,
          entry: sampleVodCatalogEntry,
          originStreamId: `${sampleHost}--stream-1`,
          actorPubkey: sampleHost
        });
      }
      if (url.includes("/entries/delete")) {
        return jsonResponse({
          ok: true,
          relativePath: "season-1/episode-1.mp4",
          originStreamId: `${sampleHost}--stream-1`,
          actorPubkey: sampleHost
        });
      }
      return jsonResponse({
        ok: true,
        playlists: [{ id: "__root__", fileCount: 2, latestModifiedAtMs: now * 1000 }],
        fileCount: 2,
        originStreamId: `${sampleHost}--stream-1`,
        actorPubkey: sampleHost
      });
    }
    if (url === "/api/access/vod-packages/list") {
      return jsonResponse({
        ok: true,
        packages: [samplePackage],
        count: 1,
        actorPubkey: sampleHost,
        purchaseStatsByPackageId: {
          "pkg-1": {
            packageId: "pkg-1",
            totalPurchases: 3,
            grantedPurchases: 2,
            existingPurchases: 1,
            verifiedPurchases: 2,
            unverifiedPurchases: 1,
            operatorOverridePurchases: 1,
            unverifiedFallbackPurchases: 1,
            uniqueViewerCount: 2,
            latestPurchaseAtSec: now,
            latestGrantedAtSec: now
          }
        }
      });
    }
    if (url === "/api/access/vod-packages/upsert") {
      return jsonResponse({ ok: true, package: samplePackage, actorPubkey: sampleHost });
    }
    if (url === "/api/access/vod-packages/delete") {
      return jsonResponse({ ok: true, package: { ...samplePackage, status: "disabled" }, actorPubkey: sampleHost });
    }
    if (url === "/api/access/vod-packages/purchase") {
      return jsonResponse({
        ok: true,
        package: samplePackage,
        entitlement: sampleEntitlement,
        purchase: {
          id: "purchase-1",
          source: "purchase_verified",
          sourceRef: "ref-1",
          status: "granted",
          expiresAtSec: now + 3600
        },
        checkout: {
          purchasePolicy: "operator_or_verified",
          verificationMode: "external_verified"
        },
        granted: true,
        actorPubkey: sampleViewer
      });
    }
    if (url === "/api/access/vod-packages/viewer-status") {
      return jsonResponse({
        ok: true,
        hostPubkey: sampleHost,
        streamId: "stream-1",
        viewerPubkey: sampleViewer,
        unlocks: [
          {
            entitlementId: "ent-1",
            packageId: "pkg-1",
            resourceId: `stream:${sampleHost}:stream-1:vod:*`,
            status: "active",
            source: "purchase_verified",
            startsAtSec: now,
            expiresAtSec: now + 3600,
            updatedAtSec: now
          }
        ],
        byPackageId: {
          "pkg-1": {
            entitlementId: "ent-1",
            resourceId: `stream:${sampleHost}:stream-1:vod:*`,
            status: "active",
            source: "purchase_verified",
            startsAtSec: now,
            expiresAtSec: now + 3600,
            updatedAtSec: now
          }
        },
        count: 1
      });
    }
    if (url === "/api/access/entitlements/list") {
      return jsonResponse({ ok: true, entitlements: [sampleEntitlement], count: 1, actorPubkey: sampleHost });
    }
    if (url === "/api/access/entitlements/grant") {
      return jsonResponse({ ok: true, entitlement: sampleEntitlement, actorPubkey: sampleHost });
    }
    if (url === "/api/access/entitlements/revoke") {
      return jsonResponse({
        ok: true,
        entitlement: { ...sampleEntitlement, status: "revoked", revokedAtSec: now + 1 },
        actorPubkey: sampleHost
      });
    }
    if (url === "/api/access/denies/list") {
      return jsonResponse({ ok: true, denyRules: [sampleDenyRule], count: 1, actorPubkey: sampleHost });
    }
    if (url === "/api/access/denies/upsert") {
      return jsonResponse({ ok: true, denyRule: sampleDenyRule, actorPubkey: sampleHost });
    }
    if (url === "/api/access/audit") {
      return jsonResponse({ ok: true, audit: [sampleAudit], count: 1, actorPubkey: sampleHost });
    }
    return jsonResponse({ ok: false, error: `unhandled url: ${url}` }, 500);
  }) as typeof fetch;

  try {
    const catalog = await listVodPlaylistCatalogClient({
      hostPubkey: sampleHost,
      streamId: "stream-1",
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(catalog.playlists.length, 1);
    assert.equal(catalog.originStreamId, `${sampleHost}--stream-1`);

    const catalogEntries = await listVodCatalogEntriesClient({
      hostPubkey: sampleHost,
      streamId: "stream-1",
      operatorProofEvent: sampleProofEvent,
      adminRows: true
    });
    assert.equal(catalogEntries.rows.length, 1);
    assert.equal(catalogEntries.rows[0]?.metadata?.title, "Episode 1");

    const hostProcess = await processVodCatalogHostEntriesClient({
      hostPubkey: sampleHost,
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(hostProcess.processed, 2);
    assert.equal(hostProcess.streamCount, 1);

    const upsertedEntry = await upsertVodCatalogEntryClient({
      hostPubkey: sampleHost,
      streamId: "stream-1",
      relativePath: "season-1/episode-1.mp4",
      title: "Episode 1",
      operatorProofEvent: sampleProofEvent,
      published: true
    });
    assert.equal(upsertedEntry.entry.id, "vod-entry-1");

    const deletedEntry = await deleteVodCatalogEntryClient({
      hostPubkey: sampleHost,
      streamId: "stream-1",
      relativePath: "season-1/episode-1.mp4",
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(deletedEntry.relativePath, "season-1/episode-1.mp4");

    const listedPackages = await listVodAccessPackagesClient({ hostPubkey: sampleHost, operatorProofEvent: sampleProofEvent });
    assert.equal(listedPackages.packages.length, 1);
    assert.equal(listedPackages.purchaseStatsByPackageId["pkg-1"]?.totalPurchases, 3);

    const upserted = await upsertVodAccessPackageClient({
      hostPubkey: sampleHost,
      streamId: "stream-1",
      title: "Package",
      paymentAsset: "xmr",
      paymentAmount: "0.10",
      durationHours: 24,
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(upserted.package.id, "pkg-1");

    const disabled = await disableVodAccessPackageClient({
      hostPubkey: sampleHost,
      packageId: "pkg-1",
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(disabled.package.status, "disabled");

    const purchase = await purchaseVodAccessPackageClient({
      packageId: "pkg-1",
      buyerProofEvent: sampleProofEvent
    });
    assert.equal(purchase.granted, true);
    assert.equal(purchase.checkout?.purchasePolicy, "operator_or_verified");
    assert.equal(purchase.checkout?.verificationMode, "external_verified");

    const viewerStatus = await listVodPackageViewerStatusClient({
      hostPubkey: sampleHost,
      streamId: "stream-1",
      viewerProofEvent: sampleProofEvent
    });
    assert.equal(viewerStatus.unlocks.length, 1);
    assert.equal(viewerStatus.byPackageId["pkg-1"]?.packageId, "pkg-1");

    const entitlements = await listAccessEntitlementsClient({
      hostPubkey: sampleHost,
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(entitlements.entitlements.length, 1);

    const granted = await grantAccessEntitlementClient({
      hostPubkey: sampleHost,
      subjectPubkey: sampleViewer,
      resourceId: `stream:${sampleHost}:stream-1:live`,
      actions: ["watch_live"],
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(granted.entitlement.id, "ent-1");

    const revoked = await revokeAccessEntitlementClient({
      entitlementId: "ent-1",
      hostPubkey: sampleHost,
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(revoked.entitlement.status, "revoked");

    const denyRules = await listAccessDenyRulesClient({
      hostPubkey: sampleHost,
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(denyRules.denyRules.length, 1);

    const upsertedDeny = await upsertAccessDenyRuleClient({
      hostPubkey: sampleHost,
      subjectPubkey: sampleViewer,
      resourceId: `stream:${sampleHost}:stream-1:live`,
      actions: ["watch_live"],
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(upsertedDeny.denyRule.id, "deny-1");

    const audit = await listAccessAuditClient({
      hostPubkey: sampleHost,
      operatorProofEvent: sampleProofEvent
    });
    assert.equal(audit.audit.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("access client: wrappers surface API errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => jsonResponse({ ok: false, error: "expected failure" }, 400)) as typeof fetch;
  try {
    await assert.rejects(
      () => listVodAccessPackagesClient({ hostPubkey: sampleHost, operatorProofEvent: sampleProofEvent }),
      /expected failure/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
