"use client";

const NWC_STORAGE_KEY = "dstream_lightning_nwc_v1";
const NWC_SESSION_STORAGE_KEY = "dstream_lightning_nwc_session_v1";

export type LightningWalletProvider = "nwc" | "webln" | "wallet_uri";

export interface LightningPaymentResult {
  ok: boolean;
  provider?: LightningWalletProvider;
  preimage?: string;
  pendingExternal?: boolean;
  error?: string;
}

export function getNwcConnection(): string {
  if (typeof window === "undefined") return "";
  return (
    window.sessionStorage.getItem(NWC_SESSION_STORAGE_KEY)?.trim() ||
    window.localStorage.getItem(NWC_STORAGE_KEY)?.trim() ||
    ""
  );
}

export function getNwcPersistence(): "session" | "device" | null {
  if (typeof window === "undefined") return null;
  if (window.sessionStorage.getItem(NWC_SESSION_STORAGE_KEY)?.trim()) return "session";
  if (window.localStorage.getItem(NWC_STORAGE_KEY)?.trim()) return "device";
  return null;
}

export function saveNwcConnection(input: string, options: { rememberOnDevice?: boolean } = {}): void {
  if (typeof window === "undefined") throw new Error("Web environment required.");
  const value = input.trim();
  if (!/^nostr\+walletconnect:\/\//i.test(value)) {
    throw new Error("NWC connection must begin with nostr+walletconnect://.");
  }
  const url = new URL(value);
  if (!/^[a-f0-9]{64}$/i.test(url.hostname)) throw new Error("NWC wallet public key is malformed.");
  const relay = url.searchParams.get("relay")?.trim() ?? "";
  const secret = url.searchParams.get("secret")?.trim() ?? "";
  if (!relay || !secret) {
    throw new Error("NWC connection is missing its relay or secret.");
  }
  let relayUrl: URL;
  try {
    relayUrl = new URL(relay);
  } catch {
    throw new Error("NWC relay URL is malformed.");
  }
  if (relayUrl.protocol !== "wss:") throw new Error("NWC relay must use wss://.");
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("NWC connection secret is malformed.");
  if (options.rememberOnDevice) {
    window.localStorage.setItem(NWC_STORAGE_KEY, value);
    window.sessionStorage.removeItem(NWC_SESSION_STORAGE_KEY);
  } else {
    window.sessionStorage.setItem(NWC_SESSION_STORAGE_KEY, value);
    window.localStorage.removeItem(NWC_STORAGE_KEY);
  }
}

export function clearNwcConnection(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(NWC_STORAGE_KEY);
  window.sessionStorage.removeItem(NWC_SESSION_STORAGE_KEY);
}

async function payWithNwc(invoice: string, connection: string): Promise<LightningPaymentResult> {
  const { NWCClient } = await import("@getalby/sdk");
  const client = new NWCClient({ nostrWalletConnectUrl: connection });
  try {
    const result = await client.payInvoice({ invoice });
    return { ok: true, provider: "nwc", preimage: result.preimage };
  } finally {
    client.close();
  }
}

async function payWithWebLn(invoice: string): Promise<LightningPaymentResult> {
  const webln = (window as Window & { webln?: { enable(): Promise<void>; sendPayment(value: string): Promise<{ preimage?: string }> } }).webln;
  if (!webln) return { ok: false, error: "WebLN provider not found." };
  await webln.enable();
  const result = await webln.sendPayment(invoice);
  return { ok: true, provider: "webln", preimage: result?.preimage };
}

export async function payLightningInvoice(invoiceRaw: string): Promise<LightningPaymentResult> {
  if (typeof window === "undefined") return { ok: false, error: "Web environment required." };
  const invoice = invoiceRaw.trim().toLowerCase();
  if (!/^ln(?:bc|tb|bcrt|sb|tbs)[0-9a-z]+$/.test(invoice)) {
    return { ok: false, error: "BOLT11 invoice is malformed." };
  }
  const nwc = getNwcConnection();
  if (nwc) {
    try {
      return await payWithNwc(invoice, nwc);
    } catch (error) {
      return { ok: false, provider: "nwc", error: error instanceof Error ? error.message : "NWC payment failed." };
    }
  }
  if ((window as Window & { webln?: unknown }).webln) {
    try {
      return await payWithWebLn(invoice);
    } catch (error) {
      return { ok: false, provider: "webln", error: error instanceof Error ? error.message : "WebLN payment failed." };
    }
  }
  try {
    window.location.href = `lightning:${invoice}`;
    return { ok: true, provider: "wallet_uri", pendingExternal: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to open a Lightning wallet." };
  }
}

export async function testNwcConnection(input?: string): Promise<void> {
  const connection = (input ?? getNwcConnection()).trim();
  if (!connection) throw new Error("Enter an NWC connection first.");
  const { NWCClient } = await import("@getalby/sdk");
  const client = new NWCClient({ nostrWalletConnectUrl: connection });
  try {
    const info = (await client.getInfo()) as { methods?: unknown };
    if (Array.isArray(info.methods) && !info.methods.includes("pay_invoice")) {
      throw new Error("This NWC connection does not allow invoice payments.");
    }
  } finally {
    client.close();
  }
}
