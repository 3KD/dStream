import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import {
  deleteVodCatalogEntry,
  getVodCatalogEntry,
  listVodCatalogOriginStreamIds,
  listVodCatalogEntries,
  upsertVodCatalogEntry
} from "./vodCatalog";

function makeStorePath(prefix: string): { filePath: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    filePath: path.join(dir, "vod-catalog.json"),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

const hostPubkey = "a".repeat(64);
const streamId = "vod-catalog-test";
const originStreamId = `${hostPubkey}--${streamId}`;

test("vod catalog: upsert + get + delete lifecycle", () => {
  const { filePath, cleanup } = makeStorePath("dstream-vod-catalog-");
  process.env.DSTREAM_VOD_CATALOG_STORE_PATH = filePath;
  try {
    const created = upsertVodCatalogEntry({
      originStreamId,
      relativePath: "season-1/episode-1.mp4",
      title: "Episode 1",
      description: "Pilot",
      visibility: "public",
      tags: ["pilot", "Sci Fi"],
      published: true
    });
    assert.equal(created.title, "Episode 1");
    assert.equal(created.visibility, "public");
    assert.equal(created.relativePath, "season-1/episode-1.mp4");
    assert.ok(created.publishedAtSec);

    const loaded = getVodCatalogEntry(originStreamId, "season-1/episode-1.mp4");
    assert.ok(loaded);
    assert.equal(loaded?.description, "Pilot");
    assert.deepEqual(loaded?.tags, ["pilot", "sci-fi"]);

    const deleted = deleteVodCatalogEntry({
      originStreamId,
      relativePath: "season-1/episode-1.mp4"
    });
    assert.equal(deleted, true);
    const afterDelete = getVodCatalogEntry(originStreamId, "season-1/episode-1.mp4");
    assert.equal(afterDelete, null);
  } finally {
    cleanup();
  }
});

test("vod catalog: visibility and publish filters", () => {
  const { filePath, cleanup } = makeStorePath("dstream-vod-catalog-");
  process.env.DSTREAM_VOD_CATALOG_STORE_PATH = filePath;
  try {
    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "playlist-a/free.mp4",
      title: "Free",
      visibility: "public",
      playlistId: "playlist-a",
      published: true
    });
    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "playlist-a/unlisted.mp4",
      title: "Unlisted",
      visibility: "unlisted",
      playlistId: "playlist-a",
      published: true
    });
    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "playlist-b/private.mp4",
      title: "Private",
      visibility: "private",
      playlistId: "playlist-b",
      published: true
    });
    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "playlist-b/draft.mp4",
      title: "Draft",
      visibility: "public",
      playlistId: "playlist-b",
      published: false
    });

    const publicOnly = listVodCatalogEntries({ originStreamId });
    assert.equal(publicOnly.length, 1);
    assert.equal(publicOnly[0]?.title, "Free");

    const includeUnlisted = listVodCatalogEntries({ originStreamId, includeUnlisted: true });
    assert.equal(includeUnlisted.length, 2);

    const includePrivate = listVodCatalogEntries({
      originStreamId,
      includePrivate: true,
      includeUnlisted: true
    });
    assert.equal(includePrivate.length, 3);

    const includeDrafts = listVodCatalogEntries({
      originStreamId,
      includePrivate: true,
      includeUnlisted: true,
      includeUnpublished: true
    });
    assert.equal(includeDrafts.length, 4);

    const playlistA = listVodCatalogEntries({
      originStreamId,
      includeUnlisted: true,
      playlistId: "playlist-a"
    });
    assert.equal(playlistA.length, 2);
  } finally {
    cleanup();
  }
});

test("vod catalog: validates origin and relative path", () => {
  const { filePath, cleanup } = makeStorePath("dstream-vod-catalog-");
  process.env.DSTREAM_VOD_CATALOG_STORE_PATH = filePath;
  try {
    assert.throws(
      () =>
        upsertVodCatalogEntry({
          originStreamId: "invalid",
          relativePath: "episode.mp4",
          title: "Bad origin"
        }),
      /originStreamId is invalid/
    );
    assert.throws(
      () =>
        upsertVodCatalogEntry({
          originStreamId,
          relativePath: "../escape.mp4",
          title: "Bad path"
        }),
      /relativePath is invalid/
    );
  } finally {
    cleanup();
  }
});

test("vod catalog: playlist ordering by orderIndex", () => {
  const { filePath, cleanup } = makeStorePath("dstream-vod-catalog-");
  process.env.DSTREAM_VOD_CATALOG_STORE_PATH = filePath;
  try {
    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "playlist-c/episode-2.mp4",
      title: "Episode 2",
      playlistId: "playlist-c",
      orderIndex: 2,
      published: true
    });
    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "playlist-c/episode-1.mp4",
      title: "Episode 1",
      playlistId: "playlist-c",
      orderIndex: 1,
      published: true
    });
    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "playlist-c/episode-3.mp4",
      title: "Episode 3",
      playlistId: "playlist-c",
      published: true
    });

    const rows = listVodCatalogEntries({
      originStreamId,
      playlistId: "playlist-c",
      includeUnpublished: true,
      includePrivate: true,
      includeUnlisted: true
    });
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.title, "Episode 1");
    assert.equal(rows[1]?.title, "Episode 2");
  } finally {
    cleanup();
  }
});

test("vod catalog: lists distinct origin stream ids", () => {
  const { filePath, cleanup } = makeStorePath("dstream-vod-catalog-");
  process.env.DSTREAM_VOD_CATALOG_STORE_PATH = filePath;
  try {
    const otherHost = "d".repeat(64);
    const otherOriginStreamId = `${otherHost}--other-stream`;
    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "playlist-d/episode-1.mp4",
      title: "Episode 1",
      published: true
    });
    upsertVodCatalogEntry({
      originStreamId: otherOriginStreamId,
      relativePath: "playlist-z/episode-9.mp4",
      title: "Episode 9",
      published: true
    });

    const ids = listVodCatalogOriginStreamIds(20);
    assert.equal(ids.includes(originStreamId), true);
    assert.equal(ids.includes(otherOriginStreamId), true);
  } finally {
    cleanup();
  }
});
