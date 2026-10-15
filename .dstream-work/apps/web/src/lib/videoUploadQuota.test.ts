import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { reserveUploadCapacity, releaseUploadCapacity } from "./videoUploadQuota";

const dir = mkdtempSync(join(tmpdir(), "dstream-upload-quota-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("upload reservation enforces aggregate quota and releases completed capacity", async () => {
  process.env.DSTREAM_VIDEO_DIR = dir;
  process.env.DSTREAM_VIDEO_UPLOAD_MAX_RESERVED_BYTES = "16";
  const expires = Math.floor(Date.now() / 1000) + 60;
  await reserveUploadCapacity(dir, "one", "host", 10, expires);
  await assert.rejects(reserveUploadCapacity(dir, "two", "other-host", 10, expires), /capacity is exhausted/);
  releaseUploadCapacity(dir, "one");
  await reserveUploadCapacity(dir, "two", "other-host", 10, expires);
});

test("uploads fail before allocation when recording storage is unavailable", async () => {
  process.env.DSTREAM_VIDEO_DIR = join(dir, "not-configured");
  await assert.rejects(reserveUploadCapacity(dir, "unavailable", "host", 1, Math.floor(Date.now() / 1000) + 60), /writable recording storage/);
});
