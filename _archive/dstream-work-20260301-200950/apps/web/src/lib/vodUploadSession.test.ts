import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  abortVodUploadSession,
  appendVodUploadSessionChunk,
  cleanupExpiredVodUploadSessions,
  completeVodUploadSession,
  resolveHostAndOrigin,
  startVodUploadSession
} from "./vodUploadSession";
import { getVodCatalogEntry } from "./vodCatalog";

const hostPubkey = "a".repeat(64);
const streamId = "vod-upload-session-test";

function setup(): { tmpDir: string; cleanup: () => void } {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dstream-vod-upload-session-"));
  const recordingsDir = path.join(tmpDir, "recordings");
  const sessionsDir = path.join(tmpDir, "sessions");
  mkdirSync(recordingsDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });

  process.env.DSTREAM_VOD_DIR = recordingsDir;
  process.env.DSTREAM_VOD_CATALOG_STORE_PATH = path.join(tmpDir, "vod-catalog.json");
  process.env.DSTREAM_VOD_UPLOAD_SESSION_DIR = sessionsDir;

  return {
    tmpDir,
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true })
  };
}

test("vod upload session: chunked upload completes and writes catalog metadata", async () => {
  const { tmpDir, cleanup } = setup();
  try {
    const resolved = resolveHostAndOrigin(hostPubkey, streamId);
    const payload = Buffer.from("dstream-vod-upload-session-content");

    const started = await startVodUploadSession({
      hostPubkey: resolved.hostPubkey,
      streamId: resolved.streamId,
      originStreamId: resolved.originStreamId,
      fileName: "episode-1.mp4",
      fileSizeBytes: payload.byteLength,
      playlistId: "season-1",
      title: "Episode 1",
      processingState: "queued"
    });

    await appendVodUploadSessionChunk({
      uploadId: started.session.uploadId,
      uploadToken: started.session.uploadToken,
      offset: 0,
      bytes: payload.subarray(0, 8)
    });
    await appendVodUploadSessionChunk({
      uploadId: started.session.uploadId,
      uploadToken: started.session.uploadToken,
      offset: 8,
      bytes: payload.subarray(8)
    });

    const completed = await completeVodUploadSession({
      uploadId: started.session.uploadId,
      uploadToken: started.session.uploadToken
    });
    assert.equal(completed.originStreamId, resolved.originStreamId);
    assert.equal(completed.relativePath, "season-1/episode-1.mp4");

    const absolutePath = path.join(tmpDir, "recordings", resolved.originStreamId, completed.relativePath);
    assert.equal(existsSync(absolutePath), true);
    assert.deepEqual(readFileSync(absolutePath), payload);

    const catalogEntry = getVodCatalogEntry(resolved.originStreamId, completed.relativePath);
    assert.ok(catalogEntry);
    assert.equal(catalogEntry?.title, "Episode 1");
    assert.equal(catalogEntry?.processingState, "queued");
    assert.equal(catalogEntry?.playlistId, "season-1");
  } finally {
    cleanup();
  }
});

test("vod upload session: abort removes in-progress artifacts", async () => {
  const { tmpDir, cleanup } = setup();
  try {
    const resolved = resolveHostAndOrigin(hostPubkey, streamId);
    const started = await startVodUploadSession({
      hostPubkey: resolved.hostPubkey,
      streamId: resolved.streamId,
      originStreamId: resolved.originStreamId,
      fileName: "episode-2.mp4",
      fileSizeBytes: 10
    });

    await appendVodUploadSessionChunk({
      uploadId: started.session.uploadId,
      uploadToken: started.session.uploadToken,
      offset: 0,
      bytes: Buffer.from("12345")
    });

    const metaPath = path.join(tmpDir, "sessions", `${started.session.uploadId}.json`);
    const partPath = path.join(tmpDir, "sessions", `${started.session.uploadId}.part`);
    assert.equal(existsSync(metaPath), true);
    assert.equal(existsSync(partPath), true);

    await abortVodUploadSession({
      uploadId: started.session.uploadId,
      uploadToken: started.session.uploadToken
    });

    assert.equal(existsSync(metaPath), false);
    assert.equal(existsSync(partPath), false);
  } finally {
    cleanup();
  }
});

test("vod upload session: cleanup removes expired session artifacts", async () => {
  const { tmpDir, cleanup } = setup();
  try {
    const expiredUploadId = "expired-upload-id";
    const sessionsDir = path.join(tmpDir, "sessions");
    const metaPath = path.join(sessionsDir, `${expiredUploadId}.json`);
    const partPath = path.join(sessionsDir, `${expiredUploadId}.part`);

    const expiredMeta = {
      uploadId: expiredUploadId,
      uploadToken: "token",
      hostPubkey,
      streamId,
      originStreamId: `${hostPubkey}--${streamId}`,
      fileName: "expired.mp4",
      fileSizeBytes: 10,
      receivedBytes: 5,
      visibility: "public",
      processingState: "queued",
      published: true,
      tags: [],
      createdAtSec: 1,
      updatedAtSec: 2,
      expiresAtSec: 2
    };

    writeFileSync(metaPath, `${JSON.stringify(expiredMeta)}\n`, "utf8");
    writeFileSync(partPath, "12345", "utf8");

    const result = await cleanupExpiredVodUploadSessions(20);
    assert.ok(result.scanned >= 1);
    assert.equal(result.removed, 1);
    assert.equal(existsSync(metaPath), false);
    assert.equal(existsSync(partPath), false);
  } finally {
    cleanup();
  }
});
