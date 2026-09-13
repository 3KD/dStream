#!/usr/bin/env node

import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (directError) {
    for (const entry of String(process.env.PATH || "").split(path.delimiter)) {
      if (path.basename(entry) !== ".bin" || path.basename(path.dirname(entry)) !== "node_modules") continue;
      try {
        return require(path.join(path.dirname(entry), "playwright"));
      } catch {
        // Keep searching npx-provided package roots.
      }
    }
    throw directError;
  }
}

const { chromium, devices, firefox } = loadPlaywright();

const BASE_URL = String(process.env.EXTERNAL_BASE_URL || "https://dstream.stream").trim().replace(/\/+$/, "");
function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SOAK_MS = positiveNumber(process.env.PLAYBACK_SOAK_MS, 10 * 60_000);
const SOURCE_LIMIT = Math.floor(positiveNumber(process.env.PLAYBACK_SOURCE_LIMIT, 2));
const START_TIMEOUT_MS = positiveNumber(process.env.PLAYBACK_START_TIMEOUT_MS, 45_000);
const STALL_LIMIT_MS = positiveNumber(process.env.PLAYBACK_STALL_LIMIT_MS, 30_000);
const STARTUP_STABILITY_MS = positiveNumber(process.env.PLAYBACK_STARTUP_STABILITY_MS, 15_000);
const MAX_STARTUP_INTERRUPTION_MS = positiveNumber(process.env.PLAYBACK_MAX_STARTUP_INTERRUPTION_MS, 250);
const MAX_SOAK_INTERRUPTION_MS = positiveNumber(process.env.PLAYBACK_MAX_SOAK_INTERRUPTION_MS, 1_000);
const ROUTE_HANDOFF_AFTER_MS = positiveNumber(
  process.env.PLAYBACK_ROUTE_HANDOFF_AFTER_MS,
  Math.min(45_000, Math.max(5_000, Math.floor(SOAK_MS / 2)))
);
const SAMPLE_MS = 5_000;
const SOURCE_PATTERN = String(process.env.PLAYBACK_SOURCE_PATTERN || "").trim().toLowerCase();
const EXPLICIT_SOURCE_URL = String(process.env.PLAYBACK_SOURCE_URL || "").trim();
const EXPECTED_SOURCE_MODE = String(process.env.PLAYBACK_EXPECT_SOURCE_MODE || "").trim();
const PRESET_BACKGROUND_PLAY = process.env.PLAYBACK_PRESET_BACKGROUND_PLAY === "1";
const EXPECT_MUTED_AUTOPLAY =
  process.env.PLAYBACK_EXPECT_MUTED_AUTOPLAY === undefined
    ? !PRESET_BACKGROUND_PLAY
    : process.env.PLAYBACK_EXPECT_MUTED_AUTOPLAY !== "0";
const EXPECT_PRIVATE_ALLOWLISTED = process.env.PLAYBACK_EXPECT_PRIVATE_ALLOWLISTED === "1";
const IDENTITY_STORE_JSON = String(process.env.PLAYBACK_IDENTITY_STORE_JSON || "").trim();
const INITIAL_VISIBILITY = String(process.env.PLAYBACK_INITIAL_VISIBILITY || "").trim().toLowerCase();
const STARTUP_ONLY = process.env.PLAYBACK_STARTUP_ONLY === "1";
const EMIT_BROWSER_AUDIO = process.env.PLAYBACK_EMIT_BROWSER_AUDIO === "1";
const TRACE_HLS_RESPONSES = process.env.PLAYBACK_TRACE_HLS_RESPONSES === "1";
const TRACE_CPU_PROFILE = process.env.PLAYBACK_TRACE_CPU_PROFILE === "1";
const PLAY_AFTER_GATE_MAX_MS = positiveNumber(process.env.PLAYBACK_PLAY_AFTER_GATE_MAX_MS, 1_000);
const STUB_HIDDEN_PLAY_REJECTION =
  process.env.PLAYBACK_STUB_HIDDEN_PLAY_REJECTION === "1" ||
  (INITIAL_VISIBILITY === "hidden" && process.env.PLAYBACK_STUB_HIDDEN_PLAY_REJECTION !== "0");
const DISABLE_STARTUP_PROBE = process.env.PLAYBACK_DISABLE_STARTUP_PROBE === "1";
const REQUESTED_SCENARIOS = new Set(
  String(process.env.PLAYBACK_SCENARIOS || "chromium-desktop,chromium-mobile,firefox-desktop")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

function fail(message) {
  throw new Error(message);
}

function compactHlsResponses(responses) {
  return responses.map(({ url, variants, ...response }) => {
    let resourcePath = url;
    try {
      const parsed = new URL(url);
      resourcePath = parsed.pathname.split("/").slice(-3).join("/");
    } catch {
      // Keep the original value when a diagnostic URL cannot be parsed.
    }
    return { ...response, url: resourcePath, variantCount: variants.length };
  });
}

function summarizeCpuProfile(profile) {
  if (!profile?.nodes || !profile?.samples || !profile?.timeDeltas) return [];
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfMicros = new Map();
  profile.samples.forEach((nodeId, index) => {
    selfMicros.set(nodeId, (selfMicros.get(nodeId) ?? 0) + (profile.timeDeltas[index] ?? 0));
  });
  return Array.from(selfMicros.entries())
    .map(([nodeId, micros]) => {
      const frame = nodes.get(nodeId)?.callFrame;
      return {
        functionName: frame?.functionName || "(anonymous)",
        url: frame?.url || "",
        line: typeof frame?.lineNumber === "number" ? frame.lineNumber + 1 : null,
        selfMs: Math.round(micros / 1_000)
      };
    })
    .filter((entry) => entry.selfMs >= 10 && entry.functionName !== "(idle)")
    .sort((left, right) => right.selfMs - left.selfMs)
    .slice(0, 30);
}

function readIdentityStoreFixture() {
  if (!IDENTITY_STORE_JSON) return null;
  try {
    const parsed = JSON.parse(IDENTITY_STORE_JSON);
    if (!parsed || typeof parsed !== "object") fail("PLAYBACK_IDENTITY_STORE_JSON must be a JSON object");
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PLAYBACK_IDENTITY_STORE_JSON")) throw error;
    fail("PLAYBACK_IDENTITY_STORE_JSON must be valid JSON");
  }
}

const IDENTITY_STORE_FIXTURE = readIdentityStoreFixture();

function runDetails(run, sample) {
  const recent = [...run.samples, sample]
    .slice(-6)
    .map(
      (entry) =>
        `${entry.at}s:t=${entry.currentTime.toFixed(1)},pdt=${entry.programDateTime ? new Date(entry.programDateTime).toISOString() : "n/a"},paused=${entry.paused},ended=${entry.ended},ready=${entry.readyState},buffer=${entry.bufferedAhead.toFixed(1)},frames=${entry.frames ?? "n/a"},session=${entry.session ?? "n/a"},level=${entry.hlsLevel ?? "n/a"},frag=${entry.hlsFragment ?? "n/a"},pinned=${entry.timelinePinned ?? "n/a"},recovery=${entry.recoveryReason ?? "none"}`
    )
    .join(" | ");
  return `${run.routed ? "after" : "before"} route handoff; ${recent}`;
}

async function launchChromium() {
  const launchOptions = {
    headless: true,
    ...(EMIT_BROWSER_AUDIO ? {} : { args: ["--mute-audio"] })
  };
  if (process.env.PLAYBACK_CHROMIUM_CHANNEL?.trim().toLowerCase() === "bundled") {
    return chromium.launch(launchOptions);
  }
  try {
    return await chromium.launch({ ...launchOptions, channel: "chrome" });
  } catch {
    return chromium.launch(launchOptions);
  }
}

async function launchFirefox() {
  const executablePath = process.env.PLAYBACK_FIREFOX_EXECUTABLE?.trim();
  const launchOptions = {
    headless: true,
    ...(EMIT_BROWSER_AUDIO ? {} : { firefoxUserPrefs: { "media.volume_scale": "0.0" } })
  };
  if (executablePath) return firefox.launch({ ...launchOptions, executablePath });
  return firefox.launch(launchOptions);
}

async function loadSources() {
  if (EXPLICIT_SOURCE_URL) {
    return [
      {
        pubkey: String(process.env.PLAYBACK_SOURCE_PUBKEY || "0".repeat(64)),
        streamId: String(process.env.PLAYBACK_SOURCE_ID || "playback-soak"),
        title: String(process.env.PLAYBACK_SOURCE_TITLE || "explicit playback source"),
        streaming: EXPLICIT_SOURCE_URL,
        status: "live"
      }
    ];
  }
  const response = await fetch(`${BASE_URL}/api/discovery/snapshot?limit=100`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) fail(`discovery snapshot returned ${response.status}`);
  const payload = await response.json();
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const live = streams.filter(
    (stream) =>
      stream?.status === "live" &&
      typeof stream.pubkey === "string" &&
      typeof stream.streamId === "string" &&
      typeof stream.streaming === "string" &&
      stream.streaming.length > 0
  );
  const matching = SOURCE_PATTERN
    ? live.filter((stream) => `${stream.title ?? ""} ${stream.streamId} ${stream.streaming}`.toLowerCase().includes(SOURCE_PATTERN))
    : live;
  if (matching.length < SOURCE_LIMIT) {
    fail(`only ${matching.length} matching health-checked live sources available; need ${SOURCE_LIMIT}`);
  }
  return matching.slice(0, SOURCE_LIMIT);
}

function watchUrl(stream) {
  const url = new URL(`/watch/${encodeURIComponent(stream.pubkey)}/${encodeURIComponent(stream.streamId)}`, `${BASE_URL}/`);
  url.searchParams.set("u", stream.streaming);
  return url.toString();
}

async function sampleVideo(page) {
  return page.locator("video").first().evaluate((video) => ({
    currentTime: Number(video.currentTime || 0),
    paused: video.paused,
    muted: video.muted,
    volume: Number(video.volume),
    ended: video.ended,
    readyState: video.readyState,
    frames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
    marker: video.dataset.playbackSoakIdentity ?? null,
    session: video.dataset.dstreamPlaybackSession ?? null,
    signature: video.dataset.dstreamPlaybackSignature ?? null,
    recoveryReason: video.dataset.dstreamPlaybackRecoveryReason ?? null,
    programDateTime: (() => {
      const value = Number(video.dataset.dstreamProgramDateTime);
      return Number.isFinite(value) && value > 0 ? value : null;
    })(),
    hlsLevel: video.dataset.dstreamHlsLevel ?? null,
    hlsFragment: video.dataset.dstreamHlsFragment ?? null,
    timelinePinned:
      video.ownerDocument.querySelector('[data-testid="playback-timeline"]')?.getAttribute("data-live-edge-pinned") ?? null,
    timelineSlider: (() => {
      const slider = video.ownerDocument.querySelector('input[aria-label="Seek"]');
      if (!(slider instanceof HTMLInputElement)) return null;
      const value = Number(slider.value);
      const max = Number(slider.max);
      return Number.isFinite(value) && Number.isFinite(max) ? { value, max } : null;
    })(),
    playheadLeft: (() => {
      const playhead = video.ownerDocument.querySelector('[data-testid="playback-playhead"]');
      if (!(playhead instanceof HTMLElement)) return null;
      const value = Number.parseFloat(playhead.style.left);
      return Number.isFinite(value) ? value : null;
    })(),
    bufferedAhead: (() => {
      for (let index = 0; index < video.buffered.length; index++) {
        if (video.currentTime >= video.buffered.start(index) - 0.1 && video.currentTime <= video.buffered.end(index) + 0.1) {
          return Math.max(0, video.buffered.end(index) - video.currentTime);
        }
      }
      return 0;
    })()
  }));
}

async function setSyntheticVisibility(page, state) {
  await page.evaluate((nextState) => {
    const target = document;
    const stateKey = "__dstreamPlaybackSoakVisibility";
    Object.defineProperty(target, stateKey, { configurable: true, writable: true, value: nextState });
    if (!Object.prototype.hasOwnProperty.call(target, "visibilityState")) {
      Object.defineProperty(target, "visibilityState", {
        configurable: true,
        get: () => target[stateKey]
      });
      Object.defineProperty(target, "hidden", {
        configurable: true,
        get: () => target[stateKey] === "hidden"
      });
    }
    const probe = window.__dstreamPlaybackProbe;
    if (probe && Array.isArray(probe.visibilityTransitions)) {
      const at = Math.round(performance.now());
      probe.visibilityTransitions.push({ state: nextState, at });
      if (nextState === "visible" && probe.visibleAt === null) probe.visibleAt = at;
    }
    target.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function getPlaybackProbe(page) {
  return page.evaluate(() => {
    const probe = window.__dstreamPlaybackProbe;
    return {
      hiddenPlayRejected: probe?.hiddenPlayRejected === true,
      visibleAt: typeof probe?.visibleAt === "number" ? probe.visibleAt : null,
      playAttempts: Array.isArray(probe?.playAttempts) ? probe.playAttempts : [],
      gateTransitions: Array.isArray(probe?.gateTransitions) ? probe.gateTransitions : [],
      visibilityTransitions: Array.isArray(probe?.visibilityTransitions) ? probe.visibilityTransitions : []
    };
  });
}

async function waitForSyntheticHiddenPlayRejection(page, label) {
  if (!STUB_HIDDEN_PLAY_REJECTION) return;
  const deadline = Date.now() + Math.min(START_TIMEOUT_MS, 30_000);
  while (Date.now() < deadline) {
    const probe = await getPlaybackProbe(page);
    if (probe.hiddenPlayRejected) return;
    await page.waitForTimeout(100);
  }
  const probe = await getPlaybackProbe(page);
  fail(
    `${label}: synthetic hidden startup never reached a rejected play attempt ` +
      `(attempts=${JSON.stringify(probe.playAttempts)}, gate=${JSON.stringify(probe.gateTransitions)})`
  );
}

async function verifySyntheticHiddenRetry(page, label) {
  if (!STUB_HIDDEN_PLAY_REJECTION) return;
  const probe = await getPlaybackProbe(page);
  const rejected = probe.playAttempts.find((attempt) => attempt.syntheticRejected);
  if (!rejected) fail(`${label}: hidden-page play rejection was not exercised`);
  if (probe.visibleAt === null) fail(`${label}: synthetic visibility was never restored`);
  const visibleAttempts = probe.playAttempts.filter(
    (attempt) => attempt.at >= probe.visibleAt && !attempt.syntheticRejected
  );
  if (visibleAttempts.length === 0) {
    fail(
      `${label}: visibility restore did not trigger another play attempt ` +
        `(visibleAt=${probe.visibleAt}, attempts=${JSON.stringify(probe.playAttempts)})`
    );
  }
  if (!visibleAttempts.some((attempt) => typeof attempt.resolvedAt === "number")) {
    fail(`${label}: no post-visibility play attempt resolved (${JSON.stringify(visibleAttempts)})`);
  }
}

async function verifyStartupPlayOrdering(page, label) {
  if (DISABLE_STARTUP_PROBE) return;
  const probe = await getPlaybackProbe(page);
  const firstAttempt = probe.playAttempts[0];
  if (!firstAttempt) fail(`${label}: no media play() attempt was recorded`);

  const pendingAttempts = probe.playAttempts.filter((attempt) => attempt.startupGate === "pending");
  if (pendingAttempts.length > 0) {
    fail(`${label}: play() was called while the live startup gate was pending (${JSON.stringify(pendingAttempts)})`);
  }
  if (firstAttempt.startupGate !== "released") {
    fail(`${label}: first play() observed startup gate ${firstAttempt.startupGate}`);
  }
  if (firstAttempt.currentSrc.startsWith("blob:")) {
    const activeRange = firstAttempt.buffered.find(
      ([start, end]) => firstAttempt.currentTime >= start - 0.05 && firstAttempt.currentTime <= end + 0.05
    );
    if (!activeRange || activeRange[1] - firstAttempt.currentTime < 0.2) {
      fail(
        `${label}: HLS play() was called without a stable buffered target ` +
          `(current=${firstAttempt.currentTime}, buffered=${JSON.stringify(firstAttempt.buffered)})`
      );
    }
  }

  const pendingAt = firstAttempt.startupGatePendingAt;
  const releasedAt = firstAttempt.startupGateReleasedAt;
  if (pendingAt !== null && releasedAt === null) {
    fail(`${label}: startup gate entered pending state without a recorded release`);
  }
  if (releasedAt !== null && firstAttempt.at + 1 < releasedAt) {
    fail(
      `${label}: first play() preceded live startup gate release ` +
        `(play=${firstAttempt.at}, release=${releasedAt})`
    );
  }
  if (releasedAt !== null && firstAttempt.at - releasedAt > PLAY_AFTER_GATE_MAX_MS) {
    fail(
      `${label}: first play() was delayed ${firstAttempt.at - releasedAt}ms after live startup gate release ` +
        `(limit=${PLAY_AFTER_GATE_MAX_MS}ms)`
    );
  }

  if (typeof firstAttempt.startupSeekTo === "number") {
    if (Math.abs(firstAttempt.currentTime - firstAttempt.startupSeekTo) > 0.4) {
      fail(
        `${label}: first play() was not aligned to the selected live startup target ` +
          `(current=${firstAttempt.currentTime}, target=${firstAttempt.startupSeekTo})`
      );
    }
    const targetBuffered = firstAttempt.buffered.some(
      ([start, end]) => firstAttempt.startupSeekTo >= start - 0.1 && firstAttempt.startupSeekTo <= end + 0.1
    );
    if (!targetBuffered) {
      fail(
        `${label}: selected live startup target was outside buffered media ` +
          `(target=${firstAttempt.startupSeekTo}, buffered=${JSON.stringify(firstAttempt.buffered)})`
      );
    }
  }
}

async function verifyPrivateAllowlistedAccess(page, label) {
  if (!EXPECT_PRIVATE_ALLOWLISTED) return;
  const state = await page
    .locator('[data-testid="watch-layout-grid"]')
    .first()
    .getAttribute("data-private-live-access-state");
  if (state !== "issued") {
    fail(`${label}: expected issued private live access marker, received ${state ?? "missing"}`);
  }
}

async function verifyBackgroundResume(page, label) {
  const before = await sampleVideo(page);
  await setSyntheticVisibility(page, "hidden");
  await page.locator("video").first().evaluate((video) => video.pause());
  const deadline = Date.now() + Math.max(15_000, STALL_LIMIT_MS);
  let after = before;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2_000);
    after = await sampleVideo(page);
    const timeAdvanced = after.currentTime > before.currentTime + 0.25;
    const framesAdvanced = after.frames !== null && before.frames !== null && after.frames > before.frames;
    if (!after.paused && !after.ended && (timeAdvanced || framesAdvanced)) return;
  }
  fail(
    `${label}: background mode did not resume a hidden-page pause ` +
      `(time ${before.currentTime.toFixed(1)} -> ${after.currentTime.toFixed(1)}, paused=${after.paused}, ended=${after.ended}, ` +
      `ready=${after.readyState}, buffer=${after.bufferedAhead.toFixed(1)}, recovery=${after.recoveryReason ?? "none"})`
  );
}

async function startPlayback(page) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = "media did not start";
  while (Date.now() < deadline) {
    const result = await page.locator("video").first().evaluate((video) => {
      const startupGate = video.dataset.dstreamStartupGate ?? "unknown";
      const clickToPlayVisible = Array.from(video.ownerDocument.querySelectorAll("button")).some((button) => {
        if (!/^click to play$/i.test(button.textContent?.trim() ?? "")) return false;
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
      const privateGate = video.ownerDocument.querySelector('[data-testid="private-live-access-gate"]');
      return {
        playing: !video.paused && !video.ended && video.readyState >= 2,
        gateBypassed: startupGate === "pending" && !video.paused,
        startupGate,
        readyState: video.readyState,
        paused: video.paused,
        muted: video.muted,
        volume: Number(video.volume),
        clickToPlayVisible,
        privateGateVisible:
          privateGate instanceof HTMLElement &&
          privateGate.getBoundingClientRect().width > 0 &&
          privateGate.getBoundingClientRect().height > 0
      };
    });
    if (result.gateBypassed) {
      fail(`playback began while the startup buffer gate was pending (ready=${result.readyState})`);
    }
    if (result.privateGateVisible) {
      fail("private playback access gate remained visible before media startup");
    }
    if (EXPECT_MUTED_AUTOPLAY && result.clickToPlayVisible) {
      fail("click-to-play appeared before muted autoplay could start");
    }
    if (result.playing) return;
    lastError =
      `gate=${result.startupGate}, ready=${result.readyState}, paused=${result.paused}, ` +
      `muted=${result.muted}, volume=${result.volume}`;
    await page.waitForTimeout(100);
  }
  fail(`playback did not start within ${Math.round(START_TIMEOUT_MS / 1000)}s (${lastError})`);
}

async function verifyStartupAudioAndCenterClick(page, label) {
  const before = await sampleVideo(page);
  if (before.paused || before.ended || before.readyState < 2) {
    fail(
      `${label}: autoplay did not begin before a click ` +
        `(paused=${before.paused}, ended=${before.ended}, ready=${before.readyState})`
    );
  }

  if (!EXPECT_MUTED_AUTOPLAY) {
    if (before.muted || before.volume <= 0.01) {
      fail(`${label}: background startup lost audible intent (muted=${before.muted}, volume=${before.volume})`);
    }
    return;
  }

  if (!before.muted || before.volume !== 0) {
    fail(`${label}: expected muted autoplay (muted=${before.muted}, volume=${before.volume})`);
  }

  await page.waitForTimeout(1_500);
  const afterWait = await sampleVideo(page);
  const timeAdvanced = afterWait.currentTime > before.currentTime + 0.25;
  const framesAdvanced = afterWait.frames !== null && before.frames !== null && afterWait.frames > before.frames;
  if (!timeAdvanced && !framesAdvanced) {
    fail(
      `${label}: muted playback did not advance before a click ` +
        `(time ${before.currentTime.toFixed(2)} -> ${afterWait.currentTime.toFixed(2)}, ` +
        `frames ${before.frames ?? "n/a"} -> ${afterWait.frames ?? "n/a"})`
    );
  }

  const video = page.locator("video").first();
  const box = await video.boundingBox();
  if (!box) fail(`${label}: video had no visible bounds for center-click regression`);
  const eventBaseline = await video.evaluate(() =>
    Array.isArray(window.__dstreamPlaybackStartupEvents) ? window.__dstreamPlaybackStartupEvents.length : 0
  );
  await video.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.waitForTimeout(500);

  const afterClick = await sampleVideo(page);
  if (afterClick.paused || afterClick.ended) {
    fail(`${label}: center click paused playback instead of unmuting it`);
  }
  if (afterClick.muted || afterClick.volume <= 0.01) {
    fail(`${label}: center click did not unmute playback (muted=${afterClick.muted}, volume=${afterClick.volume})`);
  }

  await page.waitForTimeout(1_000);
  const afterClickWait = await sampleVideo(page);
  const postClickPauseEvents = await video.evaluate((media, baseline) => {
    const events = Array.isArray(window.__dstreamPlaybackStartupEvents) ? window.__dstreamPlaybackStartupEvents : [];
    return events.slice(baseline).filter((entry) => entry.event === "pause");
  }, eventBaseline);
  if (postClickPauseEvents.length > 0) {
    fail(`${label}: center click emitted a pause event (${JSON.stringify(postClickPauseEvents)})`);
  }
  const clickTimeAdvanced = afterClickWait.currentTime > afterClick.currentTime + 0.25;
  const clickFramesAdvanced =
    afterClickWait.frames !== null && afterClick.frames !== null && afterClickWait.frames > afterClick.frames;
  if (!clickTimeAdvanced && !clickFramesAdvanced) {
    fail(`${label}: playback did not keep advancing after center-click unmute`);
  }
}

async function observeStartupStability(page, label) {
  await page.waitForTimeout(STARTUP_STABILITY_MS);
  const result = await page.locator("video").first().evaluate((video, maxInterruptionMs) => {
    const events = Array.isArray(window.__dstreamPlaybackStartupEvents) ? window.__dstreamPlaybackStartupEvents : [];
    const firstPlaying = events.findIndex((entry) => entry.event === "playing");
    const readMetric = (value) => {
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    const playbackEvents = firstPlaying < 0 ? [] : events.slice(firstPlaying + 1);
    const interruptions = [];
    for (let index = 0; index < playbackEvents.length; index += 1) {
      const entry = playbackEvents[index];
      if (entry.event === "error") {
        interruptions.push({ ...entry, durationMs: null });
        continue;
      }
      if (entry.event !== "waiting" && entry.event !== "stalled") continue;
      const resumed = playbackEvents.slice(index + 1).find((candidate) => candidate.event === "playing");
      const durationMs = resumed ? resumed.at - entry.at : Number.POSITIVE_INFINITY;
      if (durationMs > maxInterruptionMs) interruptions.push({ ...entry, durationMs });
    }
    const fallbackVisual = document.querySelector('[data-testid="audio-fallback-visual"]');
    const fallbackArtwork = fallbackVisual?.querySelector("img");
    const fallbackRect = fallbackVisual?.getBoundingClientRect();
    const navigation = performance.getEntriesByType("navigation")[0];
    return {
      events,
      interruptions,
      timeOrigin: performance.timeOrigin,
      navigation:
        navigation instanceof PerformanceNavigationTiming
          ? {
              responseEnd: navigation.responseEnd,
              domContentLoaded: navigation.domContentLoadedEventEnd,
              loadEventEnd: navigation.loadEventEnd
            }
          : null,
      scriptResources: performance
        .getEntriesByType("resource")
        .filter((entry) => entry instanceof PerformanceResourceTiming && entry.name.includes("/_next/static/"))
        .map((entry) => ({
          name: entry.name.split("/").pop(),
          startTime: Math.round(entry.startTime),
          responseEnd: Math.round(entry.responseEnd),
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize,
          decodedBodySize: entry.decodedBodySize
        }))
        .sort((left, right) => left.responseEnd - right.responseEnd),
      longTasks: Array.isArray(window.__dstreamPlaybackLongTasks) ? window.__dstreamPlaybackLongTasks : [],
      sourceMode: video.dataset.dstreamSourceMode ?? "unknown",
      startupBuffer: Number(video.dataset.dstreamStartupBuffer),
      startupMs: firstPlaying < 0 ? null : events[firstPlaying].at,
      hlsLatency: readMetric(video.dataset.dstreamHlsLatency),
      hlsTargetLatency: readMetric(video.dataset.dstreamHlsTargetLatency),
      hlsLiveSyncPosition: readMetric(video.dataset.dstreamHlsLiveSyncPosition),
      startupGate: video.dataset.dstreamStartupGate ?? "unknown",
      startupRealignmentCount: Number(video.dataset.dstreamStartupRealignmentCount || 0),
      startupSeekMode: video.dataset.dstreamStartupSeekMode ?? null,
      startupSeekFrom: readMetric(video.dataset.dstreamStartupSeekFrom),
      startupSeekTo: readMetric(video.dataset.dstreamStartupSeekTo),
      currentTime: Number(video.currentTime.toFixed(3)),
      buffered: Array.from({ length: video.buffered.length }, (_, index) => [
        Number(video.buffered.start(index).toFixed(3)),
        Number(video.buffered.end(index).toFixed(3))
      ]),
      lastHlsError: video.dataset.dstreamLastHlsErrorDetail
        ? {
            type: video.dataset.dstreamLastHlsErrorType ?? null,
            detail: video.dataset.dstreamLastHlsErrorDetail,
            fatal: video.dataset.dstreamLastHlsErrorFatal ?? null
          }
        : null,
      fallbackVisualVisible: !!fallbackVisual && !!fallbackRect && fallbackRect.width > 0 && fallbackRect.height > 0,
      fallbackArtworkLoaded: fallbackArtwork instanceof HTMLImageElement && fallbackArtwork.complete && fallbackArtwork.naturalWidth > 0
    };
  }, MAX_STARTUP_INTERRUPTION_MS);
  if (result.interruptions.length > 0) {
    fail(
      `${label}: playback was interrupted during the startup stability window ` +
        `(interruptions=${JSON.stringify(result.interruptions)}, events=${JSON.stringify(result.events)})`
    );
  }
  if (result.startupGate !== "released") fail(`${label}: startup gate remained ${result.startupGate}`);
  if (EXPECTED_SOURCE_MODE && result.sourceMode !== EXPECTED_SOURCE_MODE) {
    fail(`${label}: expected source mode ${EXPECTED_SOURCE_MODE}, received ${result.sourceMode}`);
  }
  if (
    EXPECTED_SOURCE_MODE === "zap-audio-fallback" &&
    (!result.fallbackVisualVisible || !result.fallbackArtworkLoaded)
  ) {
    fail(
      `${label}: audio fallback visual is not ready ` +
        `(visible=${result.fallbackVisualVisible}, artwork=${result.fallbackArtworkLoaded})`
    );
  }
  return result;
}

async function findSoakPlaybackInterruption(page, eventBaseline, expectedMarker) {
  return page.evaluate(
    ({ baseline, maxDurationMs, marker }) => {
      const events = Array.isArray(window.__dstreamPlaybackStartupEvents) ? window.__dstreamPlaybackStartupEvents : [];
      const now = performance.now();
      for (let index = baseline; index < events.length; index += 1) {
        const event = events[index];
        if (event.marker !== marker) continue;
        if (event.event !== "waiting" && event.event !== "error") continue;
        const resumed = event.event === "waiting"
          ? events.slice(index + 1).find((candidate) => candidate.marker === marker && candidate.event === "playing")
          : null;
        const durationMs = event.event === "error" ? null : (resumed?.at ?? now) - event.at;
        if (event.event === "error" || durationMs > maxDurationMs) {
          return { event, durationMs, recent: events.slice(Math.max(baseline, index - 3), index + 4) };
        }
      }
      return null;
    },
    { baseline: eventBaseline, maxDurationMs: MAX_SOAK_INTERRUPTION_MS, marker: expectedMarker }
  );
}

async function openRun(context, scenario, stream, index) {
  const page = await context.newPage();
  let cpuSession = null;
  let cpuProfile = null;
  const stopCpuProfile = async () => {
    if (!cpuSession || cpuProfile) return cpuProfile;
    try {
      cpuProfile = (await cpuSession.send("Profiler.stop")).profile;
    } catch {
      cpuProfile = null;
    }
    return cpuProfile;
  };
  if (TRACE_CPU_PROFILE && scenario.startsWith("chromium")) {
    try {
      cpuSession = await context.newCDPSession(page);
      await cpuSession.send("Profiler.enable");
      await cpuSession.send("Profiler.setSamplingInterval", { interval: 500 });
      await cpuSession.send("Profiler.start");
    } catch {
      cpuSession = null;
    }
  }
  await page.addInitScript(() => {
    const preferenceKey = "dstream_player_background_play_v1";
    const writes = [];
    Object.defineProperty(window, "__dstreamPlaybackSoakPreferenceWrites", { value: writes, configurable: true });
    const longTasks = [];
    Object.defineProperty(window, "__dstreamPlaybackLongTasks", { value: longTasks, configurable: true });
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ startTime: Math.round(entry.startTime), duration: Math.round(entry.duration) });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task timing is not available in every browser.
    }
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === preferenceKey) {
        writes.push({ value: String(value), stack: new Error().stack ?? "" });
      }
      return originalSetItem.call(this, key, value);
    };
  });
  if (!DISABLE_STARTUP_PROBE) await page.addInitScript(
    ({ initialVisibility, stubHiddenPlayRejection, presetBackgroundPlay, identityStore }) => {
      if (presetBackgroundPlay) localStorage.setItem("dstream_player_background_play_v1", "1");
      if (identityStore) localStorage.setItem("dstream_identity_store_v2", JSON.stringify(identityStore));

      if (initialVisibility === "hidden") {
        const stateKey = "__dstreamPlaybackSoakVisibility";
        Object.defineProperty(document, stateKey, { configurable: true, writable: true, value: "hidden" });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => document[stateKey]
        });
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => document[stateKey] === "hidden"
        });
      }

      const probe = {
        hiddenPlayRejected: false,
        visibleAt: null,
        playAttempts: [],
        gateTransitions: [],
        visibilityTransitions: [],
        mediaEvents: []
      };
      Object.defineProperty(window, "__dstreamPlaybackProbe", { configurable: true, value: probe });

      const recordMediaEvent = (video, event) => {
        probe.mediaEvents.push({
          event,
          at: Math.round(performance.now()),
          currentTime: Number(video.currentTime.toFixed(3)),
          readyState: video.readyState,
          paused: video.paused,
          startupGate: video.dataset.dstreamStartupGate ?? "unknown",
          sourceMode: video.dataset.dstreamSourceMode ?? "unknown",
          marker: video.dataset.playbackSoakIdentity ?? null,
          hlsLevel: video.dataset.dstreamHlsLevel ?? null,
          hlsFragment: video.dataset.dstreamHlsFragment ?? null,
          hlsLatency: video.dataset.dstreamHlsLatency ?? null,
          hlsTargetLatency: video.dataset.dstreamHlsTargetLatency ?? null,
          fallbackReason: video.dataset.dstreamAudioFallbackReason ?? null,
          buffered: Array.from({ length: video.buffered.length }, (_, rangeIndex) => [
            Number(video.buffered.start(rangeIndex).toFixed(3)),
            Number(video.buffered.end(rangeIndex).toFixed(3))
          ])
        });
      };

      const attached = new WeakSet();
      const attachVideoProbe = (video) => {
        if (attached.has(video)) return;
        attached.add(video);
        for (const event of ["play", "playing", "pause", "waiting", "stalled", "error"]) {
          video.addEventListener(event, () => recordMediaEvent(video, event));
        }
        recordMediaEvent(video, "observed");
      };

      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function dstreamInstrumentedPlay(...args) {
        attachVideoProbe(this);
        const startupSeekToValue = Number(this.dataset?.dstreamStartupSeekTo);
        const startupGatePendingAtValue = Number(this.dataset?.dstreamStartupGatePendingAt);
        const startupGateReleasedAtValue = Number(this.dataset?.dstreamStartupGateReleasedAt);
        const attempt = {
          at: Math.round(performance.now()),
          hidden: document.hidden || document.visibilityState === "hidden",
          muted: this.muted,
          volume: Number(this.volume),
          startupGate: this.dataset?.dstreamStartupGate ?? "unknown",
          startupGatePendingAt: Number.isFinite(startupGatePendingAtValue) ? startupGatePendingAtValue : null,
          startupGateReleasedAt: Number.isFinite(startupGateReleasedAtValue) ? startupGateReleasedAtValue : null,
          startupSeekMode: this.dataset?.dstreamStartupSeekMode ?? null,
          startupSeekTo: Number.isFinite(startupSeekToValue) ? startupSeekToValue : null,
          currentTime: Number(this.currentTime.toFixed(3)),
          currentSrc: this.currentSrc || this.src || "",
          buffered: Array.from({ length: this.buffered.length }, (_, rangeIndex) => [
            Number(this.buffered.start(rangeIndex).toFixed(3)),
            Number(this.buffered.end(rangeIndex).toFixed(3))
          ]),
          syntheticRejected: false
        };
        probe.playAttempts.push(attempt);
        if (stubHiddenPlayRejection && !probe.hiddenPlayRejected && attempt.hidden) {
          probe.hiddenPlayRejected = true;
          attempt.syntheticRejected = true;
          attempt.rejectedAt = Math.round(performance.now());
          attempt.rejectName = "NotAllowedError";
          return Promise.reject(new DOMException("Synthetic hidden play rejection", "NotAllowedError"));
        }
        try {
          const result = originalPlay.apply(this, args);
          Promise.resolve(result).then(
            () => {
              attempt.resolvedAt = Math.round(performance.now());
            },
            (error) => {
              attempt.rejectedAt = Math.round(performance.now());
              attempt.rejectName = error instanceof Error ? error.name : "Error";
            }
          );
          return result;
        } catch (error) {
          attempt.rejectedAt = Math.round(performance.now());
          attempt.rejectName = error instanceof Error ? error.name : "Error";
          throw error;
        }
      };
    },
    {
      initialVisibility: INITIAL_VISIBILITY,
      stubHiddenPlayRejection: STUB_HIDDEN_PLAY_REJECTION,
      presetBackgroundPlay: PRESET_BACKGROUND_PLAY,
      identityStore: IDENTITY_STORE_FIXTURE
    }
  );
  const diagnostics = { errors: [], relayErrors: 0, relayMessages: [], hlsResponses: [] };
  const hlsRequestStartedAt = new WeakMap();
  const hlsResourceKind = (rawUrl) => {
    try {
      const pathname = new URL(rawUrl).pathname;
      if (/\.m3u8$/i.test(pathname)) return "playlist";
      if (/\.(?:m4s|mp4|ts|aac)$/i.test(pathname)) return "fragment";
    } catch {
      // Ignore malformed diagnostic URLs.
    }
    return null;
  };
  const title = String(stream.title || stream.streamId);
  page.on("pageerror", (error) => diagnostics.errors.push(error.stack || error.message));
  page.on("request", (request) => {
    if (!TRACE_HLS_RESPONSES) return;
    if (hlsResourceKind(request.url())) hlsRequestStartedAt.set(request, Date.now());
  });
  page.on("response", (response) => {
    if (!TRACE_HLS_RESPONSES) return;
    const resourceKind = hlsResourceKind(response.url());
    if (!resourceKind) return;
    void (async () => {
      const headersAt = Date.now();
      const requestStartedAt = hlsRequestStartedAt.get(response.request()) ?? null;
      const isPlaylist = resourceKind === "playlist";
      const body = isPlaylist
        ? await response.text().catch(() => "")
        : await response.finished().then(() => "", () => "");
      const completedAt = Date.now();
      const headers = response.headers();
      const sequence = Number(body.match(/^#EXT-X-MEDIA-SEQUENCE\s*:\s*(\d+)/m)?.[1]);
      const programDates = Array.from(body.matchAll(/^#EXT-X-PROGRAM-DATE-TIME\s*:\s*(.+)\s*$/gm))
        .map((match) => Date.parse(match[1] ?? ""))
        .filter(Number.isFinite);
      const variants = body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      diagnostics.hlsResponses.push({
        requestStartedAt,
        headersAt,
        completedAt,
        headersMs: requestStartedAt === null ? null : headersAt - requestStartedAt,
        durationMs: requestStartedAt === null ? null : completedAt - requestStartedAt,
        resource: resourceKind,
        status: response.status(),
        url: response.url(),
        contentLength: Number(headers["content-length"]) || null,
        contentType: headers["content-type"] ?? null,
        mediaSequence: Number.isSafeInteger(sequence) ? sequence : null,
        segmentCount: body.match(/^#EXTINF\s*:/gm)?.length ?? 0,
        lastProgramDateTime: programDates.length > 0 ? Math.max(...programDates) : null,
        variants: body.includes("#EXT-X-STREAM-INF") ? variants : []
      });
      if (diagnostics.hlsResponses.length > 120) diagnostics.hlsResponses.shift();
    })();
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/hydration|server rendered html|did not match|react error #418/i.test(text)) diagnostics.errors.push(text);
    if (/websocket|establish a connection|wss:\/\//i.test(text)) {
      diagnostics.relayErrors += 1;
      if (diagnostics.relayMessages.length < 8) diagnostics.relayMessages.push(text);
    }
  });
  let marker = "";
  let playbackEventBaseline = 0;
  const background = PRESET_BACKGROUND_PLAY || scenario === "chromium-mobile";
  let startupStage = "navigate";
  try {
    await page.goto(watchUrl(stream), { waitUntil: "domcontentloaded", timeout: START_TIMEOUT_MS });
    startupStage = "wait for video";
    await page.locator("video").first().waitFor({ state: "attached", timeout: START_TIMEOUT_MS });
    startupStage = "bind startup events";
    await page.locator("video").first().evaluate((video) => {
      const probedEvents = window.__dstreamPlaybackProbe?.mediaEvents;
      if (Array.isArray(probedEvents)) {
        window.__dstreamPlaybackStartupEvents = probedEvents;
        return;
      }
      const events = [];
      window.__dstreamPlaybackStartupEvents = events;
      const record = (event) => {
        events.push({
          event,
          at: Math.round(performance.now()),
          currentTime: Number(video.currentTime.toFixed(3)),
          readyState: video.readyState,
          paused: video.paused,
          startupGate: video.dataset.dstreamStartupGate ?? "unknown",
          buffered: []
        });
      };
      for (const event of ["play", "playing", "pause", "waiting", "stalled", "error"]) {
        video.addEventListener(event, () => record(event));
      }
      record("observed");
    });
    marker = `${scenario}-${index}-${Date.now()}`;
    startupStage = "mark player identity";
    await page.locator("video").first().evaluate((video, identity) => {
      video.dataset.playbackSoakIdentity = identity;
    }, marker);
    if (INITIAL_VISIBILITY === "hidden") {
      startupStage = "wait for hidden startup rejection";
      await waitForSyntheticHiddenPlayRejection(page, `${scenario}/${title}`);
      startupStage = "restore visibility";
      await setSyntheticVisibility(page, "visible");
    }
    startupStage = "wait for playback";
    await startPlayback(page);
    startupStage = "verify startup play ordering";
    await verifyStartupPlayOrdering(page, `${scenario}/${title}`);
    startupStage = "verify hidden startup retry";
    await verifySyntheticHiddenRetry(page, `${scenario}/${title}`);
    startupStage = "verify private access";
    await verifyPrivateAllowlistedAccess(page, `${scenario}/${title}`);
    startupStage = "verify startup audio";
    await verifyStartupAudioAndCenterClick(page, `${scenario}/${title}`);
    startupStage = "observe startup stability";
    const startup = await observeStartupStability(page, `${scenario}/${title}`);
    playbackEventBaseline = startup.events.length;
    const cpuHotspots = summarizeCpuProfile(await stopCpuProfile());
    console.log(
      `  startup ${scenario} / ${title}: mode=${startup.sourceMode}, ` +
        `startup=${startup.startupMs === null ? "n/a" : (startup.startupMs / 1_000).toFixed(2)}s, ` +
        `latency=${startup.hlsLatency === null ? "n/a" : startup.hlsLatency.toFixed(2)}s, ` +
        `target=${startup.hlsTargetLatency === null ? "n/a" : startup.hlsTargetLatency.toFixed(2)}s, ` +
        `buffer=${Number.isFinite(startup.startupBuffer) ? startup.startupBuffer.toFixed(1) : "n/a"}s, ` +
        `events=${startup.events.map((entry) => entry.event).join(",")}`
    );
    if (TRACE_HLS_RESPONSES) {
      console.log(
        `  HLS trace ${scenario} / ${title}: ` +
          JSON.stringify({
            timeOrigin: startup.timeOrigin,
            navigation: startup.navigation,
            scriptResources: startup.scriptResources,
            longTasks: startup.longTasks,
            cpuHotspots,
            playback: {
              currentTime: startup.currentTime,
              buffered: startup.buffered,
              liveSyncPosition: startup.hlsLiveSyncPosition,
              latency: startup.hlsLatency,
              targetLatency: startup.hlsTargetLatency,
              startupRealignmentCount: startup.startupRealignmentCount,
              startupSeekMode: startup.startupSeekMode,
              startupSeekFrom: startup.startupSeekFrom,
              startupSeekTo: startup.startupSeekTo,
              lastHlsError: startup.lastHlsError
            },
            responses: compactHlsResponses(diagnostics.hlsResponses)
          })
      );
    }
    if (background) {
      const toggle = page.getByTitle("Keep audio playing when the app is backgrounded");
      await toggle.waitFor({ state: "attached", timeout: START_TIMEOUT_MS });
      const preferenceBeforeToggle = await page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1"));
      const toggleBefore = (await toggle.textContent()) ?? "";
      if (/off/i.test(toggleBefore)) {
        const video = page.locator("video").first();
        let clicked = false;
        const interactionDiagnostics = [];
        for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
          let state = await toggle.evaluate((button) => {
            const controls = button.closest('[data-testid="player-controls"]');
            const rect = button.getBoundingClientRect();
            return {
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              pointerEvents: getComputedStyle(button).pointerEvents,
              controlsOpacity: controls instanceof HTMLElement ? getComputedStyle(controls).opacity : null,
              controlsPointerEvents: controls instanceof HTMLElement ? getComputedStyle(controls).pointerEvents : null
            };
          });
          if (state.pointerEvents === "none" || state.controlsPointerEvents === "none" || state.controlsOpacity === "0") {
            await video.tap({ position: { x: 20, y: 20 } });
            await page.waitForTimeout(250);
            state = await toggle.evaluate((button) => {
              const controls = button.closest('[data-testid="player-controls"]');
              const rect = button.getBoundingClientRect();
              return {
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                pointerEvents: getComputedStyle(button).pointerEvents,
                controlsOpacity: controls instanceof HTMLElement ? getComputedStyle(controls).opacity : null,
                controlsPointerEvents: controls instanceof HTMLElement ? getComputedStyle(controls).pointerEvents : null
              };
            });
          }
          clicked = await page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1") === "1");
          if (clicked) break;
          let tapError = "";
          await toggle.tap({ timeout: 5_000 }).catch((error) => {
            tapError = error instanceof Error ? error.message : String(error);
          });
          const preferenceDeadline = Date.now() + 2_000;
          while (!clicked && Date.now() < preferenceDeadline) {
            clicked = await page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1") === "1");
            if (!clicked) await page.waitForTimeout(100);
          }
          interactionDiagnostics.push({ attempt: attempt + 1, state, tapError: tapError.slice(0, 1_000), clicked });
        }
        if (!clicked) {
          fail(
            `${scenario}/${title}: could not activate the visible background playback control; ` +
              `interactions=${JSON.stringify(interactionDiagnostics)}`
          );
        }
      }
      await page.waitForTimeout(750);
      const preferenceEnabled = await page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1") === "1");
      if (!preferenceEnabled) {
        fail(
          `${scenario}/${title}: background preference was not saved by the user toggle ` +
            `(button ${JSON.stringify(toggleBefore)} -> ${JSON.stringify((await toggle.textContent()) ?? "")}, ` +
            `storage ${preferenceBeforeToggle ?? "null"} -> ${await page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1")) ?? "null"})`
        );
      }
      await verifyBackgroundResume(page, `${scenario}/${title}`);
      const preferenceAfterRecovery = await page.evaluate(
        () => localStorage.getItem("dstream_player_background_play_v1") === "1"
      );
      if (!preferenceAfterRecovery) fail(`${scenario}/${title}: background preference was lost during hidden-page recovery`);
    }
  } catch (error) {
    const cpuHotspots = summarizeCpuProfile(await stopCpuProfile());
    const pageText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    const preferenceWrites = await page
      .evaluate(() => window.__dstreamPlaybackSoakPreferenceWrites ?? [])
      .catch(() => []);
    const performanceDiagnostics = await page
      .evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        return {
          navigation:
            navigation instanceof PerformanceNavigationTiming
              ? {
                  responseEnd: Math.round(navigation.responseEnd),
                  domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
                  loadEventEnd: Math.round(navigation.loadEventEnd)
                }
              : null,
          longTasks: Array.isArray(window.__dstreamPlaybackLongTasks) ? window.__dstreamPlaybackLongTasks : []
        };
      })
      .catch(() => null);
    const reason = error instanceof Error ? error.message : String(error);
    fail(
      `${scenario}/${title}: startup failed at ${page.url()} (${reason}); ` +
        `stage: ${startupStage}; ` +
        `page errors: ${diagnostics.errors.join(" | ") || "none"}; ` +
        `performance: ${JSON.stringify(performanceDiagnostics)}; CPU: ${JSON.stringify(cpuHotspots)}; ` +
        `HLS trace: ${JSON.stringify(diagnostics.hlsResponses).slice(0, 12_000)}; ` +
        `preference writes: ${JSON.stringify(preferenceWrites).slice(0, 2_000)}; ` +
        `body: ${pageText.replace(/\s+/g, " ").slice(0, 500)}`
    );
  }
  const last = await sampleVideo(page);
  return {
    page,
    scenario,
    title,
    marker,
    diagnostics,
    last,
    lastSampledAt: Date.now(),
    playbackEventBaseline,
    samples: [],
    lastProgressAt: Date.now(),
    startedAt: Date.now(),
    background,
    routed: false,
    routeHandoffAt: null,
    sourceTimelineEpochChanges: 0
  };
}

async function verifyRouteHandoff(run) {
  if (run.background) await setSyntheticVisibility(run.page, "visible");
  const routeStartedAt = Date.now();
  run.routeHandoffAt = await run.page.evaluate(() => Math.round(performance.now()));
  const preferenceBeforeRoute = run.background
    ? await run.page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1"))
    : null;
  if (!run.scenario.includes("mobile")) {
    await run.page.locator("video").first().evaluate((video) => {
      video.volume = 0.65;
      video.muted = false;
    });
    await run.page.waitForTimeout(100);
  }
  const before = await sampleVideo(run.page);
  if (!run.scenario.includes("mobile") && (before.muted || before.volume === 0)) {
    fail(`${run.scenario}/${run.title}: could not establish audible playback before route handoff`);
  }
  const homeLink = run.page.locator('a[href="/"]').first();
  await homeLink.click();
  await run.page.waitForURL(`${BASE_URL}/`, { timeout: 20_000 });
  await run.page.locator("video").first().waitFor({ state: "attached", timeout: 20_000 });
  const miniPlayer = run.page.getByLabel("Floating mini player");
  await miniPlayer.waitFor({ state: "visible", timeout: 20_000 });
  await run.page.waitForTimeout(3_000);
  const activeThumbnailCaptures = await run.page.locator('[data-live-preview-state="loading-frame"]').count();
  if (activeThumbnailCaptures > 0) {
    fail(
      `${run.scenario}/${run.title}: ${activeThumbnailCaptures} live thumbnail capture(s) competed with mini-player playback`
    );
  }
  let after = await sampleVideo(run.page);
  if (after.marker !== run.marker) fail(`${run.scenario}/${run.title}: player DOM was remounted during route handoff`);
  if (after.currentTime + 10 < before.currentTime) {
    const routeElapsedSeconds = (Date.now() - routeStartedAt) / 1000;
    const programDateDelta =
      after.programDateTime !== null && before.programDateTime !== null
        ? (after.programDateTime - before.programDateTime) / 1000
        : null;
    const sourceAdvanced =
      (after.frames !== null && before.frames !== null && after.frames > before.frames) ||
      (after.hlsFragment !== null && before.hlsFragment !== null && after.hlsFragment !== before.hlsFragment);
    const upstreamTimelineEpochChanged =
      programDateDelta !== null &&
      programDateDelta >= -2 &&
      programDateDelta <= routeElapsedSeconds + 5 &&
      sourceAdvanced;
    if (upstreamTimelineEpochChanged) {
      run.sourceTimelineEpochChanges += 1;
    } else {
      fail(
        `${run.scenario}/${run.title}: timeline reset during route handoff (${before.currentTime.toFixed(1)} -> ${after.currentTime.toFixed(1)}); ` +
          `program-date delta=${programDateDelta?.toFixed(1) ?? "n/a"}s; ` +
          `session ${before.session ?? "n/a"} -> ${after.session ?? "n/a"}; ` +
          `signature ${before.signature ?? "n/a"} -> ${after.signature ?? "n/a"}; recovery=${after.recoveryReason ?? "none"}`
      );
    }
  }
  if (after.paused || after.ended) fail(`${run.scenario}/${run.title}: playback stopped during route handoff`);
  if (after.muted !== before.muted || Math.abs(after.volume - before.volume) > 0.01) {
    fail(
      `${run.scenario}/${run.title}: audio state changed during route handoff ` +
        `(muted ${before.muted} -> ${after.muted}, volume ${before.volume.toFixed(2)} -> ${after.volume.toFixed(2)})`
    );
  }

  await verifyMiniPlayerDragAlignment(run, miniPlayer);
  await verifyMiniPlayerAtFooter(run, miniPlayer);

  await miniPlayer.hover();
  const pauseButton = miniPlayer.getByRole("button", { name: "Pause", exact: true });
  await pauseButton.waitFor({ state: "visible", timeout: 5_000 });
  await pauseButton.click();
  await run.page
    .waitForFunction(() => document.querySelector("video")?.paused === true, null, { timeout: 5_000 })
    .catch(() => fail(`${run.scenario}/${run.title}: mini-player pause control did not pause media`));

  const playButton = miniPlayer.getByRole("button", { name: "Play", exact: true });
  await playButton.waitFor({ state: "visible", timeout: 5_000 });
  await playButton.click();
  await run.page
    .waitForFunction(() => document.querySelector("video")?.paused === false, null, { timeout: 5_000 })
    .catch(() => fail(`${run.scenario}/${run.title}: mini-player play control did not resume media`));

  const mutedBefore = await run.page.locator("video").first().evaluate((video) => video.muted || video.volume === 0);
  const volumeButton = miniPlayer.getByRole("button", { name: mutedBefore ? "Unmute" : "Mute", exact: true });
  await volumeButton.click();
  await run.page
    .waitForFunction(
      (wasMuted) => {
        const video = document.querySelector("video");
        return !!video && (video.muted || video.volume === 0) !== wasMuted;
      },
      mutedBefore,
      { timeout: 5_000 }
    )
    .catch(() => fail(`${run.scenario}/${run.title}: mini-player volume control did not toggle mute`));
  await miniPlayer.getByRole("button", { name: mutedBefore ? "Mute" : "Unmute", exact: true }).click();
  await run.page
    .waitForFunction(
      (wasMuted) => {
        const video = document.querySelector("video");
        return !!video && (video.muted || video.volume === 0) === wasMuted;
      },
      mutedBefore,
      { timeout: 5_000 }
    )
    .catch(() => fail(`${run.scenario}/${run.title}: mini-player volume control did not restore mute state`));

  if (run.background) {
    const preferenceEnabled = await run.page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1") === "1");
    if (!preferenceEnabled) {
      fail(
        `${run.scenario}/${run.title}: background preference was lost during route handoff ` +
          `(before=${preferenceBeforeRoute ?? "null"}, after=${await run.page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1")) ?? "null"})`
      );
    }
    await verifyBackgroundResume(run.page, `${run.scenario}/${run.title} after route handoff`);
  }
  after = await sampleVideo(run.page);
  run.routed = true;
  run.last = after;
  run.lastSampledAt = Date.now();
  run.lastProgressAt = Date.now();
}

async function verifyMiniPlayerAtFooter(run, miniPlayer) {
  const footer = run.page.locator("#global-site-footer");
  await footer.scrollIntoViewIfNeeded();
  await run.page.waitForTimeout(400);

  const state = await run.page.evaluate(() => {
    const dock = document.querySelector('[aria-label="Floating mini player"]');
    const slot = document.querySelector('[data-player-slot="quickplay-dock"]');
    const host = document.querySelector("[data-global-player-host]");
    const footerElement = document.querySelector("#global-site-footer");
    const video = host?.querySelector("video");
    if (!(dock instanceof HTMLElement) || !(slot instanceof HTMLElement) || !(host instanceof HTMLElement) || !(footerElement instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) {
      return null;
    }

    const dockRect = dock.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const footerRect = footerElement.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
    const sampleX = dockRect.left + dockRect.width / 2;
    const sampleY = dockRect.top + dockRect.height / 2;
    const previousPointerEvents = host.style.pointerEvents;
    let paintStack;
    try {
      host.style.pointerEvents = "auto";
      paintStack = document.elementsFromPoint(sampleX, sampleY);
    } finally {
      host.style.pointerEvents = previousPointerEvents;
    }
    const videoSurfaceIndex = paintStack.findIndex((element) => host.contains(element));
    const footerIndex = paintStack.findIndex((element) => footerElement.contains(element));

    return {
      footerVisible: footerRect.bottom > viewportTop && footerRect.top < viewportBottom,
      fullyVisible:
        dockRect.left >= viewportLeft - 2 &&
        dockRect.top >= viewportTop - 2 &&
        dockRect.right <= viewportRight + 2 &&
        dockRect.bottom <= viewportBottom + 2,
      alignment: Math.max(
        Math.abs(slotRect.left - hostRect.left),
        Math.abs(slotRect.top - hostRect.top),
        Math.abs(slotRect.width - hostRect.width),
        Math.abs(slotRect.height - hostRect.height)
      ),
      videoAboveFooter: videoSurfaceIndex >= 0 && (footerIndex < 0 || videoSurfaceIndex < footerIndex),
      paused: video.paused,
      ended: video.ended,
      readyState: video.readyState
    };
  });

  if (!state) fail(`${run.scenario}/${run.title}: footer mini-player elements are missing`);
  if (!state.footerVisible) fail(`${run.scenario}/${run.title}: footer was not visible during mini-player validation`);
  if (!state.fullyVisible) fail(`${run.scenario}/${run.title}: mini-player escaped the usable viewport at the footer`);
  if (state.alignment > 1.5) fail(`${run.scenario}/${run.title}: video host detached from mini-player at the footer (${state.alignment}px)`);
  if (!state.videoAboveFooter) fail(`${run.scenario}/${run.title}: footer painted over the mini-player video`);
  if (state.paused || state.ended || state.readyState < 2) {
    fail(`${run.scenario}/${run.title}: footer mini-player was not actively playing (${JSON.stringify(state)})`);
  }

  const box = await miniPlayer.boundingBox();
  if (!box) fail(`${run.scenario}/${run.title}: footer mini-player has no visible bounds`);
}

async function verifyMiniPlayerDragAlignment(run, miniPlayer) {
  if (run.scenario.includes("mobile")) return;
  const box = await miniPlayer.boundingBox();
  if (!box) fail(`${run.scenario}/${run.title}: mini-player has no drag bounds`);

  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const destinations = [
    { x: Math.max(80, start.x - 140), y: Math.max(80, start.y - 90) },
    { x: Math.min(1100, start.x + 100), y: Math.max(80, start.y - 150) },
    { x: Math.max(80, start.x - 60), y: Math.min(650, start.y + 30) }
  ];

  await run.page.mouse.move(start.x, start.y);
  await run.page.mouse.down();
  try {
    for (const destination of destinations) {
      await run.page.mouse.move(destination.x, destination.y, { steps: 1 });
      const alignment = await run.page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => {
              const slot = document.querySelector('[data-player-slot="quickplay-dock"]');
              const host = document.querySelector("[data-global-player-host]");
              if (!(slot instanceof HTMLElement) || !(host instanceof HTMLElement)) {
                resolve(null);
                return;
              }
              const slotRect = slot.getBoundingClientRect();
              const hostRect = host.getBoundingClientRect();
              resolve({
                left: Math.abs(slotRect.left - hostRect.left),
                top: Math.abs(slotRect.top - hostRect.top),
                width: Math.abs(slotRect.width - hostRect.width),
                height: Math.abs(slotRect.height - hostRect.height)
              });
            });
          })
      );
      if (!alignment || Math.max(alignment.left, alignment.top, alignment.width, alignment.height) > 1.5) {
        fail(`${run.scenario}/${run.title}: video host lagged behind mini-player drag (${JSON.stringify(alignment)})`);
      }
    }
  } finally {
    await run.page.mouse.up();
  }
}

async function verifyMiniPlayerClose(run) {
  const miniPlayer = run.page.getByLabel("Floating mini player");
  await miniPlayer.hover();
  await miniPlayer.getByRole("button", { name: "Close mini player", exact: true }).click();
  await miniPlayer.waitFor({ state: "detached", timeout: 5_000 });
  await run.page
    .waitForFunction(
      () =>
        document.querySelector("[data-global-player-host] video") === null &&
        localStorage.getItem("dstream_quick_play_stream_v1") === null,
      null,
      { timeout: 5_000 }
    )
    .catch(() => fail(`${run.scenario}/${run.title}: closing mini-player did not tear down media and storage`));
}

async function verifyNoColdMiniPlayerRestore(run) {
  await run.page.evaluate(() => {
    localStorage.setItem(
      "dstream_quick_play_stream_v1",
      JSON.stringify({
        data: {
          streamPubkey: "0".repeat(64),
          streamId: "stale-mini-player",
          title: "Stale mini player",
          hlsUrl: "https://example.invalid/stale.m3u8"
        },
        savedAt: Date.now()
      })
    );
  });
  await run.page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
  await run.page
    .waitForFunction(() => localStorage.getItem("dstream_quick_play_stream_v1") === null, null, { timeout: 5_000 })
    .catch(() => fail(`${run.scenario}/${run.title}: cold load retained stale mini-player storage`));
  if ((await run.page.getByLabel("Floating mini player").count()) > 0) {
    fail(`${run.scenario}/${run.title}: cold load restored a stale mini-player`);
  }
  if ((await run.page.locator("[data-global-player-host] video").count()) > 0) {
    fail(`${run.scenario}/${run.title}: cold load restored stale mini-player media`);
  }
}

async function main() {
  if (EXPECT_PRIVATE_ALLOWLISTED && !IDENTITY_STORE_FIXTURE) {
    fail("PLAYBACK_EXPECT_PRIVATE_ALLOWLISTED=1 requires PLAYBACK_IDENTITY_STORE_JSON");
  }
  if (STUB_HIDDEN_PLAY_REJECTION && INITIAL_VISIBILITY !== "hidden") {
    fail("PLAYBACK_STUB_HIDDEN_PLAY_REJECTION=1 requires PLAYBACK_INITIAL_VISIBILITY=hidden");
  }
  const sources = await loadSources();
  const browserEntries = [];
  const runs = [];
  console.log(`production playback soak: ${BASE_URL}, ${Math.round(SOAK_MS / 1000)}s, ${sources.length} sources`);
  for (const source of sources) console.log(`  source: ${String(source.title || source.streamId)} (${source.streaming})`);

  try {
    const needsChromium = REQUESTED_SCENARIOS.has("chromium-desktop") || REQUESTED_SCENARIOS.has("chromium-mobile");
    if (needsChromium) {
      const chromiumBrowser = await launchChromium();
      browserEntries.push(chromiumBrowser);
      if (REQUESTED_SCENARIOS.has("chromium-desktop")) {
        const chromiumDesktop = await chromiumBrowser.newContext({ viewport: { width: 1440, height: 900 } });
        for (let index = 0; index < sources.length; index++) {
          runs.push(await openRun(chromiumDesktop, "chromium-desktop", sources[index], index));
        }
      }
      if (REQUESTED_SCENARIOS.has("chromium-mobile")) {
        const chromiumMobile = await chromiumBrowser.newContext({ ...devices["Pixel 5"] });
        for (let index = 0; index < sources.length; index++) {
          runs.push(await openRun(chromiumMobile, "chromium-mobile", sources[index], index));
        }
      }
    }

    if (REQUESTED_SCENARIOS.has("firefox-desktop")) {
      const firefoxBrowser = await launchFirefox();
      browserEntries.push(firefoxBrowser);
      const firefoxDesktop = await firefoxBrowser.newContext({ viewport: { width: 1440, height: 900 } });
      for (let index = 0; index < sources.length; index++) {
        runs.push(await openRun(firefoxDesktop, "firefox-desktop", sources[index], index));
      }
    }

    if (runs.length === 0) fail("no valid playback scenarios selected");
    if (STARTUP_ONLY) {
      for (const run of runs) {
        console.log(`  PASS ${run.scenario} / ${run.title}: startup policy and playback retry`);
      }
      console.log("PASS: production playback startup checks complete");
      return;
    }
    for (const run of runs) {
      run.last = await sampleVideo(run.page);
      run.lastSampledAt = Date.now();
      run.lastProgressAt = Date.now();
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < SOAK_MS) {
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
      for (const run of runs) {
        const sampledAt = Date.now();
        const next = await sampleVideo(run.page).catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          fail(`${run.scenario}/${run.title}: browser stopped responding while sampling ${run.routed ? "after" : "before"} route handoff (${reason})`);
        });
        next.at = Math.round((Date.now() - run.startedAt) / 1000);
        run.samples.push(next);
        if (run.samples.length > 12) run.samples.shift();
        const interruption = await findSoakPlaybackInterruption(run.page, run.playbackEventBaseline, run.marker);
        if (interruption) {
          const recentLongTasks = await run.page
            .evaluate(() =>
              Array.isArray(window.__dstreamPlaybackLongTasks)
                ? window.__dstreamPlaybackLongTasks.slice(-30)
                : []
            )
            .catch(() => []);
          const runtimeTrace = JSON.stringify({
            routeHandoffAt: run.routeHandoffAt,
            recentLongTasks,
            responses: TRACE_HLS_RESPONSES
              ? compactHlsResponses(run.diagnostics.hlsResponses.slice(-30))
              : []
          });
          fail(
            `${run.scenario}/${run.title}: playback interruption exceeded ${MAX_SOAK_INTERRUPTION_MS}ms ` +
              `(${JSON.stringify(interruption)}; ${runDetails(run, next)}; runtime=${runtimeTrace})`
          );
        }
        const timeAdvanced = next.currentTime > run.last.currentTime + 0.25;
        const framesAdvanced = next.frames !== null && run.last.frames !== null && next.frames > run.last.frames;
        const elapsedSeconds = Math.max(0, (sampledAt - run.lastSampledAt) / 1000);
        const mediaDelta = next.currentTime - run.last.currentTime;
        const programDateDelta =
          next.programDateTime !== null && run.last.programDateTime !== null
            ? (next.programDateTime - run.last.programDateTime) / 1000
            : null;
        const contentTimelineContinuous =
          programDateDelta !== null && programDateDelta >= -2 && programDateDelta <= elapsedSeconds + 4;
        const sourceFragmentAdvancedWhileHidden =
          run.background &&
          timeAdvanced &&
          next.hlsFragment !== null &&
          run.last.hlsFragment !== null &&
          next.hlsFragment !== run.last.hlsFragment;
        const sourceTimelineAdvanced = framesAdvanced || sourceFragmentAdvancedWhileHidden;
        if (timeAdvanced || framesAdvanced) run.lastProgressAt = Date.now();
        if (next.ended) fail(`${run.scenario}/${run.title}: live media entered ended state (${runDetails(run, next)})`);
        if (run.last.session && next.session && run.last.session !== next.session) {
          fail(
            `${run.scenario}/${run.title}: playback session rebuilt unexpectedly ` +
              `(${run.last.session} -> ${next.session}, recovery=${next.recoveryReason ?? "none"}; ${runDetails(run, next)})`
          );
        }
        if (mediaDelta < -2) {
          if (contentTimelineContinuous && sourceTimelineAdvanced) {
            run.sourceTimelineEpochChanges += 1;
          } else {
            fail(
              `${run.scenario}/${run.title}: content timeline jumped backward by ${Math.abs(mediaDelta).toFixed(1)}s ` +
                `(program-date delta=${programDateDelta?.toFixed(1) ?? "n/a"}s; ${runDetails(run, next)})`
            );
          }
        }
        if (mediaDelta > elapsedSeconds + 4) {
          if (contentTimelineContinuous && sourceTimelineAdvanced) {
            run.sourceTimelineEpochChanges += 1;
          } else {
            fail(
              `${run.scenario}/${run.title}: content timeline skipped forward ${mediaDelta.toFixed(1)}s in ${elapsedSeconds.toFixed(1)}s ` +
                `(program-date delta=${programDateDelta?.toFixed(1) ?? "n/a"}s; ${runDetails(run, next)})`
            );
          }
        }
        if (next.timelinePinned === "true") {
          if (next.timelineSlider && Math.abs(next.timelineSlider.max - next.timelineSlider.value) > 0.1) {
            fail(
              `${run.scenario}/${run.title}: live slider drifted off its right edge ` +
                `(value=${next.timelineSlider.value.toFixed(2)}, max=${next.timelineSlider.max.toFixed(2)}; ${runDetails(run, next)})`
            );
          }
          if (next.playheadLeft !== null && Math.abs(100 - next.playheadLeft) > 0.1) {
            fail(
              `${run.scenario}/${run.title}: live playhead jittered to ${next.playheadLeft.toFixed(2)}% ` +
                `(${runDetails(run, next)})`
            );
          }
        } else if (next.timelinePinned === "false") {
          fail(`${run.scenario}/${run.title}: live timeline became unpinned without a viewer seek (${runDetails(run, next)})`);
        }
        if (Date.now() - run.lastProgressAt > STALL_LIMIT_MS) {
          fail(
            `${run.scenario}/${run.title}: no playback progress for ${Math.round(STALL_LIMIT_MS / 1000)}s (${runDetails(run, next)})`
          );
        }
        if (run.diagnostics.errors.length > 0) fail(`${run.scenario}/${run.title}: ${run.diagnostics.errors[0]}`);
        if (run.diagnostics.relayErrors > 25) {
          fail(
            `${run.scenario}/${run.title}: relay connection error storm (${run.diagnostics.relayErrors}): ` +
              run.diagnostics.relayMessages.join(" | ")
          );
        }
        run.last = next;
        run.lastSampledAt = sampledAt;
      }
      if (Date.now() - startedAt >= ROUTE_HANDOFF_AFTER_MS) {
        for (const run of runs.filter((candidate) => !candidate.routed)) await verifyRouteHandoff(run);
      }
    }

    for (const run of runs.filter((candidate) => !candidate.routed)) await verifyRouteHandoff(run);
    for (const run of runs) await verifyMiniPlayerClose(run);
    for (const run of runs) await verifyNoColdMiniPlayerRestore(run);

    for (const run of runs) {
      console.log(
        `  PASS ${run.scenario} / ${run.title}: ${run.last.currentTime.toFixed(1)}s` +
          (run.sourceTimelineEpochChanges > 0 ? ` (${run.sourceTimelineEpochChanges} upstream timeline epoch change(s))` : "")
      );
    }
    console.log("PASS: production playback soak complete");
  } finally {
    await Promise.all(browserEntries.map((browser) => browser.close().catch(() => undefined)));
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
