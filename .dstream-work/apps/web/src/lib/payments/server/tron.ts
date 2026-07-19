import { decimalToAtomic, parseIntegerQuantity, parsePositiveEnvInt } from "./amount";
import { joinOriginPath, postJson } from "./http";
import type { NativePaymentRailCapability, NativePaymentVerificationInput, VerifiedNativePayment } from "./types";
import { NativePaymentVerificationError } from "./types";

interface TronTransaction {
  txID?: string;
  ret?: Array<{ contractRet?: string }>;
  raw_data?: {
    contract?: Array<{
      type?: string;
      parameter?: { value?: { to_address?: string; amount?: number | string } };
    }>;
  };
}

interface TronTransactionInfo {
  id?: string;
  blockNumber?: number | string;
  result?: string;
  receipt?: { result?: string };
}

interface TronNowBlock {
  block_header?: { raw_data?: { number?: number | string } };
}

function getOrigin(): string {
  return (process.env.DSTREAM_TRON_RPC_ORIGIN ?? "").trim();
}

function getConfirmationsRequired(): number {
  return parsePositiveEnvInt("DSTREAM_TRON_CONFIRMATIONS_REQUIRED", 20, 10000);
}

function tronHeaders(): Record<string, string> {
  const apiKey = (process.env.DSTREAM_TRON_API_KEY ?? "").trim();
  return apiKey ? { "TRON-PRO-API-KEY": apiKey } : {};
}

async function tronRpc<T>(path: string, body: unknown): Promise<T> {
  const origin = getOrigin();
  if (!origin) throw new NativePaymentVerificationError("TRON settlement verification is not configured.", 503);
  return postJson<T>({
    url: joinOriginPath(origin, path),
    headers: tronHeaders(),
    body,
    label: "TRON RPC"
  });
}

export function getTronCapability(): NativePaymentRailCapability {
  return {
    asset: "trx",
    railId: "tron",
    network: "tron:mainnet",
    configured: !!getOrigin(),
    confirmationsRequired: getConfirmationsRequired()
  };
}

export async function verifyTronPayment(input: NativePaymentVerificationInput): Promise<VerifiedNativePayment> {
  const txId = input.txId.trim().toLowerCase();
  const recipient = input.address.trim();
  if (!/^[a-f0-9]{64}$/.test(txId)) throw new NativePaymentVerificationError("TRON transaction ID is malformed.", 400);
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(recipient)) {
    throw new NativePaymentVerificationError("TRON recipient address is malformed.", 400);
  }
  const expectedSun = decimalToAtomic(input.amount, 6);
  const request = { value: txId, visible: true };
  const tx = await tronRpc<TronTransaction>("walletsolidity/gettransactionbyid", request);
  const info = await tronRpc<TronTransactionInfo>("wallet/gettransactioninfobyid", request);
  if ((tx.txID ?? "").toLowerCase() !== txId || (info.id ?? "").toLowerCase() !== txId) {
    throw new NativePaymentVerificationError("TRON transaction is not confirmed on the configured RPC.", 404);
  }
  if ((tx.ret?.[0]?.contractRet ?? "").toUpperCase() !== "SUCCESS") {
    throw new NativePaymentVerificationError("TRON transaction failed.");
  }
  const receiptResult = (info.receipt?.result ?? info.result ?? "SUCCESS").toUpperCase();
  if (receiptResult !== "SUCCESS") throw new NativePaymentVerificationError("TRON transaction receipt failed.");

  const contracts = tx.raw_data?.contract ?? [];
  if (contracts.length !== 1 || contracts[0]?.type !== "TransferContract") {
    throw new NativePaymentVerificationError("TRON transaction is not a native TRX transfer.");
  }
  const transfer = contracts[0]?.parameter?.value;
  if (transfer?.to_address !== recipient) {
    throw new NativePaymentVerificationError("TRON transaction recipient does not match the package recipient.");
  }
  const paidSun = parseIntegerQuantity(transfer.amount, "TRON transfer amount");
  if (paidSun < expectedSun) throw new NativePaymentVerificationError("TRON transaction amount is below the package price.");

  const blockHeight = parseIntegerQuantity(info.blockNumber, "TRON payment block");
  const headResponse = await tronRpc<TronNowBlock>("walletsolidity/getnowblock", { visible: true });
  const head = parseIntegerQuantity(headResponse.block_header?.raw_data?.number, "TRON head block");
  if (head < blockHeight) throw new NativePaymentVerificationError("TRON RPC head is behind the payment block.", 502);
  const confirmationsBig = head - blockHeight + 1n;
  const confirmations = Number(confirmationsBig);
  const required = getConfirmationsRequired();
  if (!Number.isSafeInteger(confirmations) || confirmations < required) {
    throw new NativePaymentVerificationError(`TRON payment has ${confirmations}/${required} confirmations.`, 409);
  }

  return {
    asset: "trx",
    railId: "tron",
    network: "tron:mainnet",
    txId,
    settlementKey: `trx:mainnet:${txId}`,
    recipient,
    amountAtomic: paidSun.toString(),
    confirmations,
    blockHeight: Number(blockHeight)
  };
}
