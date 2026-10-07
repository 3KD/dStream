#!/usr/bin/env node

import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.CHAT_LATENCY_BASE_URL ?? "http://127.0.0.1:3201").replace(/\/$/, "");
const TEST_PUBKEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WATCH_URL = `${BASE_URL}/watch/${TEST_PUBKEY}/chat-latency-check`;
const MAX_CHAT_REQUEST_AFTER_FIRST_REQUEST_MS = Number(process.env.CHAT_LATENCY_MAX_REQUEST_MS ?? "500");
const MAX_FIRST_CHAT_REQUEST_MS = Number(process.env.CHAT_LATENCY_MAX_STARTUP_MS ?? "10000");
const MAX_OPTIMISTIC_COMMIT_MS = Number(process.env.CHAT_LATENCY_MAX_OPTIMISTIC_MS ?? "1500");
const MAX_CHAT_HISTORY_SECONDS = 24 * 60 * 60;
const MAX_CHAT_HISTORY_EVENTS = 100;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const context = await browser.newContext();
  let navigationStartedAt = 0;
  let firstSocketAtMs = null;
  let firstRequestAtMs = null;
  let firstChatRequestAtMs = null;
  const chatFilters = [];

  await context.routeWebSocket(/wss:\/\//, (socket) => {
    firstSocketAtMs ??= Date.now() - navigationStartedAt;
    socket.onMessage((raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (message[0] === "REQ") {
        firstRequestAtMs ??= Date.now() - navigationStartedAt;
        const hasChatFilter = message.slice(2).some(
          (filter) =>
            Array.isArray(filter?.kinds) &&
            filter.kinds.some((kind) => kind === 1311 || kind === 1) &&
            Array.isArray(filter?.["#a"])
        );
        if (hasChatFilter) {
          firstChatRequestAtMs ??= Date.now() - navigationStartedAt;
          chatFilters.push(
            ...message.slice(2).filter(
              (filter) =>
                Array.isArray(filter?.kinds) &&
                filter.kinds.some((kind) => kind === 1311 || kind === 1) &&
                Array.isArray(filter?.["#a"])
            )
          );
        }
        socket.send(JSON.stringify(["EOSE", message[1]]));
        return;
      }

      if (message[0] === "EVENT" && message[1]?.id) {
        setTimeout(() => socket.send(JSON.stringify(["OK", message[1].id, true, ""])), 1_000);
      }
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => {
    if (/^WHEP: timed out waiting for remote track\.?$/i.test(error.message)) return;
    pageErrors.push(error.message);
  });

  navigationStartedAt = Date.now();
  await page.goto(WATCH_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const input = document.querySelector('[data-testid="chat-message-input"]');
      return input instanceof HTMLTextAreaElement && !input.disabled;
    },
    undefined,
    { timeout: 30_000 }
  );
  await page.waitForFunction(() => document.querySelector('[title="Connected"]'), undefined, { timeout: 20_000 });

  check(firstSocketAtMs !== null, "No Nostr relay socket was opened.");
  check(firstRequestAtMs !== null, "No Nostr subscription request was sent.");
  check(firstChatRequestAtMs !== null, "No current-stream chat subscription was sent.");
  check(chatFilters.length > 0, "No current-stream chat filter was captured.");
  const earliestAllowedSince = Math.floor(navigationStartedAt / 1000) - MAX_CHAT_HISTORY_SECONDS - 60;
  for (const filter of chatFilters) {
    check(
      Number.isFinite(filter.since) && filter.since >= earliestAllowedSince,
      `Chat history starts at ${filter.since}; expected no more than one day of startup history.`
    );
    check(
      Number.isFinite(filter.limit) && filter.limit <= MAX_CHAT_HISTORY_EVENTS,
      `Chat history limit is ${filter.limit}; expected <= ${MAX_CHAT_HISTORY_EVENTS}.`
    );
  }
  check(
    firstChatRequestAtMs <= MAX_FIRST_CHAT_REQUEST_MS,
    `Chat subscription started ${firstChatRequestAtMs}ms after navigation; expected <= ${MAX_FIRST_CHAT_REQUEST_MS}ms.`
  );
  const chatRequestAfterFirstRequestMs = firstChatRequestAtMs - firstRequestAtMs;
  check(
    chatRequestAfterFirstRequestMs <= MAX_CHAT_REQUEST_AFTER_FIRST_REQUEST_MS,
    `Chat subscription started ${chatRequestAfterFirstRequestMs}ms after the first Nostr request; expected <= ${MAX_CHAT_REQUEST_AFTER_FIRST_REQUEST_MS}ms.`
  );

  const message = `local-chat-latency-${Date.now()}`;
  await page.locator('[data-testid="chat-message-input"]').fill(message);
  await page.waitForFunction(
    () => {
      const button = document.querySelector(
        'form:has([data-testid="chat-message-input"]) button[type="submit"]'
      );
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    undefined,
    { timeout: 5_000 }
  );

  const immediateResult = await page.evaluate((expectedMessage) => {
    const button = document.querySelector(
      'form:has([data-testid="chat-message-input"]) button[type="submit"]'
    );
    const input = document.querySelector('[data-testid="chat-message-input"]');
    const list = document.querySelector('[data-testid="chat-message-list"]');
    const startedAt = performance.now();
    window.__dstreamChatSendStartedAt = startedAt;
    button.click();
    return {
      clickDurationMs: performance.now() - startedAt,
      inputCleared: input?.value === "",
      messageVisible: list?.textContent?.includes(expectedMessage) === true,
      pendingVisible: list?.textContent?.includes("Sending...") === true
    };
  }, message);

  check(immediateResult.inputCleared, "The composer was not cleared in the send transaction.");
  if (!immediateResult.messageVisible || !immediateResult.pendingVisible) {
    await page.waitForFunction(
      (expectedMessage) => {
        const list = document.querySelector('[data-testid="chat-message-list"]');
        const text = list?.textContent ?? "";
        return text.includes(expectedMessage) && text.includes("Sending...");
      },
      message,
      { timeout: MAX_OPTIMISTIC_COMMIT_MS }
    );
  }
  const optimisticCommitMs = immediateResult.messageVisible && immediateResult.pendingVisible
    ? Math.round(immediateResult.clickDurationMs)
    : await page.evaluate(() => Math.round(performance.now() - window.__dstreamChatSendStartedAt));
  check(
    optimisticCommitMs <= MAX_OPTIMISTIC_COMMIT_MS,
    `Optimistic chat render took ${optimisticCommitMs}ms; expected <= ${MAX_OPTIMISTIC_COMMIT_MS}ms.`
  );

  await page.waitForFunction(
    (expectedMessage) => {
      const list = document.querySelector('[data-testid="chat-message-list"]');
      const text = list?.textContent ?? "";
      return text.includes(expectedMessage) && !text.includes("Sending...") && !text.includes("Not delivered");
    },
    message,
    { timeout: 5_000 }
  );

  check(pageErrors.length === 0, `Browser error: ${pageErrors[0]}`);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        firstSocketAtMs,
        firstRequestAtMs,
        firstChatRequestAtMs,
        chatRequestAfterFirstRequestMs,
        chatHistorySeconds: MAX_CHAT_HISTORY_SECONDS,
        chatHistoryLimit: MAX_CHAT_HISTORY_EVENTS,
        clickHandlerMs: Math.round(immediateResult.clickDurationMs),
        optimisticCommitMs
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
