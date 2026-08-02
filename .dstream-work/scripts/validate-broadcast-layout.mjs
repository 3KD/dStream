#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium, devices } from "playwright";

const BROADCAST_URL = process.env.BROADCAST_LAYOUT_URL ?? "http://127.0.0.1:3201/broadcast";
const OUTPUT_DIR = process.env.BROADCAST_LAYOUT_OUTPUT_DIR ?? path.resolve("output/playwright/broadcast-layout-check");

const scenarios = [
  { key: "desktop-browser", context: { viewport: { width: 1440, height: 1000 } }, mobile: false, mode: "browser" },
  { key: "desktop-obs", context: { viewport: { width: 1440, height: 1000 } }, mobile: false, mode: "obs" },
  { key: "mobile-browser", context: { ...devices["iPhone 13"] }, mobile: true, mode: "browser" },
  { key: "mobile-obs", context: { ...devices["iPhone 13"] }, mobile: true, mode: "obs" }
];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function collectLayout(page) {
  return page.evaluate(() => {
    const getRect = (testId) => {
      const node = document.querySelector(`[data-testid="${testId}"]`);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };

    return {
      primary: getRect("broadcast-primary-workspace"),
      chat: getRect("broadcast-chat-panel"),
      details: getRect("broadcast-stream-details"),
      status: getRect("broadcast-status-panel"),
      advanced: getRect("broadcast-advanced-settings-panel"),
      technical: getRect("broadcast-technical-status")
    };
  });
}

function validateLayout(key, mobile, layout) {
  for (const [name, rect] of Object.entries(layout)) {
    check(rect, `${key}: ${name} panel is missing`);
    check(rect.width > 0 && rect.height > 0, `${key}: ${name} panel collapsed`);
  }

  if (!mobile) {
    check(layout.chat.left > layout.primary.left, `${key}: chat must be beside the primary studio workspace`);
    check(Math.abs(layout.chat.top - layout.primary.top) <= 24, `${key}: chat and primary workspace tops are not aligned`);
    check(layout.details.top >= layout.primary.bottom, `${key}: stream details must follow the primary workspace`);
    check(layout.status.top >= layout.chat.bottom, `${key}: broadcast status must follow chat`);
    check(layout.advanced.top >= layout.details.bottom, `${key}: advanced settings must follow stream details`);
    check(layout.technical.top >= layout.status.bottom, `${key}: technical status must follow broadcast status`);
    return;
  }

  check(layout.chat.top >= layout.primary.bottom, `${key}: chat must follow the primary workspace`);
  check(layout.details.top >= layout.chat.bottom, `${key}: stream details must follow chat`);
  check(layout.status.top >= layout.details.bottom, `${key}: broadcast status must follow stream details`);
  check(layout.advanced.top >= layout.status.bottom, `${key}: advanced settings must follow broadcast status`);
  check(layout.technical.top >= layout.advanced.bottom, `${key}: technical status must be last`);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = [];

  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext(scenario.context);
      const page = await context.newPage();
      const runtimeErrors = [];
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const messageText = message.text();
        if (/hydration|server rendered html|did not match|react error #418/i.test(messageText)) {
          runtimeErrors.push(messageText);
        }
      });

      await page.goto(BROADCAST_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (scenario.mode === "obs") {
        await page.getByRole("tab", { name: "OBS / Encoder" }).click();
        await page.getByRole("heading", { name: "OBS setup" }).waitFor({ state: "visible", timeout: 20_000 });
      }
      await page.locator('[data-testid="broadcast-primary-workspace"]').waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(500);
      const layout = await collectLayout(page);
      const screenshotPath = path.join(OUTPUT_DIR, `${scenario.key}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      try {
        validateLayout(scenario.key, scenario.mobile, layout);
        check(runtimeErrors.length === 0, `${scenario.key}: runtime error: ${runtimeErrors[0]}`);
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

  console.log("broadcast layout validation:");
  for (const result of results) {
    if (result.status === "PASS") {
      console.log(`  PASS ${result.key} (${result.screenshotPath})`);
    } else {
      console.log(`  FAIL ${result.key}: ${result.error}`);
      console.log(`       screenshot: ${result.screenshotPath}`);
    }
  }
  if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
}

await main();
