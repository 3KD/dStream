import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools";
import { buildStreamAnnounceEvent, makeATag, parseStreamAnnounceEvent } from "@dstream/protocol";
import { issuePublishCredential } from "../mediaPublish";
import { verifyMediaServiceCredential } from "../../../../../services/media-auth.mjs";
import { manualThumbnailUrl, publicThumbnailUrl, StreamAnnounceSequence } from "../streamThumbnail";
import { registerPlaybackPolicyFromAnnounceEvent } from "../playback-access";
import { configureThumbnail, decodeThumbnail, ensureThumbnail, generateThumbnail, readThumbnail, thumbnailJpeg, thumbnailState, ThumbnailConflict } from "./streamThumbnail";
import { GET as settingsGet, POST, PUT } from "../../../app/api/broadcast/thumbnail/[originStreamId]/route";
import { GET as imageGet } from "../../../app/api/thumbnail/[originStreamId]/route";

const root = mkdtempSync(path.join(tmpdir(), "dstream-thumbnail-test-"));
const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const id = (name: string) => `${pubkey}--${name}`;
const healthy = new Set<string>();
const blackStreams = new Set<string>();
let requestCount = 0;
let manualJpeg: Buffer = Buffer.alloc(0);
let blackJpeg: Buffer = Buffer.alloc(0);
const hold = new Map<string, { arrived: () => void; resume: Promise<void> }>();
const prior = { dir: process.env.DSTREAM_THUMBNAIL_DIR, auth: process.env.DSTREAM_MEDIA_AUTH_SECRET, manifest: process.env.DSTREAM_MEDIA_MANIFEST_SECRET, hls: process.env.DSTREAM_HLS_PROXY_ORIGIN, public: process.env.DSTREAM_PUBLIC_ORIGIN };
process.env.DSTREAM_THUMBNAIL_DIR = path.join(root, "store");
process.env.DSTREAM_MEDIA_AUTH_SECRET = "test-only-thumbnail-publisher-secret-0123456789";
process.env.DSTREAM_MEDIA_MANIFEST_SECRET = "test-only-thumbnail-read-secret-0123456789";
process.env.DSTREAM_PUBLIC_ORIGIN = "https://dstream.test";
const server = createServer(async (req, res) => {
  requestCount += 1;
  const url = new URL(req.url || "/", "http://localhost");
  const pieces = url.pathname.split("/").filter(Boolean);
  const stream = pieces[0] || "";
  const readToken = req.headers.authorization?.replace(/^Bearer /, "") || "";
  if (!healthy.has(stream) || !verifyMediaServiceCredential(readToken, stream, "read", { manifest: process.env.DSTREAM_MEDIA_MANIFEST_SECRET })) { res.writeHead(404); res.end(); return; }
  const gate = hold.get(stream);
  if (gate) { gate.arrived(); await gate.resume; }
  const name = pieces[1];
  if (!name || !/^(?:index\.m3u8|index\d+\.ts)$/.test(name)) { res.writeHead(404); res.end(); return; }
  try {
    res.setHeader("content-type", name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t");
    res.end(readFileSync(path.join(blackStreams.has(stream) ? path.join(root, "black") : root, name)));
  } catch { res.writeHead(404); res.end(); }
});

before(async () => {
  await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=12", "-t", "2", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-g", "12", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0", path.join(root, "index.m3u8")]);
  mkdirSync(path.join(root, "black"));
  await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:size=640x360:rate=12", "-t", "2", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-g", "12", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0", path.join(root, "black", "index.m3u8")]);
  const jpeg = (folder: string) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", path.join(folder, "index0.ts"), "-frames:v", "1", "-c:v", "mjpeg", "-f", "image2pipe", "pipe:1"]);
  manualJpeg = jpeg(root); blackJpeg = jpeg(path.join(root, "black"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  process.env.DSTREAM_HLS_PROXY_ORIGIN = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of Object.entries({ DSTREAM_THUMBNAIL_DIR: prior.dir, DSTREAM_MEDIA_AUTH_SECRET: prior.auth, DSTREAM_MEDIA_MANIFEST_SECRET: prior.manifest, DSTREAM_HLS_PROXY_ORIGIN: prior.hls, DSTREAM_PUBLIC_ORIGIN: prior.public })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

function context(stream: string) { return { params: Promise.resolve({ originStreamId: stream }) }; }
function request(stream: string, method = "POST", body: object | Buffer = {}, revision?: number): Request {
  const token = issuePublishCredential(stream).token;
  return new Request(`https://dstream.test/api/broadcast/thumbnail/${stream}`, { method,
    headers: { authorization: `Bearer ${token}`, "content-type": Buffer.isBuffer(body) ? "image/jpeg" : "application/json", ...(revision ? { "x-thumbnail-revision": String(revision) } : {}) },
    body: method === "GET" ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) });
}
function imageRequest(stream: string, etag?: string) { return new Request(`https://dstream.test/api/thumbnail/${stream}`, { headers: etag ? { "if-none-match": etag } : {} }); }

test("public image URLs reject local, credentialed and non-HTTPS manual URLs", () => {
  for (const value of ["http://cdn.example/a.jpg", "data:image/png;base64,AAAA", "https://user:pass@cdn.example/a.jpg", "https://127.0.0.1/a.jpg", "https://localhost/a.jpg", "https://[::1]/a.jpg", "https://cdn.example/a.jpg#secret"]) {
    assert.throws(() => manualThumbnailUrl(value));
  }
  assert.equal(manualThumbnailUrl(" https://cdn.example/cover.jpg "), "https://cdn.example/cover.jpg");
  assert.throws(() => publicThumbnailUrl("http://dstream.test", id("test")));
});

test("settings are publisher-authorized and stream-bound", async () => {
  const stream = id("auth");
  assert.equal((await settingsGet(new Request(`https://dstream.test/api/broadcast/thumbnail/${stream}`), context(stream))).status, 403);
  const wrong = request(id("other"), "GET");
  assert.equal((await settingsGet(wrong, context(stream))).status, 403);
  assert.equal(readThumbnail(stream), null);
});

test("unsafe legacy cover remains manual and correctable rather than enabling automatic capture or blocking setup", async () => {
  const stream = id("legacy-cover");
  const response = await POST(request(stream, "POST", { image: "http://old.example/cover.jpg", active: true, generate: true }), context(stream));
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.mode, "manual");
  assert.equal(state.source, "pending");
  assert.match(state.warning, /public HTTPS/);
  assert.equal(readThumbnail(stream)?.digest, undefined);
  const corrected = await PUT(request(stream, "PUT", { mode: "manual", image: "https://cdn.example/corrected.jpg" }, state.revision), context(stream));
  assert.equal(corrected.status, 200);
  assert.equal((await corrected.json()).imageUrl, "https://cdn.example/corrected.jpg");
  assert.equal(readThumbnail(stream)?.needsManualImage, undefined);
});

test("initial announcement has a stable public fallback, not an unconfigured image URL", async () => {
  const stream = id("planned");
  const response = await POST(request(stream, "POST", { active: false }), context(stream));
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.source, "pending");
  assert.equal(state.imageUrl, publicThumbnailUrl("https://dstream.test", stream));
  const image = await imageGet(imageRequest(stream), context(stream));
  assert.equal(image.status, 302);
  assert.equal(image.headers.get("location"), "/logo_trimmed.png");
  assert.match(image.headers.get("cache-control") || "", /max-age=5/);
});

test("real HLS: failed initial ingest retries after recovery and produces a decoded 16:9 JPEG", async (t) => {
  const stream = id("recover");
  ensureThumbnail(stream, { active: true });
  const failed = await generateThumbnail(stream);
  assert.equal(failed.digest, undefined);
  assert.ok(failed.retryAt > Date.now());
  healthy.add(stream);
  assert.equal((await generateThumbnail(stream)).digest, undefined, "backoff is respected even when ingest recovers");
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.mock.timers.tick(31_000);
  const ready = await generateThumbnail(stream);
  assert.ok(ready.digest);
  assert.equal(ready.revision, 2);
  const jpeg = thumbnailJpeg(stream, ready);
  assert.ok(jpeg);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", "-i", "pipe:0"], { input: jpeg, encoding: "utf8" }));
  assert.deepEqual(probe.streams.map((row: { width: number; height: number }) => [row.width, row.height]), [[640, 360]]);
  const pixels = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vf", "scale=16:16", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { input: jpeg });
  assert.equal(pixels.length, 16 * 16 * 3);
  assert.ok(new Set(pixels).size > 32, "the captured fixture is real nonblank video, not a solid fallback");
  const image = await imageGet(imageRequest(stream), context(stream));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  assert.equal(image.headers.get("access-control-allow-origin"), "*");
  assert.match(image.headers.get("cache-control") || "", /max-age=30/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);
  const etag = image.headers.get("etag");
  assert.ok(etag);
  assert.equal((await imageGet(imageRequest(stream, etag), context(stream))).status, 304);
  const versioned = `${publicThumbnailUrl("https://dstream.test", stream)}?v=${ready.digest}`;
  assert.equal(thumbnailState(stream, "https://dstream.test", ready).imageUrl, versioned, "a ready image changes the pending cache key once");
  const ended = ensureThumbnail(stream, { active: false });
  assert.equal(thumbnailState(stream, "https://dstream.test", ended).imageUrl, versioned, "status transitions retain the same ready-image URL");
});

test("public-image requests can backfill a configured live stream without a viewer cookie", async () => {
  const stream = id("public-backfill");
  ensureThumbnail(stream, { active: true }); healthy.add(stream);
  const image = await imageGet(imageRequest(stream), context(stream));
  assert.equal(image.status, 200);
  assert.ok(readThumbnail(stream)?.digest);
  const before = readThumbnail(stream);
  const again = await imageGet(imageRequest(stream), context(stream));
  assert.equal(again.headers.get("etag"), image.headers.get("etag"));
  assert.deepEqual(readThumbnail(stream), before, "successful captures are not repeated on every view");
});

test("private video capture requires explicit permission and stops when that permission is revoked", async () => {
  const stream = id("private-capture");
  const initial = ensureThumbnail(stream, { active: true, privateStream: true }); healthy.add(stream);
  const before = requestCount;
  assert.equal((await generateThumbnail(stream)).digest, undefined);
  assert.equal(requestCount, before, "private video was not even fetched by default");
  const allow = await PUT(request(stream, "PUT", { mode: "automatic", privateCaptureAllowed: true }, initial.revision), context(stream));
  assert.equal(allow.status, 200);
  const generated = await generateThumbnail(stream);
  assert.ok(generated.digest);
  const revoke = await PUT(request(stream, "PUT", { mode: "automatic", privateCaptureAllowed: false }, generated.revision), context(stream));
  assert.equal(revoke.status, 200);
  const revoked = readThumbnail(stream);
  assert.equal(revoked?.digest, undefined);
  assert.equal(revoked?.privateCaptureAllowed, false);
  const requests = requestCount;
  assert.equal((await generateThumbnail(stream)).digest, undefined);
  assert.equal(requestCount, requests);
});

test("changing to private while a real HLS read is in flight prevents publication of that frame", async () => {
  const stream = id("privacy-race");
  ensureThumbnail(stream, { active: true }); healthy.add(stream);
  let arrived: () => void = () => undefined, resume: () => void = () => undefined;
  const seen = new Promise<void>((resolve) => { arrived = resolve; });
  const release = new Promise<void>((resolve) => { resume = resolve; });
  hold.set(stream, { arrived, resume: release });
  const generation = generateThumbnail(stream);
  try { await seen; ensureThumbnail(stream, { privateStream: true }); }
  finally { resume(); hold.delete(stream); }
  const current = await generation;
  assert.equal(current.privateStream, true);
  assert.equal(current.privateCaptureAllowed, false);
  assert.equal(current.digest, undefined);
  assert.equal(thumbnailJpeg(stream, current), null);
});

test("decoded black startup frames remain pending until suitable video arrives; manual black covers are retained", async (t) => {
  const stream = id("black-startup");
  ensureThumbnail(stream, { active: true }); healthy.add(stream); blackStreams.add(stream);
  const black = await generateThumbnail(stream);
  assert.equal(black.digest, undefined);
  assert.ok(black.retryAt > Date.now());
  blackStreams.delete(stream);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.mock.timers.tick(31_000);
  assert.ok((await generateThumbnail(stream)).digest);
  const manual = id("manual-black");
  const initial = ensureThumbnail(manual, {});
  const saved = await PUT(request(manual, "PUT", blackJpeg, initial.revision), context(manual));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).source, "manual");
  assert.ok(readThumbnail(manual)?.digest);
});

test("manual URL survives automatic requests, lifecycle updates and a separate process reload", async () => {
  const stream = id("manual");
  const initial = ensureThumbnail(stream, { image: "https://cdn.example/oot.jpg", active: false });
  healthy.add(stream);
  ensureThumbnail(stream, { active: true, image: "https://cdn.example/stale.jpg" });
  assert.equal((await generateThumbnail(stream)).manualUrl, initial.manualUrl);
  ensureThumbnail(stream, { active: false });
  const json = execFileSync(process.execPath, ["--import", "tsx", "-e", `const {readThumbnail} = require(${JSON.stringify(fileURLToPath(new URL("./streamThumbnail.ts", import.meta.url)))}); console.log(JSON.stringify(readThumbnail(${JSON.stringify(stream)})));`], { encoding: "utf8", env: process.env });
  assert.equal(JSON.parse(json).manualUrl, initial.manualUrl);
  assert.equal(JSON.parse(json).active, false);
});

test("manual upload is decoded, stored, publicly served and protected by current revision", async () => {
  const stream = id("upload");
  const initial = ensureThumbnail(stream, {});
  const jpeg = await decodeThumbnail(manualJpeg);
  const response = await PUT(request(stream, "PUT", jpeg, initial.revision), context(stream));
  assert.equal(response.status, 200);
  const manual = readThumbnail(stream);
  assert.equal(manual?.mode, "manual");
  assert.ok(manual?.digest);
  assert.equal((await imageGet(imageRequest(stream), context(stream))).headers.get("content-type"), "image/jpeg");
  const stale = await PUT(request(stream, "PUT", { mode: "off" }, initial.revision), context(stream));
  assert.equal(stale.status, 409);
  assert.deepEqual(readThumbnail(stream), manual);
});

test("manual cover wins a genuine in-flight HLS capture race", async () => {
  const stream = id("race");
  const initial = ensureThumbnail(stream, { active: true }); healthy.add(stream);
  let arrived: () => void = () => undefined, resume: () => void = () => undefined;
  const seen = new Promise<void>((resolve) => { arrived = resolve; });
  const release = new Promise<void>((resolve) => { resume = resolve; });
  hold.set(stream, { arrived, resume: release });
  const generation = generateThumbnail(stream);
  try {
    await seen;
    configureThumbnail(stream, initial.revision, "manual", "https://cdn.example/approved.jpg");
  } finally { resume(); hold.delete(stream); }
  assert.equal((await generation).manualUrl, "https://cdn.example/approved.jpg");
  assert.equal(readThumbnail(stream)?.digest, undefined);
});

test("malformed upload and over-limit input do not replace the current thumbnail", async () => {
  const stream = id("bad-upload");
  const initial = ensureThumbnail(stream, { image: "https://cdn.example/keep.jpg" });
  assert.equal((await PUT(request(stream, "PUT", Buffer.from("not an image"), initial.revision), context(stream))).status, 400);
  assert.deepEqual(readThumbnail(stream), initial);
  assert.equal((await PUT(request(stream, "PUT", Buffer.alloc(2 * 1024 * 1024 + 1), initial.revision), context(stream))).status, 413);
  assert.deepEqual(readThumbnail(stream), initial);
});

test("a JPEG-disguised playlist cannot make an upload decoder fetch a URL", async () => {
  const stream = id("no-upload-fetch");
  const initial = ensureThumbnail(stream, { image: "https://cdn.example/keep.jpg" });
  const before = requestCount;
  const playlist = `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${process.env.DSTREAM_HLS_PROXY_ORIGIN}/must-not-fetch.ts\n#EXT-X-ENDLIST\n`;
  for (const prefix of [Buffer.alloc(0), Buffer.from([0xff, 0xd8])]) {
    const payload = Buffer.concat([prefix, Buffer.from(playlist)]);
    assert.equal((await PUT(request(stream, "PUT", payload, initial.revision), context(stream))).status, 400);
  }
  assert.equal(requestCount, before, "no HTTP request was made by either disguised upload");
  assert.deepEqual(readThumbnail(stream), initial);
});

test("opt-out persists and cannot be undone by automatic initialization or late generation", async () => {
  const stream = id("off");
  const initial = ensureThumbnail(stream, { active: true });
  const disabled = configureThumbnail(stream, initial.revision, "off");
  ensureThumbnail(stream, { active: true, image: "https://cdn.example/stale.jpg" });
  assert.deepEqual(await generateThumbnail(stream), disabled);
  assert.equal(thumbnailState(stream, "https://dstream.test", disabled).imageUrl, undefined);
  assert.equal((await imageGet(imageRequest(stream), context(stream))).status, 404);
  assert.throws(() => configureThumbnail(stream, initial.revision, "automatic"), ThumbnailConflict);
});

test("NIP-53: planned, live, corrected and ended events retain one stream address and interoperable image tag", () => {
  const sequence = new StreamAnnounceSequence();
  const stream = "same-stream";
  const image = `${publicThumbnailUrl("https://dstream.test", id(stream))}?v=${"a".repeat(64)}`;
  const events = (["planned", "live", "live", "ended"] as const).map((status) => finalizeEvent(buildStreamAnnounceEvent({ pubkey, streamId: stream, status,
    title: "Controlled HLS thumbnail", createdAt: sequence.begin().createdAt, image }), secret));
  assert.equal(new Set(events.map((event) => makeATag(event.pubkey, stream))).size, 1);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length, "replacement events necessarily have new signed IDs, not new stream addresses");
  for (const event of events) {
    assert.ok(verifyEvent(event));
    assert.equal(parseStreamAnnounceEvent(event)?.image, image);
    assert.equal(event.tags.filter((tag) => tag[0] === "image").length, 1);
    assert.equal(event.tags.find((tag) => tag[0] === "image")?.[1], image, "standard NIP-53 consumer needs no dStream-specific field");
  }
  const old = sequence.begin(), newer = sequence.begin();
  assert.equal(sequence.current(old.sequence), false);
  assert.equal(sequence.current(newer.sequence), true);
  assert.ok(newer.createdAt > old.createdAt);
  assert.equal(new StreamAnnounceSequence("reloaded-owner").begin(100, 100).createdAt, 101, "a fresh page replaces an event from the same second deterministically");
  sequence.invalidate();
  assert.equal(sequence.current(newer.sequence), false, "owner cleanup invalidates outstanding work without permanently disabling reconnect");
  assert.equal(sequence.current(sequence.begin().sequence), true);
  const planned = events[0];
  const policy = registerPlaybackPolicyFromAnnounceEvent(planned);
  assert.equal(policy.ok, false);
  if (!policy.ok) assert.equal(policy.status, 409);
});
