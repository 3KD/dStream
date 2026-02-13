#!/usr/bin/env node

const BASE_URL = String(process.env.EXTERNAL_BASE_URL || "http://127.0.0.1:5656")
  .trim()
  .replace(/\/+$/, "");
const TIMEOUT_MS = Number.parseInt(String(process.env.EXTERNAL_TIMEOUT_MS || "12000"), 10);
const MAX_CHUNKS = Number.parseInt(String(process.env.EXTERNAL_MAX_CHUNKS || "40"), 10);
const REQUIRE_WSS = String(process.env.REQUIRE_WSS || "1").trim() !== "0";
const REQUIRE_TURN = String(process.env.REQUIRE_TURN || "1").trim() !== "0";
const ALLOW_LOCAL_HINTS = String(process.env.ALLOW_LOCAL_HINTS || "0").trim() === "1";

const REQUIRED_PATHS = ["/", "/browse", "/broadcast", "/settings"];
const FORBIDDEN_PATTERNS = [
  /ws:\/\/localhost/i,
  /ws:\/\/127\.0\.0\.1/i,
  /http:\/\/localhost/i,
  /http:\/\/127\.0\.0\.1/i,
  /localhost:8081/i
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function extractChunkUrls(html) {
  const out = new Set();
  const regexes = [
    /\/_next\/static\/chunks\/[^"'`\\\s<>()]+\.js(?:\?[^"'`\\\s<>()]*)?/g,
    /https?:\/\/[^"'`\\\s<>()]+\/_next\/static\/chunks\/[^"'`\\\s<>()]+\.js(?:\?[^"'`\\\s<>()]*)?/g
  ];

  for (const re of regexes) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const raw = m[0]
        .replace(/\\u0026/gi, "&")
        .replace(/\\\//g, "/")
        .replace(/\\+$/g, "");
      try {
        const absolute = raw.startsWith("http://") || raw.startsWith("https://")
          ? new URL(raw).toString()
          : new URL(raw, `${BASE_URL}/`).toString();
        out.add(absolute);
      } catch {
        // ignore invalid urls
      }
    }
  }
  return Array.from(out);
}

async function fetchText(url) {
  const controller = AbortSignal.timeout(Number.isFinite(TIMEOUT_MS) ? TIMEOUT_MS : 12000);
  const response = await fetch(url, { signal: controller, redirect: "follow", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} @ ${url}`);
  }
  return await response.text();
}

async function main() {
  const errors = [];
  const pages = [];

  console.log(`external readiness: probing ${BASE_URL}`);

  for (const path of REQUIRED_PATHS) {
    const url = new URL(path, `${BASE_URL}/`).toString();
    try {
      const body = await fetchText(url);
      pages.push({ path, url, body });
      console.log(`  ok ${path}`);
    } catch (err) {
      errors.push(`Path check failed (${path}): ${err?.message ?? String(err)}`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`  - ${error}`);
    fail("required paths are not healthy");
  }

  const chunkUrlSet = new Set();
  for (const page of pages) {
    for (const chunkUrl of extractChunkUrls(page.body)) chunkUrlSet.add(chunkUrl);
  }
  const chunkUrls = Array.from(chunkUrlSet).slice(0, Number.isFinite(MAX_CHUNKS) ? MAX_CHUNKS : 40);
  const chunks = [];
  for (const chunkUrl of chunkUrls) {
    try {
      const body = await fetchText(chunkUrl);
      chunks.push(body);
    } catch (err) {
      errors.push(`Chunk fetch failed: ${chunkUrl} (${err?.message ?? String(err)})`);
    }
  }

  const combined = `${pages.map((p) => p.body).join("\n")}\n${chunks.join("\n")}`;

  if (!ALLOW_LOCAL_HINTS) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(combined)) {
        errors.push(`Forbidden local network hint found in public bundle: ${pattern}`);
      }
    }
  }

  if (REQUIRE_WSS && !/wss:\/\//i.test(combined)) {
    errors.push("Expected at least one wss:// relay hint in public bundle.");
  }

  if (REQUIRE_TURN && !/turns?:/i.test(combined)) {
    errors.push("Expected at least one turn:/turns: ICE hint in public bundle.");
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`  - ${error}`);
    fail("external readiness checks failed");
  }

  console.log(`PASS: ${pages.length} pages, ${chunks.length} client chunks scanned`);
}

void main();
