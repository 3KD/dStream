import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { reserveUploadCapacity, releaseUploadCapacity } from "./videoUploadQuota";

const dir = mkdtempSync(join(tmpdir(), "dstream-upload-quota-"));
const previousEnv = Object.fromEntries(["DSTREAM_VIDEO_DIR", "DSTREAM_VIDEO_UPLOAD_MAX_RESERVED_BYTES", "DSTREAM_VIDEO_UPLOAD_MIN_FREE_BYTES"].map((key) => [key, process.env[key]]));
after(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("upload reservation enforces aggregate quota and releases completed capacity", async () => {
  process.env.DSTREAM_VIDEO_DIR = dir;
  process.env.DSTREAM_VIDEO_UPLOAD_MAX_RESERVED_BYTES = "16";
  process.env.DSTREAM_VIDEO_UPLOAD_MIN_FREE_BYTES = "0";
  const expires = Math.floor(Date.now() / 1000) + 60;
  await reserveUploadCapacity(dir, "one", "host", 10, expires);
  await assert.rejects(reserveUploadCapacity(dir, "two", "other-host", 10, expires), /capacity is exhausted/);
  releaseUploadCapacity(dir, "one");
  await reserveUploadCapacity(dir, "two", "other-host", 10, expires);
});

test("uploads preserve configured free-disk headroom independently of the reservation budget", async () => {
  process.env.DSTREAM_VIDEO_DIR = dir;
  process.env.DSTREAM_VIDEO_UPLOAD_MAX_RESERVED_BYTES = "16";
  process.env.DSTREAM_VIDEO_UPLOAD_MIN_FREE_BYTES = String(Number.MAX_SAFE_INTEGER);
  await assert.rejects(reserveUploadCapacity(dir, "headroom", "host", 1, Math.floor(Date.now() / 1000) + 60), /capacity is exhausted/);
  await assert.rejects(reserveUploadCapacity(dir, "two", "other-host", 10, Math.floor(Date.now() / 1000) + 60), /capacity is exhausted/);
});

test("uploads fail before allocation when recording storage is unavailable", async () => {
  process.env.DSTREAM_VIDEO_DIR = join(dir, "not-configured");
  await assert.rejects(reserveUploadCapacity(dir, "unavailable", "host", 1, Math.floor(Date.now() / 1000) + 60), /writable recording storage/);
});
