import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { issueMediaServiceCredential, verifyMediaServiceCredential, mediaServiceReadHeaders, mediaServicePublishUrl } from "./media-auth.mjs";

test("media service credentials separate read roles from rendition-only publishing", () => {
  const path = `${"a".repeat(64)}--fixture`, rendition = `${path}__r360p`;
  const secrets = { manifest: "manifest-fixture-0123456789abcdef012345", transcoder: "transcode-fixture-0123456789abcdef012345" };
  const read = issueMediaServiceCredential(secrets.manifest, "manifest", path, "read");
  assert(verifyMediaServiceCredential(read, path, "read", secrets));
  assert(!verifyMediaServiceCredential(read, path, "publish", secrets));
  assert(!verifyMediaServiceCredential(read, `${path}x`, "read", secrets));
  assert(!verifyMediaServiceCredential(`${read}x`, path, "read", secrets));
  assert(!verifyMediaServiceCredential(read, path, "read", { manifest: secrets.transcoder }));
  assert.throws(() => issueMediaServiceCredential(secrets.manifest, "manifest", rendition, "publish"));
  assert.throws(() => issueMediaServiceCredential(secrets.transcoder, "transcoder", path, "publish"));
  const publish = issueMediaServiceCredential(secrets.transcoder, "transcoder", rendition, "publish");
  assert(verifyMediaServiceCredential(publish, rendition, "publish", secrets));
  const expired = Buffer.from(JSON.stringify({ role: "manifest", path, action: "read", expiresAt: 1 })).toString("base64url");
  assert(!verifyMediaServiceCredential(`${expired}.${createHmac("sha256", secrets.manifest).update(`dstream-media-service-v1:${expired}`).digest("base64url")}`, path, "read", secrets));
});

test("service clients attach HTTP read credentials and RTMP rendition credentials without exposing master secrets", () => {
  const previous = { secret: process.env.DSTREAM_MEDIA_SERVICE_SECRET, role: process.env.DSTREAM_MEDIA_SERVICE_ROLE };
  try {
    process.env.DSTREAM_MEDIA_SERVICE_SECRET = "transcode-fixture-0123456789abcdef012345";
    process.env.DSTREAM_MEDIA_SERVICE_ROLE = "transcoder";
    const path = `${"b".repeat(64)}--fixture`;
    const headers = mediaServiceReadHeaders(`http://media/${path}/index.m3u8`);
    assert(headers.authorization.startsWith("Bearer "));
    const target = new URL(mediaServicePublishUrl(`rtmp://media/${path}__r360p`));
    assert(verifyMediaServiceCredential(target.searchParams.get("pipeline"), `${path}__r360p`, "publish", { transcoder: process.env.DSTREAM_MEDIA_SERVICE_SECRET }));
    assert(!target.href.includes(process.env.DSTREAM_MEDIA_SERVICE_SECRET));
  } finally {
    for (const [key, value] of [["DSTREAM_MEDIA_SERVICE_SECRET", previous.secret], ["DSTREAM_MEDIA_SERVICE_ROLE", previous.role]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
