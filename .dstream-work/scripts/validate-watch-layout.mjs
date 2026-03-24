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
    key: "mobile-landscape",
    context: {
      ...devices["iPhone 13"],
      viewport: { width: 844, height: 390 }
    },
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

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      player: getRect('[data-testid="watch-player-panel"]'),
      details: getRect('[data-testid="watch-details-panel"]'),
      chatDesktopOrLandscape: getRect('[data-testid="watch-chat-panel"]'),
      chatMobilePortrait: getRect('[data-testid="watch-chat-panel-mobile-portrait"]'),
      navRowSpread: Math.round(navRowSpread)
    };
  });
}

function validateScenario(name, expect, layout) {
  check(!!layout.player, `${name}: player panel missing`);
  check(!!layout.details, `${name}: details panel missing`);

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
    for (const scenario of scenarios) {
      const context = await browser.newContext(scenario.context);
      const page = await context.newPage();
      await page.goto(WATCH_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(WAIT_MS);

      let layout = null;
      let errorMessage = null;
      const deadline = Date.now() + MAX_WAIT_MS;
      while (Date.now() <= deadline) {
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
