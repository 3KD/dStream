import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const HLS_DIR = (process.env.HLS_DIR || "/hls").trim();
const SOURCE_HLS_BASE = (process.env.TRANSCODER_SOURCE_HLS_BASE || "http://mediamtx:8880").trim().replace(/\/$/, "");
const OUTPUT_RTMP_BASE = (process.env.TRANSCODER_OUTPUT_RTMP_BASE || "rtmp://mediamtx:1935").trim().replace(/\/$/, "");
const POLL_MS = Math.max(500, Number(process.env.TRANSCODER_POLL_MS || "2500"));
const STALE_MS = Math.max(3000, Number(process.env.TRANSCODER_STALE_MS || "12000"));
const MAX_JOBS = Math.max(1, Number(process.env.TRANSCODER_MAX_STREAMS || "24"));
const PROFILE_RAW =
  process.env.TRANSCODER_PROFILES || "720p:1280:720:2500k:128k,480p:854:480:1200k:96k,360p:640:360:700k:64k";
const RENDITION_SUFFIX = /__r([0-9]{3,4}p)$/;

function parseProfiles(raw) {
  const out = [];
  for (const entry of String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [idRaw, widthRaw, heightRaw, videoBitrateRaw, audioBitrateRaw] = entry.split(":");
    const id = String(idRaw || "").trim();
    const width = Number(widthRaw);
    const height = Number(heightRaw);
    const videoBitrate = String(videoBitrateRaw || "").trim();
    const audioBitrate = String(audioBitrateRaw || "").trim();
    if (!id || !Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || !videoBitrate || !audioBitrate) {
      continue;
    }
    out.push({
      id,
      width,
      height,
      videoBitrate,
      audioBitrate
    });
  }
  if (out.length === 0) {
    throw new Error(`invalid TRANSCODER_PROFILES: ${raw}`);
  }
  return out;
}

const PROFILES = parseProfiles(PROFILE_RAW);

function parseSourceDirName(dirName) {
  const idx = dirName.indexOf("--");
  if (idx <= 0) return null;
  const streamPubkey = dirName.slice(0, idx).toLowerCase();
  const streamId = dirName.slice(idx + 2);
  if (!/^[0-9a-f]{64}$/.test(streamPubkey)) return null;
  if (!streamId || RENDITION_SUFFIX.test(streamId)) return null;
  return { streamPubkey, streamId };
}

async function readActiveSourceDirs() {
  const now = Date.now();
  let entries = [];
  try {
    entries = await fs.readdir(HLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const active = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsed = parseSourceDirName(entry.name);
    if (!parsed) continue;
    const latestSegmentMtime = await findLatestSegmentMtime(path.join(HLS_DIR, entry.name));
    if (!Number.isFinite(latestSegmentMtime)) continue;
    if (now - latestSegmentMtime > STALE_MS) continue;
    active.push(entry.name);
  }
  return active;
}

function isSegmentFileName(fileName) {
  return /_seg\d+\.(mp4|m4s|ts)$/i.test(fileName);
}

async function findLatestSegmentMtime(dirPath) {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  let latestMtime = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isSegmentFileName(entry.name)) continue;
    try {
      const stat = await fs.stat(path.join(dirPath, entry.name));
      if (!stat.isFile()) continue;
      if (latestMtime == null || stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
      }
    } catch {
      // ignore race/delete while scanning
    }
  }
  return latestMtime;
}

function buildInputUrl(sourceName) {
  return `${SOURCE_HLS_BASE}/${encodeURIComponent(sourceName)}/index.m3u8`;
}

function buildOutputRtmpUrl(sourceName, profileId) {
  const outPath = `${sourceName}__r${profileId}`;
  return `${OUTPUT_RTMP_BASE}/${encodeURIComponent(outPath)}`;
}

function buildScaleFilter(width, height) {
  return `scale='if(gt(iw,${width}),${width},iw)':'if(gt(ih,${height}),${height},ih)':force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'`;
}

function buildFfmpegArgs(sourceName, profile) {
  const inputUrl = buildInputUrl(sourceName);
  const outputUrl = buildOutputRtmpUrl(sourceName, profile.id);
  const bitrateK = Math.max(1, Math.trunc(parseInt(profile.videoBitrate, 10) || 0));
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "warning",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "2",
    "-i",
    inputUrl,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-profile:v",
    "main",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "60",
    "-keyint_min",
    "60",
    "-sc_threshold",
    "0",
    "-b:v",
    profile.videoBitrate,
    "-maxrate",
    profile.videoBitrate,
    "-bufsize",
    `${bitrateK * 2}k`,
    "-vf",
    buildScaleFilter(profile.width, profile.height),
    "-c:a",
    "aac",
    "-b:a",
    profile.audioBitrate,
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "flv",
    outputUrl
  ];
}

class ProfileRunner {
  constructor(sourceName, profile) {
    this.sourceName = sourceName;
    this.profile = profile;
    this.child = null;
    this.restartTimer = null;
    this.stopped = false;
  }

  start() {
    if (this.stopped) return;
    if (this.child) return;
    const args = buildFfmpegArgs(this.sourceName, this.profile);
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;

    child.stdout?.on("data", (buf) => {
      const line = String(buf || "").trim();
      if (line) console.log(`[transcoder:${this.sourceName}:${this.profile.id}] ${line}`);
    });
    child.stderr?.on("data", (buf) => {
      const line = String(buf || "").trim();
      if (line) console.log(`[transcoder:${this.sourceName}:${this.profile.id}] ${line}`);
    });
    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.stopped) return;
      console.warn(`[transcoder:${this.sourceName}:${this.profile.id}] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.start();
      }, 1000);
    });
  }

  stop() {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // ignore
      }
      this.child = null;
    }
  }
}

class SourceJob {
  constructor(sourceName) {
    this.sourceName = sourceName;
    this.lastSeenAtMs = 0;
    this.runners = new Map();
  }

  touch(nowMs) {
    this.lastSeenAtMs = nowMs;
  }

  ensureRunners() {
    for (const profile of PROFILES) {
      if (this.runners.has(profile.id)) continue;
      const runner = new ProfileRunner(this.sourceName, profile);
      this.runners.set(profile.id, runner);
      runner.start();
    }
  }

  stopAll() {
    for (const runner of this.runners.values()) {
      runner.stop();
    }
    this.runners.clear();
  }
}

const jobs = new Map();
let shuttingDown = false;

function stopAllJobs() {
  for (const job of jobs.values()) job.stopAll();
  jobs.clear();
}

process.on("SIGINT", () => {
  shuttingDown = true;
  stopAllJobs();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shuttingDown = true;
  stopAllJobs();
  process.exit(0);
});

async function tick() {
  const now = Date.now();
  const active = await readActiveSourceDirs();
  const activeSet = new Set(active.slice(0, MAX_JOBS));

  for (const sourceName of activeSet) {
    let job = jobs.get(sourceName);
    if (!job) {
      job = new SourceJob(sourceName);
      jobs.set(sourceName, job);
      console.log(`[transcoder] start source=${sourceName}`);
    }
    job.touch(now);
    job.ensureRunners();
  }

  for (const [sourceName, job] of jobs.entries()) {
    if (activeSet.has(sourceName)) continue;
    if (now - job.lastSeenAtMs <= STALE_MS) continue;
    console.log(`[transcoder] stop source=${sourceName}`);
    job.stopAll();
    jobs.delete(sourceName);
  }
}

async function main() {
  console.log("[transcoder] starting");
  console.log(`[transcoder] hls_dir=${HLS_DIR}`);
  console.log(`[transcoder] source_hls_base=${SOURCE_HLS_BASE}`);
  console.log(`[transcoder] output_rtmp_base=${OUTPUT_RTMP_BASE}`);
  console.log(`[transcoder] profiles=${PROFILES.map((p) => p.id).join(",")}`);
  console.log(`[transcoder] poll_ms=${POLL_MS} stale_ms=${STALE_MS} max_jobs=${MAX_JOBS}`);

  while (!shuttingDown) {
    try {
      await tick();
    } catch (err) {
      console.warn(`[transcoder] tick error: ${err?.message ?? err}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

await main();
