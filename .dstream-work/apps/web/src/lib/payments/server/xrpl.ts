import { decimalToAtomic } from "./amount";
import { postJson } from "./http";
import type { PaymentRailCapability, PaymentVerificationInput, VerifiedPayment } from "./types";
import { PaymentVerificationError } from "./types";

interface XrplRpcResponse {
  result?: XrplTransaction & { error?: string; error_message?: string };
  error?: { code?: number; message?: string };
}

interface XrplTransaction {
  hash?: string;
  validated?: boolean;
  ledger_index?: number;
  TransactionType?: string;
  Account?: string;
  Destination?: string;
  DestinationTag?: number;
  Amount?: string | Record<string, unknown>;
  DeliverMax?: string | Record<string, unknown>;
  meta?: {
    TransactionResult?: string;
    delivered_amount?: string | Record<string, unknown>;
    DeliveredAmount?: string | Record<string, unknown>;
  };
}

function getOrigin(): string {
  return (process.env.DSTREAM_XRPL_RPC_ORIGIN ?? "").trim();
}

function getNetwork(): string {
  return (process.env.DSTREAM_XRPL_NETWORK ?? "mainnet").trim().toLowerCase() || "mainnet";
}

function normalizeAddress(input: string): string {
  const value = input.trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value)) {
    throw new PaymentVerificationError("XRP recipient address is malformed.", 400);
  }
  return value;
}

function assertRequestedNetwork(input: PaymentVerificationInput): void {
  const requested = (input.network ?? "").trim().toLowerCase();
  if (!requested) return;
  const network = getNetwork();
  const aliases = new Set(["xrp", "xrpl", network, `xrpl:${network}`]);
  if (network === "mainnet") aliases.add("main");
  if (!aliases.has(requested)) throw new PaymentVerificationError(`XRP payment intent network does not match ${network}.`, 400);
}

export function getXrplCapabilities(): PaymentRailCapability[] {
  const configured = !!getOrigin();
  return [
    {
      asset: "xrp",
      railId: "xrpl",
      network: `xrpl:${getNetwork()}`,
      configured,
      confirmationsRequired: 1,
      verifier: "json_rpc",
      ...(!configured ? { reason: "XRPL RPC endpoint is not configured." } : {})
    }
  ];
}

export async function verifyXrplPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  if (input.asset !== "xrp") throw new PaymentVerificationError("XRPL verifier requires the XRP asset.", 400);
  const origin = getOrigin();
  if (!origin) throw new PaymentVerificationError("XRPL settlement verification is not configured.", 503);
  const txId = (input.txId ?? input.proof?.txId ?? input.proof?.transactionHash ?? "").trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(txId)) throw new PaymentVerificationError("XRP transaction hash is malformed.", 400);
  const recipient = normalizeAddress(input.address);
  assertRequestedNetwork(input);
  const response = await postJson<XrplRpcResponse>({
    url: origin,
    body: { method: "tx", params: [{ transaction: txId, binary: false, api_version: 2 }] },
    label: "XRPL RPC"
  });
  if (response.error) {
    throw new PaymentVerificationError(`XRPL RPC rejected the request: ${response.error.message ?? response.error.code ?? "unknown"}.`, 502);
  }
  const tx = response.result;
  if (!tx || tx.error) {
    throw new PaymentVerificationError(tx?.error_message || "XRP transaction is not available on the configured RPC.", 404);
  }
  if ((tx.hash ?? "").toUpperCase() !== txId) throw new PaymentVerificationError("XRPL RPC returned a different transaction.", 502);
  if (tx.validated !== true) throw new PaymentVerificationError("XRP transaction is not in a validated ledger.", 409);
  if (tx.meta?.TransactionResult !== "tesSUCCESS") throw new PaymentVerificationError("XRP transaction did not succeed.");
  if (tx.TransactionType !== "Payment") throw new PaymentVerificationError("XRP transaction is not a payment.");
  if (tx.Destination !== recipient) throw new PaymentVerificationError("XRP transaction recipient does not match the payment intent.");

  const expectedTag = input.proof?.destinationTag;
  if (expectedTag !== undefined && expectedTag !== null && String(tx.DestinationTag ?? "") !== String(expectedTag)) {
    throw new PaymentVerificationError("XRP destination tag does not match the payment intent.");
  }

  const delivered = tx.meta?.delivered_amount ?? tx.meta?.DeliveredAmount ?? tx.Amount ?? tx.DeliverMax;
  if (typeof delivered !== "string" || !/^\d+$/.test(delivered)) {
    throw new PaymentVerificationError("XRP payment delivered a non-XRP asset or malformed amount.");
  }
  const paidDrops = BigInt(delivered);
  if (paidDrops < decimalToAtomic(input.amount, 6)) {
    throw new PaymentVerificationError("XRP transaction amount is below the required payment amount.");
  }
  if (!Number.isSafeInteger(tx.ledger_index) || Number(tx.ledger_index) <= 0) {
    throw new PaymentVerificationError("XRP validated ledger index is missing.", 502);
  }
  const network = `xrpl:${getNetwork()}`;
  return {
    asset: "xrp",
    railId: "xrpl",
    network,
    txId,
    settlementKey: `xrp:${network}:${txId}`,
    recipient,
    amountAtomic: paidDrops.toString(),
    confirmations: 1,
    blockHeight: Number(tx.ledger_index),
    finality: "finalized",
    ...(tx.Account ? { payer: tx.Account } : {}),
    ...(tx.DestinationTag !== undefined ? { metadata: { destinationTag: tx.DestinationTag } } : {})
  };
}
