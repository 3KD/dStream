#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium, devices } from "playwright";

const WATCH_URL =
  process.env.WATCH_LAYOUT_URL ??
  "http://127.0.0.1:3201/watch/05e60159f1e0a6cb64fa573fc1ebe35f985a975defe7d75603fdb9e8cfd38334/synthdragon-chill";
const OUTPUT_DIR = process.env.WATCH_LAYOUT_OUTPUT_DIR ?? path.resolve("output/playwright/watch-layout-check");
const WAIT_MS = Number(process.env.WATCH_LAYOUT_WAIT_MS ?? "1200");
const MAX_WAIT_MS = Number(process.env.WATCH_LAYOUT_MAX_WAIT_MS ?? "18000");
const RETRY_MS = Number(process.env.WATCH_LAYOUT_RETRY_MS ?? "650");
const COMPOSER_DRAFT = "unsent watch layout check";
const SCENARIO_FILTER = process.env.WATCH_LAYOUT_SCENARIO?.trim() ?? "";

const scenarios = [
  {
    key: "desktop-wide",
    context: { viewport: { width: 1440, height: 900 } },
    expect: "desktop"
  },
  {
    key: "desktop-narrow",
    context: { viewport: { width: 1024, height: 768 } },
    expect: "desktop"
  },
  {
    key: "mobile-portrait",
    context: { ...devices["iPhone 13"] },
    expect: "mobile-portrait"
  },
  {
    key: "android-portrait",
    context: { ...devices["Pixel 5"] },
    expect: "mobile-portrait"
  },
  {
    key: "ios-landscape",
    context: {
      ...devices["iPhone 13"],
      viewport: { width: 844, height: 390 }
    },
    expect: "mobile-landscape"
  },
  {
    key: "android-landscape",
    context: {
      ...devices["Pixel 5"],
      viewport: { width: 727, height: 393 }
    },
    expect: "mobile-landscape"
  },
  {
    key: "ios-rotation",
    context: { ...devices["iPhone 13"] },
    rotateTo: { width: 844, height: 390 },
    expect: "mobile-landscape"
  },
  {
    key: "android-rotation",
    context: { ...devices["Pixel 5"] },
    rotateTo: { width: 727, height: 393 },
    expect: "mobile-landscape"
  }
];

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function collectLayout(page) {
  return page.evaluate(() => {
    const getRect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };

    const navLinks = Array.from(document.querySelectorAll("header nav a")).filter((item) => item.getClientRects().length > 0);
    const navRowSpread =
      navLinks.length > 1 ? Math.max(...navLinks.map((item) => item.getBoundingClientRect().top)) - Math.min(...navLinks.map((item) => item.getBoundingClientRect().top)) : 0;

    const composer = document.querySelector('[data-testid="chat-message-input"]');
    const composerSubmit = composer?.closest("form")?.querySelector('button[type="submit"]');
    const messageList = document.querySelector('[data-testid="chat-message-list"]');
    const mobileChat = document.querySelector('[data-testid="watch-chat-panel-mobile-portrait"]');
    const p2pTelemetry = document.querySelector('[data-testid="p2p-telemetry"]');
    const visualViewport = window.visualViewport;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    let mobileChatCoversTelemetry = null;

    if (mobileChat && p2pTelemetry) {
      const chatRect = mobileChat.getBoundingClientRect();
      const telemetryRect = p2pTelemetry.getBoundingClientRect();
      const overlapLeft = Math.max(chatRect.left, telemetryRect.left);
      const overlapTop = Math.max(chatRect.top, telemetryRect.top);
      const overlapRight = Math.min(chatRect.right, telemetryRect.right);
      const overlapBottom = Math.min(chatRect.bottom, telemetryRect.bottom);

      if (overlapLeft < overlapRight && overlapTop < overlapBottom) {
        const topElement = document.elementFromPoint(
          overlapLeft + (overlapRight - overlapLeft) / 2,
          overlapTop + (overlapBottom - overlapTop) / 2
        );
        mobileChatCoversTelemetry = topElement ? mobileChat.contains(topElement) : false;
      }
    }

    return {
      viewport: {
        width: window.innerWidth,
        height: viewportHeight,
        top: viewportTop,
        bottom: viewportTop + viewportHeight
      },
      scrollY: Math.round(window.scrollY),
      player: getRect('[data-testid="watch-player-panel"]'),
      playerHost: getRect('[data-global-player-host="true"]'),
      details: getRect('[data-testid="watch-details-panel"]'),
      chatDesktopOrLandscape: getRect('[data-testid="watch-chat-panel"]'),
      chatMobilePortrait: getRect('[data-testid="watch-chat-panel-mobile-portrait"]'),
      composer: getRect('[data-testid="chat-message-input"]'),
      composerDisabled: composer?.disabled ?? null,
      composerValue: composer?.value ?? null,
      composerSubmitDisabled: composerSubmit?.disabled ?? null,
      messageListOverscrollY: messageList ? getComputedStyle(messageList).overscrollBehaviorY : null,
      mobileChatCoversTelemetry,
      navRowSpread: Math.round(navRowSpread)
    };
  });
}

async function waitForComposerReady(page) {
  await page.waitForFunction(
    () => {
      const composer = document.querySelector('[data-testid="chat-message-input"]');
      return composer instanceof HTMLTextAreaElement && !composer.disabled;
    },
    undefined,
    { timeout: MAX_WAIT_MS }
  );
}

async function typeComposerDraft(composer) {
  await composer.click();
  await composer.selectText();
  await composer.press("Backspace");
  await composer.pressSequentially(COMPOSER_DRAFT, { delay: 8 });
}

async function scrollToAndCollect(page, top) {
  await page.evaluate((nextTop) => window.scrollTo({ top: nextTop, behavior: "instant" }), top);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })
  );
  await page.waitForTimeout(80);
  return collectLayout(page);
}

function validatePortraitAnchor(name, stage, layout, initial) {
  check(!!layout.chatMobilePortrait, `${name}: ${stage} portrait chat panel missing`);
  check(!!layout.composer, `${name}: ${stage} composer missing`);
  check(
    Math.abs(layout.chatMobilePortrait.bottom - layout.viewport.bottom) <= 3,
    `${name}: ${stage} chat bottom is not anchored to the viewport`
  );
  check(
    Math.abs(layout.composer.bottom - initial.composer.bottom) <= 3,
    `${name}: ${stage} composer moved away from its bottom anchor`
  );
  check(
    Math.abs(layout.composer.height - initial.composer.height) <= 2,
    `${name}: ${stage} composer height changed while scrolling`
  );
}

async function validatePortraitScroll(page, name) {
  const initial = await scrollToAndCollect(page, 0);
  check(!!initial.chatMobilePortrait && !!initial.composer, `${name}: portrait chat geometry unavailable`);
  validatePortraitAnchor(name, "initial", initial, initial);
  check(initial.messageListOverscrollY === "contain", `${name}: chat message scrolling can escape into the page`);

  const chatDocumentTop = initial.chatMobilePortrait.top;
  const midpoint = await scrollToAndCollect(page, Math.max(24, Math.floor(chatDocumentTop / 2)));
  validatePortraitAnchor(name, "mid-scroll", midpoint, initial);
  check(midpoint.chatMobilePortrait.top < initial.chatMobilePortrait.top - 12, `${name}: chat top did not move toward the viewport top`);
  check(midpoint.chatMobilePortrait.height > initial.chatMobilePortrait.height + 12, `${name}: chat did not grow during page scroll`);

  const pinned = await scrollToAndCollect(page, Math.ceil(chatDocumentTop + 32));
  validatePortraitAnchor(name, "pinned", pinned, initial);
  check(pinned.chatMobilePortrait.top >= initial.viewport.top - 2, `${name}: pinned chat moved above the viewport`);
  check(pinned.chatMobilePortrait.top <= initial.viewport.top + 2, `${name}: chat did not stop at the viewport top`);
  check(pinned.mobileChatCoversTelemetry !== false, `${name}: stream details overlap the pinned chat`);

  const beyond = await scrollToAndCollect(page, Math.ceil(chatDocumentTop + 160));
  validatePortraitAnchor(name, "past-pin", beyond, initial);
  check(Math.abs(beyond.chatMobilePortrait.top - pinned.chatMobilePortrait.top) <= 2, `${name}: chat top did not remain pinned`);
  check(Math.abs(beyond.chatMobilePortrait.height - pinned.chatMobilePortrait.height) <= 3, `${name}: pinned chat height kept changing`);
  check(beyond.mobileChatCoversTelemetry !== false, `${name}: stream details overlap the chat after it pins`);

  await scrollToAndCollect(page, 0);
}

function validateScenario(name, expect, layout) {
  check(!!layout.player, `${name}: player panel missing`);
  check(!!layout.playerHost, `${name}: persistent player host missing`);
  check(!!layout.details, `${name}: details panel missing`);
  check(!!layout.composer, `${name}: chat composer missing`);
  check(layout.composerDisabled === false, `${name}: chat composer should accept typing on first load`);
  check(layout.composerValue === COMPOSER_DRAFT, `${name}: chat composer did not retain typed text`);
  check(layout.composerSubmitDisabled === false, `${name}: typed chat message cannot be sent`);
  check(layout.composer.top >= -2, `${name}: chat composer starts above the viewport`);
  check(layout.composer.bottom <= layout.viewport.height + 2, `${name}: chat composer is below the initial viewport`);
  check(layout.player.width >= 240 && layout.player.height >= 135, `${name}: player panel collapsed`);
  check(Math.abs(layout.playerHost.left - layout.player.left) <= 3, `${name}: player host left edge does not match its slot`);
  check(Math.abs(layout.playerHost.top - layout.player.top) <= 3, `${name}: player host top edge does not match its slot`);
  check(Math.abs(layout.playerHost.width - layout.player.width) <= 3, `${name}: player host width does not match its slot`);
  check(Math.abs(layout.playerHost.height - layout.player.height) <= 3, `${name}: player host height does not match its slot`);

  if (expect === "desktop") {
    check(!!layout.chatDesktopOrLandscape, `${name}: desktop chat panel missing`);
    check(!layout.chatMobilePortrait, `${name}: portrait chat panel should not render`);
    check(layout.chatDesktopOrLandscape.left > layout.player.left, `${name}: desktop chat should be to the right of player`);
    check(Math.abs(layout.chatDesktopOrLandscape.top - layout.player.top) <= 24, `${name}: desktop chat top should align with player top`);
    return;
  }

  if (expect === "mobile-portrait") {
    check(!!layout.chatMobilePortrait, `${name}: portrait chat panel missing`);
    check(!layout.chatDesktopOrLandscape, `${name}: desktop/landscape chat panel should not render`);
    check(layout.chatMobilePortrait.top >= layout.player.bottom - 2, `${name}: portrait chat must be below player`);
    check(layout.details.top >= layout.chatMobilePortrait.bottom - 2, `${name}: details panel must be below chat`);
    return;
  }

  check(!!layout.chatDesktopOrLandscape, `${name}: landscape chat panel missing`);
  check(!layout.chatMobilePortrait, `${name}: portrait chat panel should not render in landscape`);
  check(layout.chatDesktopOrLandscape.left > layout.player.left, `${name}: landscape chat should be to the right of player`);
  check(Math.abs(layout.chatDesktopOrLandscape.top - layout.player.top) <= 24, `${name}: landscape chat top should align with player top`);
  check(layout.navRowSpread <= 6, `${name}: header navigation wrapped to multiple rows`);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = [];

  try {
    for (const scenario of scenarios.filter(({ key }) => !SCENARIO_FILTER || key === SCENARIO_FILTER)) {
      const context = await browser.newContext(scenario.context);
      const page = await context.newPage();
      const runtimeErrors = [];
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (/hydration|server rendered html|did not match|react error #418/i.test(text)) {
          runtimeErrors.push(text);
        }
      });
      await page.goto(WATCH_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(WAIT_MS);

      if (scenario.rotateTo) {
        const portraitChat = page.locator('[data-testid="watch-chat-panel-mobile-portrait"]');
        await portraitChat.waitFor({ state: "visible", timeout: MAX_WAIT_MS });
        await waitForComposerReady(page);
        const portraitComposer = page.locator('[data-testid="chat-message-input"]');
        await typeComposerDraft(portraitComposer);
        await page.setViewportSize(scenario.rotateTo);
        await page.waitForTimeout(WAIT_MS);
      }

      const expectedChatSelector =
        scenario.expect === "mobile-portrait"
          ? '[data-testid="watch-chat-panel-mobile-portrait"]'
          : '[data-testid="watch-chat-panel"]';
      try {
        await page.locator(expectedChatSelector).waitFor({ state: "visible", timeout: MAX_WAIT_MS });
        await waitForComposerReady(page);
      } catch {
        // The validation loop below will report the concrete layout failure.
      }

      let layout = null;
      let errorMessage = null;
      const deadline = Date.now() + MAX_WAIT_MS;
      while (Date.now() <= deadline) {
        const composer = page.locator('[data-testid="chat-message-input"]');
        try {
          if ((await composer.count()) > 0 && (await composer.inputValue()) !== COMPOSER_DRAFT) {
            await typeComposerDraft(composer);
          }
        } catch {
          // The next pass will retry after hydration/layout settles.
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        layout = await collectLayout(page);
        try {
          validateScenario(scenario.key, scenario.expect, layout);
          errorMessage = null;
          break;
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          await page.waitForTimeout(RETRY_MS);
        }
      }

      const screenshotPath = path.join(OUTPUT_DIR, `${scenario.key}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      try {
        if (!layout) {
          throw new Error(`${scenario.key}: unable to collect layout snapshot`);
        }
        if (errorMessage) {
          throw new Error(errorMessage);
        }
        if (scenario.expect === "mobile-portrait") {
          await validatePortraitScroll(page, scenario.key);
        }
        if (runtimeErrors.length > 0) {
          throw new Error(`${scenario.key}: runtime error: ${runtimeErrors[0]}`);
        }
        results.push({ key: scenario.key, status: "PASS", screenshotPath });
      } catch (error) {
        results.push({
          key: scenario.key,
          status: "FAIL",
          error: error instanceof Error ? error.message : String(error),
          screenshotPath
        });
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log("watch layout validation:");
  for (const result of results) {
    if (result.status === "PASS") {
      console.log(`  PASS ${result.key} (${result.screenshotPath})`);
    } else {
      console.log(`  FAIL ${result.key}: ${result.error}`);
      console.log(`       screenshot: ${result.screenshotPath}`);
    }
  }

  if (results.some((result) => result.status === "FAIL")) {
    process.exitCode = 1;
  }
}

await main();
