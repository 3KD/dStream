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
    const getRect = (selectorOrNode) => {
      const node = typeof selectorOrNode === "string" ? document.querySelector(selectorOrNode) : selectorOrNode;
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
    const chatRoot = messageList?.parentElement?.parentElement;
    const chatHeader = chatRoot?.firstElementChild;
    const composerForm = composer?.closest("form");
    const mobileChat = document.querySelector('[data-testid="watch-chat-panel-mobile-portrait"]');
    const dockedChat = document.querySelector('[data-testid="watch-chat-panel"]');
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
      documentHeight: document.documentElement.scrollHeight,
      maxScrollY: Math.max(0, Math.round(document.documentElement.scrollHeight - window.innerHeight)),
      player: getRect('[data-testid="watch-player-panel"]'),
      playerHost: getRect('[data-global-player-host="true"]'),
      details: getRect('[data-testid="watch-details-panel"]'),
      footer: getRect("#global-site-footer"),
      chatDesktopOrLandscapeAnchor: getRect('[data-testid="watch-chat-anchor"]'),
      chatDesktopOrLandscape: getRect('[data-testid="watch-chat-panel"]'),
      chatDesktopOrLandscapePosition: dockedChat ? getComputedStyle(dockedChat).position : null,
      chatMobilePortraitAnchor: getRect('[data-testid="watch-chat-anchor-mobile-portrait"]'),
      chatMobilePortrait: getRect('[data-testid="watch-chat-panel-mobile-portrait"]'),
      chatMobilePortraitPosition: mobileChat ? getComputedStyle(mobileChat).position : null,
      chatHeader: getRect(chatHeader),
      composerForm: getRect(composerForm),
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

async function validateEarlyPortraitAnchor(page, name) {
  const panel = page.locator('[data-testid="watch-chat-panel-mobile-portrait"]');
  await panel.waitFor({ state: "visible", timeout: MAX_WAIT_MS });
  const initial = await collectLayout(page);
  check(!!initial.chatMobilePortrait, `${name}: early portrait chat panel missing`);
  check(initial.chatMobilePortraitPosition === "fixed", `${name}: early portrait chat is not viewport anchored`);
  check(
    Math.abs(initial.chatMobilePortrait.bottom - initial.viewport.bottom) <= 3,
    `${name}: early portrait chat bottom is detached`
  );

  const scrolled = await scrollToAndCollect(page, 40);
  check(
    Math.abs(scrolled.chatMobilePortrait.bottom - scrolled.viewport.bottom) <= 3,
    `${name}: an early swipe moves the portrait chat bottom`
  );
  const restored = await scrollToAndCollect(page, 0);
  check(
    Math.abs(restored.chatMobilePortrait.top - initial.chatMobilePortrait.top) <= 3,
    `${name}: returning from an early swipe changes the initial chat height`
  );
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

function validateBoundedChatGeometry(name, stage, layout, { portrait, expect = null }) {
  const anchor = portrait ? layout.chatMobilePortraitAnchor : layout.chatDesktopOrLandscapeAnchor;
  const panel = portrait ? layout.chatMobilePortrait : layout.chatDesktopOrLandscape;
  const position = portrait ? layout.chatMobilePortraitPosition : layout.chatDesktopOrLandscapePosition;
  check(!!anchor, `${name}: ${stage} chat anchor missing`);
  check(!!panel, `${name}: ${stage} chat panel missing`);
  check(!!layout.footer, `${name}: ${stage} site footer missing`);
  check(position === "fixed", `${name}: ${stage} chat is not viewport anchored`);

  const topInset = portrait ? 0 : expect === "desktop" ? 24 : 16;
  const bottomInset = portrait ? 0 : expect === "desktop" ? 24 : 16;
  const footerInset = portrait ? 16 : bottomInset;
  const viewportBottomBoundary = layout.viewport.bottom - bottomInset;
  const expectedBottom = Math.min(viewportBottomBoundary, layout.footer.top - footerInset);
  const normalTop = Math.max(layout.viewport.top + topInset, anchor.top);
  const expectedHeight = Math.max(160, Math.floor(viewportBottomBoundary - normalTop));
  const expectedTop = expectedBottom - expectedHeight;

  check(Math.abs(panel.top - expectedTop) <= 3, `${name}: ${stage} chat top does not follow its upper boundary`);
  check(Math.abs(panel.bottom - expectedBottom) <= 3, `${name}: ${stage} chat bottom does not follow its lower boundary`);
  check(Math.abs(panel.height - expectedHeight) <= 3, `${name}: ${stage} footer changed the chat height`);
  check(!!layout.chatHeader, `${name}: ${stage} chat header missing`);
  check(!!layout.composerForm, `${name}: ${stage} chat composer missing`);
  check(layout.chatHeader.top >= panel.top - 2, `${name}: ${stage} chat header escaped above the panel`);
  check(layout.chatHeader.bottom <= panel.bottom + 2, `${name}: ${stage} chat header escaped below the panel`);
  check(layout.composerForm.top >= panel.top - 2, `${name}: ${stage} chat composer escaped above the panel`);
  check(layout.composerForm.bottom <= panel.bottom + 2, `${name}: ${stage} chat composer escaped below the panel`);
  check(
    panel.bottom <= layout.footer.top - footerInset + 3,
    `${name}: ${stage} chat overlaps the site footer`
  );
  if (expectedBottom < viewportBottomBoundary - 3) {
    check(panel.top < normalTop - 3, `${name}: ${stage} footer did not push the chat upward`);
    check(
      layout.composerForm.bottom <= layout.footer.top - footerInset + 3,
      `${name}: ${stage} composer overlaps the site footer`
    );
    check(
      layout.composerForm.bottom > layout.viewport.top,
      `${name}: ${stage} composer left the visible viewport before the chat header`
    );
  }
}

function validatePortraitAnchor(name, stage, layout, initial) {
  validateBoundedChatGeometry(name, stage, layout, { portrait: true });
  check(!!layout.composer, `${name}: ${stage} composer missing`);
  check(
    Math.abs(
      layout.chatMobilePortrait.bottom -
        layout.composer.bottom -
        (initial.chatMobilePortrait.bottom - initial.composer.bottom)
    ) <= 3,
    `${name}: ${stage} composer moved relative to the chat bottom`
  );
  check(
    Math.abs(layout.composer.height - initial.composer.height) <= 2,
    `${name}: ${stage} composer height changed while scrolling`
  );
  check(
    Math.abs(layout.chatMobilePortraitAnchor.height - initial.chatMobilePortraitAnchor.height) <= 2,
    `${name}: ${stage} chat placeholder changed the document flow`
  );
}

async function validatePortraitScroll(page, name) {
  const initial = await scrollToAndCollect(page, 0);
  check(
    !!initial.chatMobilePortraitAnchor && !!initial.chatMobilePortrait && !!initial.composer,
    `${name}: portrait chat geometry unavailable`
  );
  validatePortraitAnchor(name, "initial", initial, initial);
  check(initial.messageListOverscrollY === "contain", `${name}: chat message scrolling can escape into the page`);

  const chatDocumentTop = initial.chatMobilePortraitAnchor.top + initial.scrollY;
  for (const target of [40, 80, 120].filter((value) => value < chatDocumentTop - 12)) {
    const incremental = await scrollToAndCollect(page, target);
    validatePortraitAnchor(name, `scroll-${target}`, incremental, initial);
    const expectedTop = Math.max(incremental.viewport.top, chatDocumentTop - incremental.scrollY);
    check(
      Math.abs(incremental.chatMobilePortrait.top - expectedTop) <= 3,
      `${name}: scroll-${target} chat jumped instead of tracking the page`
    );
  }

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
  check(Math.abs(beyond.chatMobilePortrait.height - pinned.chatMobilePortrait.height) <= 3, `${name}: pinned chat height kept changing`);
  if (beyond.chatMobilePortrait.bottom >= beyond.viewport.bottom - 3) {
    check(Math.abs(beyond.chatMobilePortrait.top - pinned.chatMobilePortrait.top) <= 2, `${name}: chat top moved before the footer arrived`);
  } else {
    check(beyond.chatMobilePortrait.top < pinned.chatMobilePortrait.top - 3, `${name}: footer did not move the chat upward`);
  }
  check(beyond.mobileChatCoversTelemetry !== false, `${name}: stream details overlap the chat after it pins`);

  const footerDocumentTop = initial.footer.top + initial.scrollY;
  const footerCollisionTarget = Math.min(
    initial.maxScrollY,
    Math.max(beyond.scrollY + 40, Math.ceil(footerDocumentTop - initial.viewport.bottom + 48))
  );
  const footerBound = await scrollToAndCollect(page, footerCollisionTarget);
  validatePortraitAnchor(name, "footer-bound", footerBound, initial);
  check(
    footerBound.chatMobilePortrait.bottom < footerBound.viewport.bottom - 20,
    `${name}: footer did not take over as the portrait chat lower boundary`
  );

  await scrollToAndCollect(page, 0);
}

async function validateDockedChatScroll(page, name, expect) {
  const initial = await scrollToAndCollect(page, 0);
  check(!!initial.chatDesktopOrLandscapeAnchor, `${name}: docked chat anchor missing`);
  check(!!initial.chatDesktopOrLandscape && !!initial.composer, `${name}: docked chat geometry unavailable`);
  validateBoundedChatGeometry(name, "initial", initial, { portrait: false, expect });
  const inset = expect === "desktop" ? 24 : 16;
  check(
    Math.abs(initial.viewport.bottom - initial.chatDesktopOrLandscape.bottom - inset) <= 3,
    `${name}: chat does not start with the expected bottom buffer`
  );

  const initialComposerBottomGap = initial.chatDesktopOrLandscape.bottom - initial.composer.bottom;
  const pinnedTarget = Math.ceil(initial.chatDesktopOrLandscapeAnchor.top - inset + 24);
  const footerDocumentTop = initial.footer.top + initial.scrollY;
  const footerCollisionTarget = Math.ceil(footerDocumentTop - initial.viewport.bottom + 48);
  const targets = Array.from(
    new Set(
      [40, 120, 280, pinnedTarget, footerCollisionTarget]
        .map((target) => Math.max(0, Math.min(initial.maxScrollY, target)))
        .sort((left, right) => left - right)
    )
  );
  let pinnedLayout = null;
  let sawFooterBoundary = false;

  for (const target of targets) {
    const layout = await scrollToAndCollect(page, target);
    check(layout.scrollY >= target - 2, `${name}: page did not reach scroll position ${target}`);
    check(!!layout.chatDesktopOrLandscapeAnchor && !!layout.chatDesktopOrLandscape && !!layout.composer, `${name}: chat disappeared while scrolling`);
    validateBoundedChatGeometry(name, `scroll-${target}`, layout, { portrait: false, expect });
    check(
      Math.abs(layout.chatDesktopOrLandscape.bottom - layout.composer.bottom - initialComposerBottomGap) <= 2,
      `${name}: composer moved relative to the chat bottom`
    );
    check(
      Math.abs(layout.chatDesktopOrLandscapeAnchor.height - initial.chatDesktopOrLandscapeAnchor.height) <= 2,
      `${name}: docked chat placeholder changed the document flow`
    );

    if (target === Math.max(0, Math.min(initial.maxScrollY, pinnedTarget))) {
      pinnedLayout = layout;
    }
    if (layout.footer.top - inset < layout.viewport.bottom - inset - 3) {
      sawFooterBoundary = true;
      check(
        layout.chatDesktopOrLandscape.bottom < layout.viewport.bottom - inset - 3,
        `${name}: footer did not take over as the chat lower boundary`
      );
    }
  }

  check(!!pinnedLayout, `${name}: pinned chat geometry unavailable`);
  check(
    Math.abs(pinnedLayout.chatDesktopOrLandscape.top - (pinnedLayout.viewport.top + inset)) <= 3,
    `${name}: chat did not stop at its top buffer`
  );
  check(sawFooterBoundary, `${name}: footer boundary was not exercised`);
  await scrollToAndCollect(page, 0);
}

async function validateAndroidPortraitViewportResize(page, name) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error(`${name}: browser viewport unavailable`);
  const initial = await scrollToAndCollect(page, 0);
  await page.setViewportSize({ width: viewport.width, height: Math.max(560, viewport.height - 96) });
  await page.waitForTimeout(150);
  const compact = await collectLayout(page);
  check(!!compact.chatMobilePortrait && !!compact.composer, `${name}: chat disappeared after viewport resize`);
  check(
    Math.abs(compact.chatMobilePortrait.bottom - compact.viewport.bottom) <= 3,
    `${name}: Android viewport resize detached the chat bottom`
  );
  check(
    Math.abs(compact.composer.height - initial.composer.height) <= 2,
    `${name}: Android viewport resize changed the composer height`
  );
  await page.setViewportSize(viewport);
  await page.waitForTimeout(150);
  const restored = await collectLayout(page);
  validatePortraitAnchor(name, "viewport-restored", restored, initial);
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
    check(!!layout.chatDesktopOrLandscapeAnchor, `${name}: desktop chat anchor missing`);
    check(!layout.chatMobilePortrait, `${name}: portrait chat panel should not render`);
    check(layout.chatDesktopOrLandscape.left > layout.player.left, `${name}: desktop chat should be to the right of player`);
    check(Math.abs(layout.chatDesktopOrLandscape.top - layout.player.top) <= 24, `${name}: desktop chat top should align with player top`);
    return;
  }

  if (expect === "mobile-portrait") {
    check(!!layout.chatMobilePortrait, `${name}: portrait chat panel missing`);
    check(!!layout.chatMobilePortraitAnchor, `${name}: portrait chat anchor missing`);
    check(!layout.chatDesktopOrLandscape, `${name}: desktop/landscape chat panel should not render`);
    check(layout.chatMobilePortrait.top >= layout.player.bottom - 2, `${name}: portrait chat must be below player`);
    check(layout.details.top >= layout.chatMobilePortrait.bottom - 2, `${name}: details panel must be below chat`);
    return;
  }

  check(!!layout.chatDesktopOrLandscape, `${name}: landscape chat panel missing`);
  check(!!layout.chatDesktopOrLandscapeAnchor, `${name}: landscape chat anchor missing`);
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
      page.on("pageerror", (error) => {
        if (/^WHEP: timed out waiting for remote track\.?$/i.test(error.message)) return;
        runtimeErrors.push(error.message);
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (/hydration|server rendered html|did not match|react error #418/i.test(text)) {
          runtimeErrors.push(text);
        }
      });
      await page.goto(WATCH_URL, { waitUntil: "domcontentloaded" });

      let earlyPortraitError = null;
      if (scenario.expect === "mobile-portrait" || scenario.rotateTo) {
        try {
          await validateEarlyPortraitAnchor(page, scenario.key);
        } catch (error) {
          earlyPortraitError = error instanceof Error ? error.message : String(error);
        }
      }
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
        if (earlyPortraitError) {
          throw new Error(earlyPortraitError);
        }
        if (scenario.expect === "mobile-portrait") {
          await validatePortraitScroll(page, scenario.key);
          if (scenario.key === "android-portrait") {
            await validateAndroidPortraitViewportResize(page, scenario.key);
          }
        } else {
          await validateDockedChatScroll(page, scenario.key, scenario.expect);
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
