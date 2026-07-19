import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { verifyEvent, type Event } from "nostr-tools";
import {
  decodeLightningInvoice,
  encodeLnurl,
  fetchLnurlPayMetadata,
  resolveLnurlPayUrl
} from "../lightning";
import type { PaymentRailCapability, PaymentVerificationInput, VerifiedPayment } from "./types";
import { PaymentVerificationError } from "./types";

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function isPrivateIpv4(input: string): boolean {
  const parts = input.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIp(input: string): boolean {
  if (isIP(input) === 4) return isPrivateIpv4(input);
  const value = input.toLowerCase();
  if (isIP(value) !== 6) return true;
  if (value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]!) : false;
}

async function assertPublicLnurlDestination(destination: string): Promise<void> {
  const url = new URL(resolveLnurlPayUrl(destination));
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new PaymentVerificationError("Lightning address provider must be publicly reachable.", 400);
  }
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new PaymentVerificationError("Lightning address provider cannot use a private address.", 400);
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new PaymentVerificationError("Lightning address provider DNS lookup failed.", 502);
  }
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new PaymentVerificationError("Lightning address provider resolved to a private address.", 400);
  }
}

function parseNostrEvent(input: unknown, label: string): Event {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new PaymentVerificationError(`${label} is not valid JSON.`, 400);
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentVerificationError(`${label} is missing.`, 400);
  }
  const event = value as Event;
  if (!verifyEvent(event)) throw new PaymentVerificationError(`${label} signature is invalid.`, 400);
  return event;
}

function tagValues(event: Event, name: string): string[] {
  return event.tags.filter((tag) => tag[0] === name && typeof tag[1] === "string").map((tag) => tag[1]!);
}

function oneTag(event: Event, name: string, label: string): string {
  const values = tagValues(event, name);
  if (values.length !== 1) throw new PaymentVerificationError(`${label} must contain exactly one ${name} tag.`, 400);
  return values[0]!;
}

export function getLightningCapabilities(): PaymentRailCapability[] {
  return [
    {
      asset: "btc",
      railId: "lightning",
      network: "lightning:mainnet",
      configured: true,
      confirmationsRequired: 1,
      verifier: "lnurl_nip57"
    }
  ];
}

export async function verifyLightningPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  if (input.asset !== "btc") throw new PaymentVerificationError("Lightning verifier requires the BTC asset.", 400);
  const destination = (input.proof?.lightningAddress ?? input.address).trim();
  if (!destination) throw new PaymentVerificationError("Lightning recipient address is missing.", 400);
  await assertPublicLnurlDestination(destination);
  const { url, metadata } = await fetchLnurlPayMetadata(destination);
  if (!metadata.allowsNostr || !metadata.nostrPubkey) {
    throw new PaymentVerificationError("Lightning recipient does not provide NIP-57 payment receipts.", 503);
  }

  const receipt = parseNostrEvent(input.proof?.zapReceipt, "NIP-57 zap receipt");
  if (receipt.kind !== 9735) throw new PaymentVerificationError("Lightning receipt must be a NIP-57 kind 9735 event.", 400);
  if (receipt.pubkey.toLowerCase() !== metadata.nostrPubkey.toLowerCase()) {
    throw new PaymentVerificationError("Lightning receipt was not signed by the recipient's LNURL provider.");
  }
  const description = oneTag(receipt, "description", "Lightning receipt");
  const invoice = oneTag(receipt, "bolt11", "Lightning receipt");
  const zapRequest = parseNostrEvent(description, "NIP-57 zap request");
  if (zapRequest.kind !== 9734) throw new PaymentVerificationError("Lightning receipt does not contain a NIP-57 zap request.", 400);
  const zapRecipient = oneTag(zapRequest, "p", "Lightning zap request").toLowerCase();
  const receiptRecipient = oneTag(receipt, "p", "Lightning receipt").toLowerCase();
  if (receiptRecipient !== zapRecipient) {
    throw new PaymentVerificationError("Lightning receipt recipient does not match its zap request.");
  }
  if (input.recipientPubkey && zapRecipient !== input.recipientPubkey.toLowerCase()) {
    throw new PaymentVerificationError("Lightning zap recipient does not match the payment intent.");
  }
  if (input.intentId && zapRequest.content !== `dstream-intent:${input.intentId}`) {
    throw new PaymentVerificationError("Lightning zap request is not bound to this payment intent.");
  }
  const amount = input.amount.trim();
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
    throw new PaymentVerificationError("Lightning payment amount must be positive satoshis.", 400);
  }
  const expectedSats = BigInt(amount);
  const expectedMsat = expectedSats * 1000n;
  const requestAmount = oneTag(zapRequest, "amount", "Lightning zap request");
  if (!/^\d+$/.test(requestAmount) || BigInt(requestAmount) !== expectedMsat) {
    throw new PaymentVerificationError("Lightning zap amount does not match the payment intent.");
  }
  const expectedLnurl = encodeLnurl(url);
  const requestLnurl = oneTag(zapRequest, "lnurl", "Lightning zap request");
  if (requestLnurl.toLowerCase() !== expectedLnurl.toLowerCase()) {
    throw new PaymentVerificationError("Lightning zap LNURL does not match the recipient.");
  }

  const invoiceDetails = decodeLightningInvoice(invoice);
  if (invoiceDetails.network !== "bc") throw new PaymentVerificationError("Lightning invoice is not for Bitcoin mainnet.");
  if (invoiceDetails.amountMsat !== expectedMsat) throw new PaymentVerificationError("Lightning invoice amount does not match the payment intent.");
  if (!invoiceDetails.descriptionHash || invoiceDetails.descriptionHash !== sha256Hex(description)) {
    throw new PaymentVerificationError("Lightning invoice is not cryptographically bound to the zap request.");
  }
  if (invoiceDetails.expiresAt < receipt.created_at) {
    throw new PaymentVerificationError("Lightning receipt was issued after the invoice expired.");
  }

  const receiptPaymentHash = invoiceDetails.paymentHash;
  const suppliedPreimage = typeof input.proof?.preimage === "string" ? input.proof.preimage.trim().toLowerCase() : "";
  if (suppliedPreimage) {
    if (!/^[a-f0-9]{64}$/.test(suppliedPreimage) || sha256Hex(Buffer.from(suppliedPreimage, "hex")) !== receiptPaymentHash) {
      throw new PaymentVerificationError("Lightning payment preimage does not match the invoice.");
    }
  }

  return {
    asset: "btc",
    railId: "lightning",
    network: "lightning:mainnet",
    txId: receiptPaymentHash,
    settlementKey: `btc:lightning:mainnet:${receiptPaymentHash}`,
    recipient: destination,
    amountAtomic: expectedSats.toString(),
    confirmations: 1,
    blockHeight: 0,
    finality: "provider_attested",
    payer: zapRequest.pubkey,
    metadata: {
      amountMsat: expectedMsat.toString(),
      invoice,
      receiptId: receipt.id,
      receiptSigner: receipt.pubkey,
      preimageVerified: !!suppliedPreimage
    }
  };
}
