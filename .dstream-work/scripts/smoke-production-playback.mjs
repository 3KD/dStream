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
const STARTUP_STABILITY_MS = positiveNumber(process.env.PLAYBACK_STARTUP_STABILITY_MS, 15_000);
const ROUTE_HANDOFF_AFTER_MS = positiveNumber(
  process.env.PLAYBACK_ROUTE_HANDOFF_AFTER_MS,
  Math.min(45_000, Math.max(5_000, Math.floor(SOAK_MS / 2)))
);
const SAMPLE_MS = 5_000;
const SOURCE_PATTERN = String(process.env.PLAYBACK_SOURCE_PATTERN || "").trim().toLowerCase();
const EXPLICIT_SOURCE_URL = String(process.env.PLAYBACK_SOURCE_URL || "").trim();
const EXPECTED_SOURCE_MODE = String(process.env.PLAYBACK_EXPECT_SOURCE_MODE || "").trim();
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
  if (process.env.PLAYBACK_CHROMIUM_CHANNEL?.trim().toLowerCase() === "bundled") {
    return chromium.launch({ headless: true });
  }
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
    const result = await page.locator("video").first().evaluate((video) => {
      const startupGate = video.dataset.dstreamStartupGate ?? "unknown";
      return {
        playing: !video.paused && !video.ended && video.readyState >= 2,
        gateBypassed: startupGate === "pending" && !video.paused,
        startupGate,
        readyState: video.readyState,
        paused: video.paused
      };
    });
    if (result.gateBypassed) {
      fail(`playback began while the startup buffer gate was pending (ready=${result.readyState})`);
    }
    if (result.playing) return;
    lastError = `gate=${result.startupGate}, ready=${result.readyState}, paused=${result.paused}`;
    await page.waitForTimeout(100);
  }
  fail(`playback did not start within ${Math.round(START_TIMEOUT_MS / 1000)}s (${lastError})`);
}

async function observeStartupStability(page, label) {
  await page.waitForTimeout(STARTUP_STABILITY_MS);
  const result = await page.locator("video").first().evaluate((video) => {
    const events = Array.isArray(window.__dstreamPlaybackStartupEvents) ? window.__dstreamPlaybackStartupEvents : [];
    const firstPlaying = events.findIndex((entry) => entry.event === "playing");
    const interruptions = firstPlaying < 0
      ? []
      : events.slice(firstPlaying + 1).filter((entry) => entry.event === "waiting" || entry.event === "stalled" || entry.event === "error");
    const fallbackVisual = document.querySelector('[data-testid="audio-fallback-visual"]');
    const fallbackArtwork = fallbackVisual?.querySelector("img");
    const fallbackRect = fallbackVisual?.getBoundingClientRect();
    return {
      events,
      interruptions,
      sourceMode: video.dataset.dstreamSourceMode ?? "unknown",
      startupBuffer: Number(video.dataset.dstreamStartupBuffer),
      startupGate: video.dataset.dstreamStartupGate ?? "unknown",
      fallbackVisualVisible: !!fallbackVisual && !!fallbackRect && fallbackRect.width > 0 && fallbackRect.height > 0,
      fallbackArtworkLoaded: fallbackArtwork instanceof HTMLImageElement && fallbackArtwork.complete && fallbackArtwork.naturalWidth > 0
    };
  });
  if (result.interruptions.length > 0) {
    fail(`${label}: playback was interrupted during the startup stability window (${JSON.stringify(result.interruptions)})`);
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
    await page.locator("video").first().evaluate((video) => {
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
          buffered: Array.from({ length: video.buffered.length }, (_, index) => [
            Number(video.buffered.start(index).toFixed(3)),
            Number(video.buffered.end(index).toFixed(3))
          ])
        });
      };
      for (const event of ["play", "playing", "waiting", "stalled", "error"]) {
        video.addEventListener(event, () => record(event));
      }
      record("observed");
    });
    marker = `${scenario}-${index}-${Date.now()}`;
    await page.locator("video").first().evaluate((video, identity) => {
      video.dataset.playbackSoakIdentity = identity;
    }, marker);
    await startPlayback(page);
    const startup = await observeStartupStability(page, `${scenario}/${title}`);
    console.log(
      `  startup ${scenario} / ${title}: mode=${startup.sourceMode}, buffer=${Number.isFinite(startup.startupBuffer) ? startup.startupBuffer.toFixed(1) : "n/a"}s, events=${startup.events.map((entry) => entry.event).join(",")}`
    );
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
  const routeStartedAt = Date.now();
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
