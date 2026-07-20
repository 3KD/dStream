"use client";

import type { NostrEvent, StreamPaymentMethod } from "@dstream/protocol";
import type { Filter } from "nostr-tools";
import { subscribeMany } from "../nostr";
import { getPaymentRailForMethod, type PaymentRailId } from "./rails";

export type ClientPaymentIntentStatus = "pending" | "settled" | "expired" | "failed";

export interface ClientPaymentIntent {
  id: string;
  scope: {
    type: "tip" | "video_package";
    id: string;
    streamPubkey?: string;
    streamId?: string;
    hostPubkey?: string;
    resourceId?: string;
  };
  buyerPubkey: string;
  recipientPubkey?: string;
  asset: StreamPaymentMethod["asset"];
  railId: PaymentRailId;
  network: string;
  address: string;
  amount: string;
  status: ClientPaymentIntentStatus;
  createdAtSec: number;
  expiresAtSec: number;
  settledAtSec?: number;
  payment?: {
    txId: string;
    confirmations: number;
    finality: string;
    [key: string]: unknown;
  };
}

export interface PaymentIntentCredentials {
  intent: ClientPaymentIntent;
  secret: string;
}

export interface ClientPaymentRailCapability {
  asset: StreamPaymentMethod["asset"];
  railId: PaymentRailId;
  network: string;
  configured: boolean;
  confirmationsRequired: number;
  verifier: "wallet_rpc" | "json_rpc" | "rest" | "lnurl_nip57";
  reason?: string;
}

export class PaymentIntentClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PaymentIntentClientError";
    this.status = status;
  }
}

type SignEvent = (event: Omit<NostrEvent, "id" | "sig">) => Promise<NostrEvent>;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

async function parseBody(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

async function postIntent(payload: Record<string, unknown>): Promise<PaymentIntentCredentials> {
  const response = await fetch("/api/payments/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const body = await parseBody(response);
  if (!response.ok || !body?.ok || !body.intent || typeof body.secret !== "string") {
    throw new PaymentIntentClientError(responseError(body, "Failed to create payment intent."), response.status);
  }
  return { intent: body.intent as ClientPaymentIntent, secret: body.secret };
}

export async function buildPaymentIntentProof(input: {
  signEvent: SignEvent;
  pubkey: string;
  streamPubkey: string;
  streamId: string;
  ttlSec?: number;
}): Promise<NostrEvent> {
  const expiresAtSec = nowSec() + Math.max(60, Math.min(input.ttlSec ?? 600, 3600));
  return input.signEvent({
    kind: 27235,
    pubkey: input.pubkey,
    created_at: nowSec(),
    tags: [
      ["dstream", "payment_intent"],
      ["exp", String(expiresAtSec)],
      ["stream", `${input.streamPubkey}--${input.streamId}`]
    ],
    content: ""
  });
}

export async function createTipPaymentIntent(input: {
  buyerProofEvent: NostrEvent;
  recipientPubkey: string;
  streamId: string;
  method: StreamPaymentMethod;
  amount: string;
  xmrSessionToken?: string;
}): Promise<PaymentIntentCredentials> {
  const railId = getPaymentRailForMethod(input.method).id;
  return postIntent({
    scopeType: "tip",
    buyerProofEvent: input.buyerProofEvent,
    recipientPubkey: input.recipientPubkey,
    streamId: input.streamId,
    asset: input.method.asset,
    address: input.method.address,
    network: input.method.network ?? railId,
    amount: input.amount,
    paymentRailId: railId,
    xmrSessionToken: input.xmrSessionToken
  });
}

export async function createVideoPackagePaymentIntent(input: {
  packageId: string;
  buyerProofEvent: NostrEvent;
  xmrSessionToken?: string;
}): Promise<PaymentIntentCredentials> {
  return postIntent({
    scopeType: "video_package",
    packageId: input.packageId,
    buyerProofEvent: input.buyerProofEvent,
    xmrSessionToken: input.xmrSessionToken
  });
}

export async function getPaymentIntent(input: PaymentIntentCredentials): Promise<ClientPaymentIntent> {
  const response = await fetch(`/api/payments/intents/${encodeURIComponent(input.intent.id)}`, {
    headers: { authorization: `Bearer ${input.secret}` },
    cache: "no-store"
  });
  const body = await parseBody(response);
  if (!response.ok || !body?.ok || !body.intent) {
    throw new PaymentIntentClientError(responseError(body, "Failed to read payment intent."), response.status);
  }
  return body.intent as ClientPaymentIntent;
}

export async function verifyPaymentIntent(input: {
  credentials: PaymentIntentCredentials;
  proof: Record<string, unknown>;
}): Promise<ClientPaymentIntent> {
  const response = await fetch(`/api/payments/intents/${encodeURIComponent(input.credentials.intent.id)}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: input.credentials.secret, proof: input.proof }),
    cache: "no-store"
  });
  const body = await parseBody(response);
  if (!response.ok || !body?.ok || !body.intent) {
    throw new PaymentIntentClientError(responseError(body, "Payment verification failed."), response.status);
  }
  return body.intent as ClientPaymentIntent;
}

export function isPendingPaymentVerification(error: unknown): boolean {
  return error instanceof PaymentIntentClientError && error.status === 402;
}

export async function verifyPaymentIntentWithPolling(input: {
  credentials: PaymentIntentCredentials;
  proof: Record<string, unknown>;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  onPending?: (message: string) => void;
}): Promise<ClientPaymentIntent> {
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? 10 * 60_000);
  const intervalMs = Math.max(1_000, input.intervalMs ?? 8_000);
  const deadline = Date.now() + timeoutMs;
  let lastPendingError = "Payment has not reached finality yet.";

  while (Date.now() < deadline) {
    if (input.signal?.aborted) throw new DOMException("Payment verification cancelled.", "AbortError");
    try {
      return await verifyPaymentIntent({ credentials: input.credentials, proof: input.proof });
    } catch (error) {
      if (!isPendingPaymentVerification(error)) throw error;
      lastPendingError = error instanceof Error ? error.message : lastPendingError;
      input.onPending?.(lastPendingError);
    }
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, intervalMs);
      input.signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timer);
          reject(new DOMException("Payment verification cancelled.", "AbortError"));
        },
        { once: true }
      );
    });
  }
  throw new PaymentIntentClientError(`${lastPendingError} You can retry verification without paying again.`, 408);
}

export function paymentMethodFromIntent(intent: ClientPaymentIntent): StreamPaymentMethod {
  return {
    asset: intent.asset,
    address: intent.address,
    network: intent.network,
    amount: intent.amount
  };
}

export async function loadPaymentRailCapabilities(): Promise<ClientPaymentRailCapability[]> {
  const response = await fetch("/api/payments/capabilities", { cache: "no-store" });
  const body = await parseBody(response);
  if (!response.ok || !body?.ok || !Array.isArray(body.settlement)) {
    throw new PaymentIntentClientError(responseError(body, "Failed to load payment rail readiness."), response.status);
  }
  return body.settlement as ClientPaymentRailCapability[];
}

export function capabilityForMethod(
  method: StreamPaymentMethod,
  capabilities: ClientPaymentRailCapability[]
): ClientPaymentRailCapability | null {
  const railId = getPaymentRailForMethod(method).id;
  return capabilities.find((capability) => capability.railId === railId && capability.asset === method.asset) ?? null;
}

function tagValue(event: any, name: string): string {
  if (!Array.isArray(event?.tags)) return "";
  for (const tag of event.tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string") return tag[1];
  }
  return "";
}

export async function waitForLightningZapReceipt(input: {
  relays: string[];
  providerPubkey: string;
  recipientPubkey: string;
  invoice: string;
  zapRequestJson: string;
  createdAtSec: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<NostrEvent> {
  const timeoutMs = Math.max(10_000, input.timeoutMs ?? 2 * 60_000);
  const providerPubkey = input.providerPubkey.toLowerCase();
  const recipientPubkey = input.recipientPubkey.toLowerCase();
  const filter: Filter = {
    kinds: [9735],
    authors: [providerPubkey],
    "#p": [recipientPubkey],
    since: Math.max(0, input.createdAtSec - 10)
  };

  return new Promise<NostrEvent>((resolve, reject) => {
    let settled = false;
    const subscriptions: Array<{ close(): void }> = [];
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(retry);
      for (const subscription of subscriptions) subscription.close();
      input.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onEvent = (event: NostrEvent) => {
      if ((event.pubkey ?? "").toLowerCase() !== providerPubkey) return;
      if (tagValue(event, "p").toLowerCase() !== recipientPubkey) return;
      if (tagValue(event, "bolt11").toLowerCase() !== input.invoice.toLowerCase()) return;
      if (tagValue(event, "description") !== input.zapRequestJson) return;
      finish(() => resolve(event));
    };
    const subscribe = () => {
      if (settled) return;
      subscriptions.push(subscribeMany(input.relays, [filter], { onevent: onEvent }));
    };
    const onAbort = () => finish(() => reject(new DOMException("Receipt wait cancelled.", "AbortError")));
    const timeout = window.setTimeout(
      () => finish(() => reject(new PaymentIntentClientError("The Lightning provider has not published the signed receipt yet.", 408))),
      timeoutMs
    );
    const retry = window.setInterval(subscribe, 15_000);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    subscribe();
  });
}
