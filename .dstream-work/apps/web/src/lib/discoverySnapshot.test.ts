import assert from "node:assert/strict";
import test from "node:test";
import type { StreamAnnounce } from "@dstream/protocol";
import {
  buildDiscoverySnapshotLiveKeys,
  isDiscoverySnapshotAuthoritative,
  reconcileStreamWithDiscoverySnapshot,
  shouldRefreshDiscoverySnapshot
} from "./discoverySnapshot";

const NOW_SEC = 2_000_000_000;

function stream(overrides: Partial<StreamAnnounce> = {}): StreamAnnounce {
  const pubkey = "a".repeat(64);
  const createdAt = overrides.createdAt ?? NOW_SEC - 60;
  return {
    pubkey,
    streamId: "gta-v-live",
    title: "GTA V",
    summary: "",
    image: "",
    streaming: "https://example.com/live.m3u8",
    status: "live",
    discoverable: true,
    matureContent: false,
    streamVisibility: "public",
    viewerAllowPubkeys: [],
    videoVisibility: "public",
    feeWaiverGuilds: [],
    feeWaiverVipPubkeys: [],
    payments: [],
    captions: [],
    renditions: [],
    topics: [],
    createdAt,
    raw: {
      pubkey,
      created_at: createdAt,
      kind: 30311,
      tags: [],
      content: ""
    },
    ...overrides,
    referenceUrls: overrides.referenceUrls ?? []
  };
}

test("a stale snapshot that omits a newer relay event cannot demote it", () => {
  const relayStream = stream({ createdAt: NOW_SEC - 60 });
  const result = reconcileStreamWithDiscoverySnapshot(
    relayStream,
    new Set(),
    NOW_SEC - 8 * 60,
    NOW_SEC
  );

  assert.equal(result.status, "live");
  assert.equal(result, relayStream);
});

test("even a fresh snapshot cannot demote a relay event newer than queriedAt", () => {
  const relayStream = stream({ createdAt: NOW_SEC - 10 });
  const result = reconcileStreamWithDiscoverySnapshot(relayStream, new Set(), NOW_SEC - 30, NOW_SEC);

  assert.equal(result.status, "live");
});

test("a genuinely fresh snapshot can mark an older omitted stream ended", () => {
  const relayStream = stream({ createdAt: NOW_SEC - 90 });
  const result = reconcileStreamWithDiscoverySnapshot(relayStream, new Set(), NOW_SEC - 15, NOW_SEC);

  assert.equal(result.status, "ended");
});

test("a fresh snapshot can restore a listed stream to live", () => {
  const endedStream = stream({ status: "ended", createdAt: NOW_SEC - 90 });
  const liveKeys = buildDiscoverySnapshotLiveKeys([stream({ createdAt: endedStream.createdAt })]);
  const result = reconcileStreamWithDiscoverySnapshot(endedStream, liveKeys, NOW_SEC - 15, NOW_SEC);

  assert.equal(result.status, "live");
});

test("snapshot refresh and authority use the payload query time", () => {
  assert.equal(shouldRefreshDiscoverySnapshot(NOW_SEC - 59, NOW_SEC), false);
  assert.equal(shouldRefreshDiscoverySnapshot(NOW_SEC - 60, NOW_SEC), true);
  assert.equal(isDiscoverySnapshotAuthoritative(NOW_SEC - 120, NOW_SEC), true);
  assert.equal(isDiscoverySnapshotAuthoritative(NOW_SEC - 121, NOW_SEC), false);
});
