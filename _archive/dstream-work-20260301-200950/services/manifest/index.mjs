import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

function isHex64(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function uniqStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseRelays(raw) {
  if (!raw) return [];
  return uniqStrings(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function readText(filePath) {
  const buf = await fs.readFile(filePath);
  return buf.toString("utf8");
}

async function fetchText(url, opts) {
  const controller = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

function pickMediaPlaylist(masterContent) {
  // If it's already a media playlist, it will include EXTINF or EXT-X-MAP.
  if (/\n#EXTINF:/.test(masterContent) || /\n#EXT-X-MAP:/.test(masterContent)) return null;

  const lines = masterContent
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Pick the first referenced playlist.
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.toLowerCase().endsWith(".m3u8")) return line;
  }

  return null;
}

function parseMediaPlaylist(mediaContent) {
  const lines = mediaContent
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let initUri = null;
  const segments = [];

  for (const line of lines) {
    if (line.startsWith("#EXT-X-MAP:")) {
      const match = line.match(/URI=\"([^\"]+)\"/i);
      if (match?.[1]) initUri = match[1];
      continue;
    }

    if (line.startsWith("#")) continue;

    // segment uri
    if (/\.(m4s|ts|mp4)$/i.test(line)) segments.push(line);
  }

  return { initUri, segments };
}

function parseOriginStreamId(dirName) {
  const idx = dirName.indexOf("--");
  if (idx <= 0) return null;
  const streamPubkey = dirName.slice(0, idx);
  const streamIdRaw = dirName.slice(idx + 2);
  if (!isHex64(streamPubkey)) return null;
  if (!streamIdRaw || streamIdRaw.trim().length === 0) return null;

  const m = streamIdRaw.match(/__r([0-9]{3,4}p)$/);
  const streamId = m ? streamIdRaw.slice(0, -m[0].length) : streamIdRaw;
  if (!streamId || streamId.trim().length === 0) return null;

  return {
    streamPubkey: streamPubkey.toLowerCase(),
    streamId,
    renditionHint: m?.[1] ?? null
  };
}

function makeATag(streamPubkey, streamId) {
  return `30311:${streamPubkey}:${streamId}`;
}

function makeDTag({ streamPubkey, streamId, renditionId, epochStartMs }) {
  return `${streamPubkey}:${streamId}:${renditionId}:${epochStartMs}`;
}

async function fileInfo(filePath) {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) return null;
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

async function hashFile(filePath) {
  const buf = await fs.readFile(filePath);
  return { sha256: sha256Hex(buf), byteLength: buf.byteLength };
}

function makeUnsignedManifestEvent({
  manifestPubkey,
  createdAtSec,
  streamPubkey,
  streamId,
  renditionId,
  epochStartMs,
  epochDurationMs,
  segments,
  init
}) {
  const tags = [
    ["d", makeDTag({ streamPubkey, streamId, renditionId, epochStartMs })],
    ["a", makeATag(streamPubkey, streamId)],
    ["r", renditionId],
    ["epoch", String(epochStartMs), String(epochDurationMs)]
  ];

  const content = JSON.stringify({
    v: 1,
    streamPubkey,
    streamId,
    renditionId,
    epochStartMs,
    epochDurationMs,
    segments,
    init: init ?? undefined
  });

  return {
    kind: 30313,
    created_at: createdAtSec,
    tags,
    content,
    pubkey: manifestPubkey
  };
}

async function publish(pool, relays, event) {
  const pubs = pool.publish(relays, event);
  await Promise.race([Promise.any(pubs), timeout(5000)]);
}

async function main() {
  const HLS_DIR = (process.env.HLS_DIR || "/hls").trim();
  const MEDIAMTX_HLS_URL = (process.env.MEDIAMTX_HLS_URL || "http://mediamtx:8880").trim().replace(/\/$/, "");
  const epochDurationMs = Number(process.env.MANIFEST_EPOCH_MS || "12000");
  const httpPort = Number(process.env.MANIFEST_HTTP_PORT || "3001");

  const relays = parseRelays(process.env.NOSTR_RELAYS || process.env.MANIFEST_RELAYS || "ws://relay:8080");
  if (relays.length === 0) throw new Error("No Nostr relays configured (set NOSTR_RELAYS).");

  const secretKeyHex = (process.env.MANIFEST_SECRET_KEY_HEX || "").trim();
  const secretKey = secretKeyHex && isHex64(secretKeyHex) ? Buffer.from(secretKeyHex, "hex") : generateSecretKey();
  const manifestPubkey = getPublicKey(secretKey);
  const manifestNpub = nip19.npubEncode(manifestPubkey);

  const pool = new SimplePool();

  let latestManifest = null;
  const published = new Map(); // key -> contentHash

  console.log(`[manifest] pubkey=${manifestPubkey}`);
  console.log(`[manifest] npub=${manifestNpub}`);
  console.log(`[manifest] relays=${relays.join(",")}`);
  console.log(`[manifest] hls_dir=${HLS_DIR}`);
  console.log(`[manifest] mediamtx_hls_url=${MEDIAMTX_HLS_URL}`);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, pubkey: manifestPubkey, npub: manifestNpub }));
      return;
    }
    if (url.pathname === "/identity") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ pubkey: manifestPubkey, npub: manifestNpub }));
      return;
    }
    if (url.pathname === "/latest") {
      if (!latestManifest) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no manifest yet" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(latestManifest));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
  server.listen(httpPort, "0.0.0.0", () => {
    console.log(`[manifest] http listening on :${httpPort}`);
  });

  const scanOnce = async () => {
    let dirs;
    try {
      dirs = await fs.readdir(HLS_DIR, { withFileTypes: true });
    } catch (e) {
      console.warn("[manifest] unable to read HLS_DIR", e?.message || e);
      return;
    }

    for (const ent of dirs) {
      if (!ent.isDirectory()) continue;
      const parsed = parseOriginStreamId(ent.name);
      if (!parsed) continue;

      const { streamPubkey, streamId, renditionHint } = parsed;
      const streamDir = path.join(HLS_DIR, ent.name);

      const masterUrl = `${MEDIAMTX_HLS_URL}/${encodeURIComponent(ent.name)}/index.m3u8`;
      const master = await fetchText(masterUrl, { timeoutMs: 2500 });
      if (!master) continue;

      const mediaRelPath = pickMediaPlaylist(master);
      const mediaUrl = mediaRelPath
        ? `${MEDIAMTX_HLS_URL}/${encodeURIComponent(ent.name)}/${encodeURIComponent(mediaRelPath)}`
        : masterUrl;
      const media = mediaRelPath ? await fetchText(mediaUrl, { timeoutMs: 2500 }) : master;
      if (!media) continue;

      const { initUri, segments: segUris } = parseMediaPlaylist(media);
      if (!segUris.length) continue;

      const renditionId = renditionHint ?? (mediaRelPath ? path.basename(mediaRelPath, ".m3u8") : "index");
      const nowMs = Date.now();
      const epochStartMs = Math.floor(nowMs / epochDurationMs) * epochDurationMs;

      const segmentEntries = [];
      for (const uri of segUris) {
        const filePath = path.join(streamDir, uri);
        const info = await fileInfo(filePath);
        if (!info) continue;
        try {
          const hashed = await hashFile(filePath);
          segmentEntries.push({ uri, sha256: hashed.sha256, byteLength: hashed.byteLength });
        } catch {
          // ignore partial writes
        }
      }
      if (segmentEntries.length === 0) continue;

      let initEntry = null;
      if (initUri) {
        const initPath = path.join(streamDir, initUri);
        const info = await fileInfo(initPath);
        if (info) {
          try {
            const hashed = await hashFile(initPath);
            initEntry = { uri: initUri, sha256: hashed.sha256, byteLength: hashed.byteLength };
          } catch {
            // ignore
          }
        }
      }

      const unsigned = makeUnsignedManifestEvent({
        manifestPubkey,
        createdAtSec: nowSec(),
        streamPubkey,
        streamId,
        renditionId,
        epochStartMs,
        epochDurationMs,
        segments: segmentEntries,
        init: initEntry
      });

      const contentHash = sha256Hex(Buffer.from(unsigned.content, "utf8"));
      const key = `${streamPubkey}:${streamId}:${renditionId}:${epochStartMs}`;
      if (published.get(key) === contentHash) continue;

      const event = finalizeEvent(
        {
          kind: unsigned.kind,
          created_at: unsigned.created_at,
          tags: unsigned.tags,
          content: unsigned.content
        },
        secretKey
      );

      try {
        await publish(pool, relays, event);
        published.set(key, contentHash);
        latestManifest = { ...unsigned, id: event.id };
        console.log(`[manifest] published stream=${streamPubkey.slice(0, 8)}…/${streamId} epoch=${epochStartMs} segs=${segmentEntries.length}`);
      } catch (e) {
        console.warn("[manifest] publish failed", e?.message || e);
      }
    }
  };

  // Scan loop.
  const loop = async () => {
    try {
      await scanOnce();
    } catch (e) {
      console.warn("[manifest] scan loop error", e?.message || e);
    } finally {
      setTimeout(loop, 2000);
    }
  };
  loop();
}

main().catch((e) => {
  console.error("[manifest] fatal:", e?.stack || e);
  process.exit(1);
});
