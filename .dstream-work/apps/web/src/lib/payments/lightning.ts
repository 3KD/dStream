import { bech32 } from "@scure/base";
import { decode as decodeBolt11 } from "light-bolt11-decoder";

export interface LnurlPayMetadata {
  callback: string;
  minSendable: number;
  maxSendable: number;
  allowsNostr: boolean;
  nostrPubkey?: string;
  metadata?: string;
  commentAllowed?: number;
  tag?: string;
  status?: string;
  reason?: string;
}

export interface Bolt11Details {
  invoice: string;
  network: string;
  amountMsat: bigint;
  paymentHash: string;
  descriptionHash?: string;
  timestamp: number;
  expiry: number;
  expiresAt: number;
}

export interface LightningZapRequestInput {
  destination: string;
  amountSats: bigint;
  recipientPubkey: string;
  senderPubkey: string;
  relays: string[];
  content?: string;
  eventId?: string;
  eventCoordinate?: string;
  eventKind?: number;
  signEvent: (event: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface LightningInvoiceRequestResult {
  metadata: LnurlPayMetadata;
  lnurlPayUrl: string;
  lnurl: string;
  zapRequest: Record<string, unknown>;
  zapRequestJson: string;
  invoice: string;
  invoiceDetails: Bolt11Details;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isLoopbackHost(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value.endsWith(".localhost");
}

function validatePayUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Lightning address resolved to an invalid LNURL endpoint.");
  }
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname)))) {
    throw new Error("Lightning LNURL endpoints must use HTTPS.");
  }
  return url;
}

export function resolveLnurlPayUrl(destinationRaw: string): string {
  const destination = destinationRaw.trim().replace(/^lightning:/i, "");
  const addressMatch = destination.match(/^([^@\s]+)@([^@\s]+)$/);
  if (addressMatch) {
    const user = encodeURIComponent(addressMatch[1]!);
    const host = addressMatch[2]!.toLowerCase();
    return validatePayUrl(`https://${host}/.well-known/lnurlp/${user}`).toString();
  }
  if (/^lnurl[0-9a-z]+$/i.test(destination)) {
    try {
      const decoded = bech32.decode(destination.toLowerCase() as `lnurl1${string}`, false);
      if (decoded.prefix !== "lnurl") throw new Error("wrong prefix");
      return validatePayUrl(new TextDecoder().decode(bech32.fromWords(decoded.words))).toString();
    } catch {
      throw new Error("Lightning LNURL is malformed.");
    }
  }
  throw new Error("Use a Lightning address or LNURL destination.");
}

export function encodeLnurl(input: string): string {
  const url = validatePayUrl(input).toString();
  return bech32.encode("lnurl", bech32.toWords(new TextEncoder().encode(url)), false);
}

export async function fetchLnurlPayMetadata(destination: string): Promise<{ url: string; metadata: LnurlPayMetadata }> {
  const url = resolveLnurlPayUrl(destination);
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`Lightning address provider returned HTTP ${response.status}.`);
  const metadata = (await response.json()) as LnurlPayMetadata;
  if (metadata.status?.toUpperCase() === "ERROR") throw new Error(metadata.reason || "Lightning address provider rejected the request.");
  validatePayUrl(metadata.callback);
  if (!Number.isSafeInteger(metadata.minSendable) || !Number.isSafeInteger(metadata.maxSendable)) {
    throw new Error("Lightning address provider returned invalid payment limits.");
  }
  if (metadata.minSendable <= 0 || metadata.maxSendable < metadata.minSendable) {
    throw new Error("Lightning address provider returned inconsistent payment limits.");
  }
  if (metadata.nostrPubkey && !/^[a-f0-9]{64}$/i.test(metadata.nostrPubkey)) {
    throw new Error("Lightning address provider returned an invalid Nostr receipt key.");
  }
  return { url, metadata };
}

function sectionValue(decoded: ReturnType<typeof decodeBolt11>, name: string): unknown {
  return (decoded.sections as Array<{ name?: string; value?: unknown }>).find((section) => section.name === name)?.value;
}

export function decodeLightningInvoice(invoiceRaw: string): Bolt11Details {
  const invoice = invoiceRaw.trim().toLowerCase();
  let decoded: ReturnType<typeof decodeBolt11>;
  try {
    decoded = decodeBolt11(invoice);
  } catch {
    throw new Error("Lightning provider returned a malformed BOLT11 invoice.");
  }
  const amountRaw = sectionValue(decoded, "amount");
  const paymentHash = sectionValue(decoded, "payment_hash");
  const descriptionHash = sectionValue(decoded, "description_hash");
  const networkSection = (decoded.sections as Array<{ name?: string; letters?: string }>).find(
    (section) => section.name === "coin_network"
  );
  const timestamp = Number(sectionValue(decoded, "timestamp"));
  const expiry = Number(sectionValue(decoded, "expiry") ?? decoded.expiry ?? 3600);
  if (typeof amountRaw !== "string" || !/^\d+$/.test(amountRaw)) throw new Error("Lightning invoice has no fixed amount.");
  if (typeof paymentHash !== "string" || !/^[a-f0-9]{64}$/i.test(paymentHash)) {
    throw new Error("Lightning invoice payment hash is missing.");
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isSafeInteger(expiry) || expiry <= 0) {
    throw new Error("Lightning invoice expiry is malformed.");
  }
  return {
    invoice,
    network: networkSection?.letters ?? "unknown",
    amountMsat: BigInt(amountRaw),
    paymentHash: paymentHash.toLowerCase(),
    ...(typeof descriptionHash === "string" && /^[a-f0-9]{64}$/i.test(descriptionHash)
      ? { descriptionHash: descriptionHash.toLowerCase() }
      : {}),
    timestamp,
    expiry,
    expiresAt: timestamp + expiry
  };
}

export async function requestLightningZapInvoice(input: LightningZapRequestInput): Promise<LightningInvoiceRequestResult> {
  if (input.amountSats <= 0n) throw new Error("Lightning amount must be positive.");
  if (!/^[a-f0-9]{64}$/i.test(input.recipientPubkey) || !/^[a-f0-9]{64}$/i.test(input.senderPubkey)) {
    throw new Error("Lightning zap requires valid sender and recipient Nostr identities.");
  }
  const amountMsat = input.amountSats * 1000n;
  if (amountMsat > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Lightning amount exceeds LNURL limits.");
  const { url, metadata } = await fetchLnurlPayMetadata(input.destination);
  if (!metadata.allowsNostr || !metadata.nostrPubkey) {
    throw new Error("This Lightning address does not support NIP-57 zap receipts.");
  }
  if (amountMsat < BigInt(metadata.minSendable) || amountMsat > BigInt(metadata.maxSendable)) {
    throw new Error(`Lightning amount must be between ${metadata.minSendable / 1000} and ${metadata.maxSendable / 1000} sats.`);
  }
  const lnurl = encodeLnurl(url);
  const tags: string[][] = [
    ["relays", ...input.relays],
    ["amount", amountMsat.toString()],
    ["lnurl", lnurl],
    ["p", input.recipientPubkey.toLowerCase()]
  ];
  if (input.eventId) tags.push(["e", input.eventId.toLowerCase()]);
  if (input.eventCoordinate) tags.push(["a", input.eventCoordinate]);
  if (Number.isInteger(input.eventKind)) tags.push(["k", String(input.eventKind)]);
  const unsigned = {
    kind: 9734,
    content: (input.content ?? "").slice(0, 280),
    pubkey: input.senderPubkey.toLowerCase(),
    created_at: Math.floor(Date.now() / 1000),
    tags
  };
  const zapRequest = await input.signEvent(unsigned);
  const zapRequestJson = JSON.stringify(zapRequest);
  const callback = validatePayUrl(metadata.callback);
  callback.searchParams.set("amount", amountMsat.toString());
  callback.searchParams.set("nostr", zapRequestJson);
  callback.searchParams.set("lnurl", lnurl);
  const response = await fetch(callback, { headers: { accept: "application/json" }, cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`Lightning invoice callback returned HTTP ${response.status}.`);
  const payload = (await response.json()) as { pr?: string; status?: string; reason?: string };
  if (payload.status?.toUpperCase() === "ERROR") throw new Error(payload.reason || "Lightning invoice callback rejected the request.");
  if (!payload.pr) throw new Error("Lightning invoice callback returned no invoice.");
  const invoiceDetails = decodeLightningInvoice(payload.pr);
  if (invoiceDetails.amountMsat !== amountMsat) throw new Error("Lightning invoice amount does not match the zap request.");
  if (invoiceDetails.network !== "bc") throw new Error("Lightning invoice is not for Bitcoin mainnet.");
  if (!invoiceDetails.descriptionHash || invoiceDetails.descriptionHash !== (await sha256Hex(zapRequestJson))) {
    throw new Error("Lightning invoice is not cryptographically bound to the signed zap request.");
  }
  if (invoiceDetails.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("Lightning invoice is already expired.");
  return { metadata, lnurlPayUrl: url, lnurl, zapRequest, zapRequestJson, invoice: payload.pr, invoiceDetails };
}
