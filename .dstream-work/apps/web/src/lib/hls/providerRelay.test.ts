import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProviderHlsRelayPath,
  parseRelayedProviderUrl,
  rewriteProviderHlsPlaylist
} from "./providerRelay";

test("relays only trusted HTTPS Streamroad hosts", () => {
  assert.equal(parseRelayedProviderUrl("https://api.streamroad.money/live.m3u8")?.hostname, "api.streamroad.money");
  assert.equal(parseRelayedProviderUrl("https://streamroad.money/live.m3u8")?.hostname, "streamroad.money");
  assert.equal(parseRelayedProviderUrl("http://api.streamroad.money/live.m3u8"), null);
  assert.equal(parseRelayedProviderUrl("https://streamroad.money.evil.example/live.m3u8"), null);
  assert.equal(parseRelayedProviderUrl("https://zap.stream/live.m3u8"), null);
  assert.equal(parseRelayedProviderUrl("https://127.0.0.1/live.m3u8"), null);
});

test("builds a same-origin relay path without nesting existing relay URLs", () => {
  const relayPath = buildProviderHlsRelayPath("https://api.streamroad.money/live.m3u8?vt=test");
  assert.ok(relayPath);
  const parsed = new URL(relayPath, "https://dstream.stream");
  assert.equal(parsed.pathname, "/api/hls-relay");
  assert.equal(parsed.searchParams.get("url"), "https://api.streamroad.money/live.m3u8?vt=test");
  assert.equal(buildProviderHlsRelayPath(relayPath), null);
});

test("rewrites media, segment, map, and key references through the relay", () => {
  const source = "https://api.streamroad.money/stream/hls/live.m3u8?vt=test";
  const playlist = [
    "#EXTM3U",
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://api.streamroad.money/keys/live"',
    "#EXT-X-STREAM-INF:BANDWIDTH=2000000",
    "video/live.m3u8?token=abc",
    "#EXTINF:2,",
    "123.m4s",
    ""
  ].join("\n");

  const rewritten = rewriteProviderHlsPlaylist(playlist, source);
  assert.match(rewritten, /#EXT-X-MAP:URI="\/api\/hls-relay\?url=/);
  assert.match(rewritten, /#EXT-X-KEY:METHOD=AES-128,URI="\/api\/hls-relay\?url=/);
  assert.match(rewritten, /\/api\/hls-relay\?url=https%3A%2F%2Fapi\.streamroad\.money%2Fstream%2Fhls%2Fvideo%2Flive\.m3u8%3Ftoken%3Dabc/);
  assert.match(rewritten, /\/api\/hls-relay\?url=https%3A%2F%2Fapi\.streamroad\.money%2Fstream%2Fhls%2F123\.m4s/);
  assert.ok(rewritten.endsWith("\n"));
});
