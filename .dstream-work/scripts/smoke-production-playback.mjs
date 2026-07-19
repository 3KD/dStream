#!/usr/bin/env node

import process from "node:process";
import { chromium, devices, firefox } from "playwright";

const BASE_URL = String(process.env.EXTERNAL_BASE_URL || "https://dstream.stream").trim().replace(/\/+$/, "");
function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SOAK_MS = positiveNumber(process.env.PLAYBACK_SOAK_MS, 10 * 60_000);
const SOURCE_LIMIT = Math.floor(positiveNumber(process.env.PLAYBACK_SOURCE_LIMIT, 2));
const START_TIMEOUT_MS = positiveNumber(process.env.PLAYBACK_START_TIMEOUT_MS, 45_000);
const STALL_LIMIT_MS = positiveNumber(process.env.PLAYBACK_STALL_LIMIT_MS, 30_000);
const SAMPLE_MS = 5_000;
const SOURCE_PATTERN = String(process.env.PLAYBACK_SOURCE_PATTERN || "").trim().toLowerCase();
const EXPLICIT_SOURCE_URL = String(process.env.PLAYBACK_SOURCE_URL || "").trim();
const REQUESTED_SCENARIOS = new Set(
  String(process.env.PLAYBACK_SCENARIOS || "chromium-desktop,chromium-mobile,firefox-desktop")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

function fail(message) {
  throw new Error(message);
}

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
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

async function launchFirefox() {
  const executablePath = process.env.PLAYBACK_FIREFOX_EXECUTABLE?.trim();
  if (executablePath) return firefox.launch({ executablePath, headless: true });
  return firefox.launch({ headless: true });
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
    target.dispatchEvent(new Event("visibilitychange"));
  }, state);
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
    const result = await page.locator("video").first().evaluate(async (video) => {
      video.muted = true;
      video.volume = 0;
      try {
        await video.play();
      } catch (error) {
        return { playing: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
      }
      return { playing: !video.paused && !video.ended, error: "" };
    });
    if (result.playing) return;
    if (result.error) lastError = result.error;
    await page.waitForTimeout(500);
  }
  fail(`playback did not start within ${Math.round(START_TIMEOUT_MS / 1000)}s (${lastError})`);
}

async function openRun(context, scenario, stream, index) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const preferenceKey = "dstream_player_background_play_v1";
    const writes = [];
    Object.defineProperty(window, "__dstreamPlaybackSoakPreferenceWrites", { value: writes, configurable: true });
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === preferenceKey) {
        writes.push({ value: String(value), stack: new Error().stack ?? "" });
      }
      return originalSetItem.call(this, key, value);
    };
  });
  const diagnostics = { errors: [], relayErrors: 0, relayMessages: [] };
  const title = String(stream.title || stream.streamId);
  page.on("pageerror", (error) => diagnostics.errors.push(error.stack || error.message));
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
  const background = scenario === "chromium-mobile";
  try {
    await page.goto(watchUrl(stream), { waitUntil: "domcontentloaded", timeout: START_TIMEOUT_MS });
    await page.locator("video").first().waitFor({ state: "attached", timeout: START_TIMEOUT_MS });
    marker = `${scenario}-${index}-${Date.now()}`;
    await page.locator("video").first().evaluate((video, identity) => {
      video.dataset.playbackSoakIdentity = identity;
    }, marker);
    await startPlayback(page);
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
    const pageText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    const preferenceWrites = await page
      .evaluate(() => window.__dstreamPlaybackSoakPreferenceWrites ?? [])
      .catch(() => []);
    const reason = error instanceof Error ? error.message : String(error);
    fail(
      `${scenario}/${title}: startup failed at ${page.url()} (${reason}); ` +
        `page errors: ${diagnostics.errors.join(" | ") || "none"}; ` +
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
    samples: [],
    lastProgressAt: Date.now(),
    startedAt: Date.now(),
    background,
    routed: false,
    sourceTimelineEpochChanges: 0
  };
}

async function verifyRouteHandoff(run) {
  if (run.background) await setSyntheticVisibility(run.page, "visible");
  const preferenceBeforeRoute = run.background
    ? await run.page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1"))
    : null;
  const before = await sampleVideo(run.page);
  const homeLink = run.page.locator('a[href="/"]').first();
  await homeLink.click();
  await run.page.waitForURL(`${BASE_URL}/`, { timeout: 20_000 });
  await run.page.locator("video").first().waitFor({ state: "attached", timeout: 20_000 });
  await run.page.waitForTimeout(3_000);
  let after = await sampleVideo(run.page);
  if (after.marker !== run.marker) fail(`${run.scenario}/${run.title}: player DOM was remounted during route handoff`);
  if (after.currentTime + 10 < before.currentTime) {
    fail(
      `${run.scenario}/${run.title}: timeline reset during route handoff (${before.currentTime.toFixed(1)} -> ${after.currentTime.toFixed(1)}); ` +
        `session ${before.session ?? "n/a"} -> ${after.session ?? "n/a"}; ` +
        `signature ${before.signature ?? "n/a"} -> ${after.signature ?? "n/a"}; recovery=${after.recoveryReason ?? "none"}`
    );
  }
  if (after.paused || after.ended) fail(`${run.scenario}/${run.title}: playback stopped during route handoff`);
  if (run.background) {
    const preferenceEnabled = await run.page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1") === "1");
    if (!preferenceEnabled) {
      fail(
        `${run.scenario}/${run.title}: background preference was lost during route handoff ` +
          `(before=${preferenceBeforeRoute ?? "null"}, after=${await run.page.evaluate(() => localStorage.getItem("dstream_player_background_play_v1")) ?? "null"})`
      );
    }
    await verifyBackgroundResume(run.page, `${run.scenario}/${run.title} after route handoff`);
    after = await sampleVideo(run.page);
  }
  run.routed = true;
  run.last = after;
  run.lastSampledAt = Date.now();
  run.lastProgressAt = Date.now();
}

async function main() {
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
          next.fragment !== null &&
          run.last.fragment !== null &&
          next.fragment !== run.last.fragment;
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
      if (Date.now() - startedAt > 45_000) {
        for (const run of runs.filter((candidate) => !candidate.routed)) await verifyRouteHandoff(run);
      }
    }

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
