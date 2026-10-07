#!/usr/bin/env node

import process from "node:process";
import { chromium } from "playwright";
import { nip19 } from "nostr-tools";

const BASE_URL = (process.env.CHAT_LATENCY_BASE_URL ?? "http://127.0.0.1:3201").replace(/\/$/, "");
const TEST_PUBKEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEST_STREAM_ID = "chat-latency-check";
const TEST_A_TAG = `30311:${TEST_PUBKEY}:${TEST_STREAM_ID}`;
const INVALID_RAW_MESSAGE = "forged-pre-hydration-message";
const WATCH_URL = `${BASE_URL}/watch/${nip19.npubEncode(TEST_PUBKEY)}/${TEST_STREAM_ID}`;
const MAX_CHAT_REQUEST_AFTER_FIRST_REQUEST_MS = Number(process.env.CHAT_LATENCY_MAX_REQUEST_MS ?? "500");
const MAX_FIRST_CHAT_REQUEST_MS = Number(process.env.CHAT_LATENCY_MAX_STARTUP_MS ?? "2500");
const MAX_COLD_OPTIMISTIC_COMMIT_MS = Number(process.env.CHAT_LATENCY_MAX_COLD_OPTIMISTIC_MS ?? "750");
const MAX_OPTIMISTIC_COMMIT_MS = Number(process.env.CHAT_LATENCY_MAX_OPTIMISTIC_MS ?? "335");
const MAX_COLD_CHAT_PUBLISH_MS = Number(process.env.CHAT_LATENCY_MAX_COLD_PUBLISH_MS ?? "750");
const MAX_CHAT_PUBLISH_MS = Number(process.env.CHAT_LATENCY_MAX_PUBLISH_MS ?? "335");
const MOCK_RELAY_ACK_MS = Number(process.env.CHAT_LATENCY_MOCK_ACK_MS ?? "25");
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
  let injectedInvalidRawEvent = false;
  let outboundMessageContent = null;
  let sendStartedAtEpoch = 0;
  let firstPublishAtMs = null;
  let socketCount = 0;
  let socketsAtSend = 0;
  let publishSocketOrdinal = null;
  const chatFilters = [];

  await context.routeWebSocket(/wss:\/\//, (socket) => {
    const socketOrdinal = ++socketCount;
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
          if (!injectedInvalidRawEvent) {
            injectedInvalidRawEvent = true;
            socket.send(
              JSON.stringify([
                "EVENT",
                message[1],
                {
                  id: "f".repeat(64),
                  pubkey: TEST_PUBKEY,
                  created_at: Math.floor(Date.now() / 1000),
                  kind: 1311,
                  tags: [["a", TEST_A_TAG]],
                  content: INVALID_RAW_MESSAGE,
                  sig: "0".repeat(128)
                }
              ])
            );
          }
        }
        socket.send(JSON.stringify(["EOSE", message[1]]));
        return;
      }

      if (message[0] === "EVENT" && message[1]?.id) {
        if (message[1].content === outboundMessageContent) {
          firstPublishAtMs ??= Date.now() - sendStartedAtEpoch;
          publishSocketOrdinal ??= socketOrdinal;
        }
        setTimeout(() => socket.send(JSON.stringify(["OK", message[1].id, true, ""])), MOCK_RELAY_ACK_MS);
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
  check(injectedInvalidRawEvent, "The forged pre-hydration regression event was not injected.");
  const earliestAllowedSince = Math.floor(navigationStartedAt / 1000) - MAX_CHAT_HISTORY_SECONDS - 60;
  for (const filter of chatFilters) {
    check(
      filter["#a"].includes(TEST_A_TAG),
      `Chat filter did not decode the npub route to ${TEST_A_TAG}.`
    );
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
  await page.waitForTimeout(250);
  const chatTextAfterVerification = await page.locator('[data-testid="chat-message-list"]').textContent();
  check(
    !chatTextAfterVerification?.includes(INVALID_RAW_MESSAGE),
    "Forged pre-hydration event reached the visible chat feed."
  );

  async function measureSend(label, maxOptimisticMs, maxPublishMs) {
    const message = `${label}-chat-latency-${Date.now()}`;
    outboundMessageContent = message;
    firstPublishAtMs = null;
    publishSocketOrdinal = null;
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

    sendStartedAtEpoch = Date.now();
    socketsAtSend = socketCount;
    const immediateResult = await page.evaluate(async (expectedMessage) => {
      const button = document.querySelector(
        'form:has([data-testid="chat-message-input"]) button[type="submit"]'
      );
      const input = document.querySelector('[data-testid="chat-message-input"]');
      const list = document.querySelector('[data-testid="chat-message-list"]');
      const startedAt = performance.now();
      window.__dstreamChatSendStartedAt = startedAt;
      button.click();
      const immediate = {
        clickDurationMs: performance.now() - startedAt,
        inputCleared: input?.value === "",
        messageVisible: list?.textContent?.includes(expectedMessage) === true,
        pendingVisible: list?.textContent?.includes("Sending...") === true
      };
      const frame = await new Promise((resolve) => {
        requestAnimationFrame(() => {
          resolve({
            frameReadyMs: performance.now() - startedAt,
            frameMessageVisible: list?.textContent?.includes(expectedMessage) === true
          });
        });
      });
      return { ...immediate, ...frame };
    }, message);

    check(immediateResult.inputCleared, `${label}: the composer was not cleared in the send transaction.`);
    check(immediateResult.messageVisible, `${label}: no optimistic message was inserted during the send transaction.`);
    check(immediateResult.pendingVisible, `${label}: the optimistic message had no pending state.`);
    if (!immediateResult.frameMessageVisible) {
      await page.waitForFunction(
        (expectedMessage) => {
          const list = document.querySelector('[data-testid="chat-message-list"]');
          return list?.textContent?.includes(expectedMessage) === true;
        },
        message,
        { timeout: maxOptimisticMs }
      );
    }
    const optimisticCommitMs = immediateResult.frameMessageVisible
      ? Math.round(immediateResult.frameReadyMs)
      : await page.evaluate(() => Math.round(performance.now() - window.__dstreamChatSendStartedAt));
    check(
      optimisticCommitMs <= maxOptimisticMs,
      `${label}: optimistic chat render took ${optimisticCommitMs}ms; expected <= ${maxOptimisticMs}ms.`
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
    check(firstPublishAtMs !== null, `${label}: the signed chat event was never sent to a relay.`);
    check(
      firstPublishAtMs <= maxPublishMs,
      `${label}: signed chat publish started after ${firstPublishAtMs}ms; expected <= ${maxPublishMs}ms.`
    );
    const deliveryConfirmedMs = await page.evaluate(() =>
      Math.round(performance.now() - window.__dstreamChatSendStartedAt)
    );

    return {
      clickHandlerMs: Math.round(immediateResult.clickDurationMs),
      firstPaintReadyMs: Math.round(immediateResult.frameReadyMs),
      optimisticCommitMs,
      firstPublishAtMs,
      socketsAtSend,
      publishSocketOrdinal,
      openedNewSocketForPublish: (publishSocketOrdinal ?? 0) > socketsAtSend,
      deliveryConfirmedMs
    };
  }

  const coldSend = await measureSend("cold", MAX_COLD_OPTIMISTIC_COMMIT_MS, MAX_COLD_CHAT_PUBLISH_MS);
  await page.waitForTimeout(750);
  const settledSend = await measureSend("settled", MAX_OPTIMISTIC_COMMIT_MS, MAX_CHAT_PUBLISH_MS);

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
        mockRelayAckMs: MOCK_RELAY_ACK_MS,
        coldSend,
        settledSend
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
