import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { getVodCatalogEntry, upsertVodCatalogEntry } from "./vodCatalog";
import {
  processVodCatalogEntries,
  processVodCatalogEntriesForHost,
  syncVodCatalogEntriesFromFilesystem
} from "./vodProcessing";

const hostPubkey = "b".repeat(64);
const streamId = "vod-processing-test";
const originStreamId = `${hostPubkey}--${streamId}`;

function setup(): { recordingsDir: string; cleanup: () => void } {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dstream-vod-processing-"));
  const recordingsDir = path.join(tmpDir, "recordings");
  mkdirSync(path.join(recordingsDir, originStreamId), { recursive: true });

  process.env.DSTREAM_VOD_DIR = recordingsDir;
  process.env.DSTREAM_VOD_CATALOG_STORE_PATH = path.join(tmpDir, "vod-catalog.json");

  return {
    recordingsDir,
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true })
  };
}

test("vod processing: marks queued entries ready/failed based on file presence", async () => {
  const { recordingsDir, cleanup } = setup();
  try {
    const existingPath = path.join(recordingsDir, originStreamId, "season-1", "episode-1.mp4");
    mkdirSync(path.dirname(existingPath), { recursive: true });
    writeFileSync(existingPath, "vod-processing-test");

    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "season-1/episode-1.mp4",
      title: "Episode 1",
      processingState: "queued",
      published: true
    });
    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "season-1/missing.mp4",
      title: "Missing episode",
      processingState: "queued",
      published: true
    });

    const result = await processVodCatalogEntries({ originStreamId, limit: 20 });
    assert.equal(result.processed, 2);
    assert.equal(result.ready, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.errors.length, 1);

    const readyEntry = getVodCatalogEntry(originStreamId, "season-1/episode-1.mp4");
    const failedEntry = getVodCatalogEntry(originStreamId, "season-1/missing.mp4");
    assert.equal(readyEntry?.processingState, "ready");
    assert.equal(failedEntry?.processingState, "failed");
    assert.ok(failedEntry?.processingError);
  } finally {
    cleanup();
  }
});

test("vod processing: processes all queued entries for a host across streams", async () => {
  const { recordingsDir, cleanup } = setup();
  try {
    const sameHostStreamB = `${hostPubkey}--vod-processing-other`;
    const otherHostStream = `${"c".repeat(64)}--vod-processing-foreign`;

    const existingA = path.join(recordingsDir, originStreamId, "season-1", "episode-1.mp4");
    mkdirSync(path.dirname(existingA), { recursive: true });
    writeFileSync(existingA, "ready-a");

    const existingB = path.join(recordingsDir, sameHostStreamB, "season-2", "episode-3.mp4");
    mkdirSync(path.dirname(existingB), { recursive: true });
    writeFileSync(existingB, "ready-b");

    upsertVodCatalogEntry({
      originStreamId,
      relativePath: "season-1/episode-1.mp4",
      title: "Episode 1",
      processingState: "queued",
      published: true
    });
    upsertVodCatalogEntry({
      originStreamId: sameHostStreamB,
      relativePath: "season-2/episode-3.mp4",
      title: "Episode 3",
      processingState: "queued",
      published: true
    });
    upsertVodCatalogEntry({
      originStreamId: otherHostStream,
      relativePath: "season-x/episode-x.mp4",
      title: "Foreign Episode",
      processingState: "queued",
      published: true
    });

    const result = await processVodCatalogEntriesForHost({
      hostPubkey,
      limit: 10
    });
    assert.equal(result.streamCount, 2);
    assert.equal(result.processed, 2);
    assert.equal(result.ready, 2);
    assert.equal(result.failed, 0);

    const hostAEntry = getVodCatalogEntry(originStreamId, "season-1/episode-1.mp4");
    const hostBEntry = getVodCatalogEntry(sameHostStreamB, "season-2/episode-3.mp4");
    const foreignEntry = getVodCatalogEntry(otherHostStream, "season-x/episode-x.mp4");

    assert.equal(hostAEntry?.processingState, "ready");
    assert.equal(hostBEntry?.processingState, "ready");
    assert.equal(foreignEntry?.processingState, "queued");
  } finally {
    cleanup();
  }
});

test("vod processing: sync catalogs uncataloged recording files", async () => {
  const { recordingsDir, cleanup } = setup();
  try {
    const rootFilePath = path.join(recordingsDir, originStreamId, "episode-root.mp4");
    const nestedFilePath = path.join(recordingsDir, originStreamId, "season-1", "episode-2.mp4");
    mkdirSync(path.dirname(rootFilePath), { recursive: true });
    mkdirSync(path.dirname(nestedFilePath), { recursive: true });
    writeFileSync(rootFilePath, "root");
    writeFileSync(nestedFilePath, "nested");

    const syncResult = await syncVodCatalogEntriesFromFilesystem({
      originStreamId,
      onlyMissing: true,
      processingState: "ready",
      published: true
    });
    assert.equal(syncResult.created, 2);
    assert.equal(syncResult.updated, 0);
    assert.equal(syncResult.skipped, 0);

    const rootEntry = getVodCatalogEntry(originStreamId, "episode-root.mp4");
    const nestedEntry = getVodCatalogEntry(originStreamId, "season-1/episode-2.mp4");
    assert.ok(rootEntry);
    assert.ok(nestedEntry);
    assert.equal(rootEntry?.playlistId, undefined);
    assert.equal(nestedEntry?.playlistId, "season-1");
    assert.equal(rootEntry?.processingState, "ready");
    assert.equal(nestedEntry?.processingState, "ready");
    assert.ok(rootEntry?.publishedAtSec);
    assert.ok(nestedEntry?.publishedAtSec);

    const secondSync = await syncVodCatalogEntriesFromFilesystem({
      originStreamId,
      onlyMissing: true
    });
    assert.equal(secondSync.created, 0);
    assert.equal(secondSync.skipped, 2);
  } finally {
    cleanup();
  }
});
