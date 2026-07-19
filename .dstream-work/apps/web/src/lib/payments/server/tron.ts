import { createHash } from "node:crypto";
import type { StreamPaymentAsset } from "@dstream/protocol";
import { base58 } from "@scure/base";
import { decimalToAtomic, parseIntegerQuantity, parsePositiveEnvInt } from "./amount";
import { joinOriginPath, postJson } from "./http";
import type { PaymentRailCapability, PaymentVerificationInput, VerifiedPayment } from "./types";
import { PaymentVerificationError } from "./types";

type TronAsset = Extract<StreamPaymentAsset, "trx" | "usdt">;

interface TronContractValue {
  owner_address?: string;
  to_address?: string;
  contract_address?: string;
  amount?: number | string;
  data?: string;
}

interface TronTransaction {
  txID?: string;
  ret?: Array<{ contractRet?: string }>;
  raw_data?: {
    contract?: Array<{
      type?: string;
      parameter?: { value?: TronContractValue };
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

const TRC20_TRANSFER_SELECTOR = "a9059cbb";
const DEFAULT_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

function getOrigin(): string {
  return (process.env.DSTREAM_TRON_RPC_ORIGIN ?? "").trim();
}

function getConfirmationsRequired(): number {
  return parsePositiveEnvInt("DSTREAM_TRON_CONFIRMATIONS_REQUIRED", 20, 10000);
}

function getUsdtContract(): string {
  return (process.env.DSTREAM_TRON_USDT_CONTRACT ?? DEFAULT_USDT_CONTRACT).trim();
}

function assertRequestedNetwork(input: PaymentVerificationInput): void {
  const requested = (input.network ?? "").trim().toLowerCase();
  if (!requested) return;
  const aliases = new Set(["tron", "tron:mainnet", "main", "mainnet", "trc20"]);
  if (!aliases.has(requested)) throw new PaymentVerificationError("TRON payment intent network must be mainnet.", 400);
}

function tronHeaders(): Record<string, string> {
  const apiKey = (process.env.DSTREAM_TRON_API_KEY ?? "").trim();
  return apiKey ? { "TRON-PRO-API-KEY": apiKey } : {};
}

async function tronRpc<T>(path: string, body: unknown): Promise<T> {
  const origin = getOrigin();
  if (!origin) throw new PaymentVerificationError("TRON settlement verification is not configured.", 503);
  return postJson<T>({
    url: joinOriginPath(origin, path),
    headers: tronHeaders(),
    body,
    label: "TRON RPC"
  });
}

function sha256(input: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(input).digest());
}

function tronAddressPayload(input: string): Uint8Array {
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(input.trim());
  } catch {
    throw new PaymentVerificationError("TRON recipient address is malformed.", 400);
  }
  if (decoded.length !== 25) throw new PaymentVerificationError("TRON recipient address is malformed.", 400);
  const payload = decoded.slice(0, 21);
  const checksum = decoded.slice(21);
  const expected = sha256(sha256(payload)).slice(0, 4);
  if (!expected.every((value, index) => value === checksum[index]) || payload[0] !== 0x41) {
    throw new PaymentVerificationError("TRON recipient address checksum is invalid.", 400);
  }
  return payload;
}

function addressHex(input: string): string {
  return Buffer.from(tronAddressPayload(input)).toString("hex").toLowerCase();
}

function normalizeVisibleAddress(input: string | undefined): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const value = input.trim();
  if (value.startsWith("T")) return value;
  if (/^(41)?[a-f0-9]{40}$/i.test(value)) return value.toLowerCase().replace(/^41/, "");
  return null;
}

export function getTronCapabilities(): PaymentRailCapability[] {
  const configured = !!getOrigin();
  const common = {
    railId: "tron" as const,
    network: "tron:mainnet",
    configured,
    confirmationsRequired: getConfirmationsRequired(),
    verifier: "rest" as const,
    ...(!configured ? { reason: "TRON RPC endpoint is not configured." } : {})
  };
  return [
    { asset: "trx", ...common },
    { asset: "usdt", ...common }
  ];
}

export function getTronCapability(): PaymentRailCapability {
  return getTronCapabilities()[0]!;
}

export async function verifyTronPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  if (input.asset !== "trx" && input.asset !== "usdt") {
    throw new PaymentVerificationError(`${input.asset.toUpperCase()} is not configured on the TRON rail.`, 400);
  }
  const asset = input.asset as TronAsset;
  const txId = (input.txId ?? input.proof?.txId ?? input.proof?.transactionHash ?? "").trim().toLowerCase();
  const recipient = input.address.trim();
  if (!/^[a-f0-9]{64}$/.test(txId)) throw new PaymentVerificationError("TRON transaction ID is malformed.", 400);
  assertRequestedNetwork(input);
  const recipientHex = addressHex(recipient);
  const request = { value: txId, visible: true };
  const tx = await tronRpc<TronTransaction>("walletsolidity/gettransactionbyid", request);
  const info = await tronRpc<TronTransactionInfo>("wallet/gettransactioninfobyid", request);
  if ((tx.txID ?? "").toLowerCase() !== txId || (info.id ?? "").toLowerCase() !== txId) {
    throw new PaymentVerificationError("TRON transaction is not confirmed on the configured RPC.", 404);
  }
  if ((tx.ret?.[0]?.contractRet ?? "").toUpperCase() !== "SUCCESS") {
    throw new PaymentVerificationError("TRON transaction failed.");
  }
  const receiptResult = (info.receipt?.result ?? info.result ?? "SUCCESS").toUpperCase();
  if (receiptResult !== "SUCCESS") throw new PaymentVerificationError("TRON transaction receipt failed.");

  const contracts = tx.raw_data?.contract ?? [];
  if (contracts.length !== 1) throw new PaymentVerificationError("TRON payment must contain exactly one contract call.");
  const contract = contracts[0]!;
  const value = contract.parameter?.value;
  let paidAtomic: bigint;
  let payer: string | undefined;
  let tokenContract: string | undefined;

  if (asset === "trx") {
    if (contract.type !== "TransferContract") {
      throw new PaymentVerificationError("TRON transaction is not a native TRX transfer.");
    }
    const actualRecipient = normalizeVisibleAddress(value?.to_address);
    const recipientMatches = actualRecipient?.startsWith("T")
      ? actualRecipient === recipient
      : actualRecipient === recipientHex.slice(2);
    if (!recipientMatches) {
      throw new PaymentVerificationError("TRON transaction recipient does not match the payment intent.");
    }
    paidAtomic = parseIntegerQuantity(value?.amount, "TRON transfer amount");
    if (paidAtomic < decimalToAtomic(input.amount, 6)) {
      throw new PaymentVerificationError("TRX transaction amount is below the required payment amount.");
    }
    payer = normalizeVisibleAddress(value?.owner_address) ?? undefined;
  } else {
    if (contract.type !== "TriggerSmartContract") {
      throw new PaymentVerificationError("TRON transaction is not a TRC-20 transfer.");
    }
    const configuredContract = getUsdtContract();
    const configuredContractHex = addressHex(configuredContract);
    const actualContract = normalizeVisibleAddress(value?.contract_address);
    const contractMatches = actualContract?.startsWith("T")
      ? actualContract === configuredContract
      : actualContract === configuredContractHex.slice(2);
    if (!contractMatches) throw new PaymentVerificationError("USDT transaction targets the wrong TRC-20 contract.");
    const data = (value?.data ?? "").toLowerCase().replace(/^0x/, "");
    if (!new RegExp(`^${TRC20_TRANSFER_SELECTOR}[a-f0-9]{128}$`).test(data)) {
      throw new PaymentVerificationError("TRC-20 transfer calldata is malformed.", 502);
    }
    const callRecipient = data.slice(8, 72).slice(-40);
    if (callRecipient !== recipientHex.slice(2)) {
      throw new PaymentVerificationError("TRC-20 transfer recipient does not match the payment intent.");
    }
    paidAtomic = BigInt(`0x${data.slice(72, 136)}`);
    if (paidAtomic < decimalToAtomic(input.amount, 6)) {
      throw new PaymentVerificationError("USDT transaction amount is below the required payment amount.");
    }
    payer = normalizeVisibleAddress(value?.owner_address) ?? undefined;
    tokenContract = configuredContract;
  }

  const blockHeightBig = parseIntegerQuantity(info.blockNumber, "TRON payment block");
  const headResponse = await tronRpc<TronNowBlock>("walletsolidity/getnowblock", { visible: true });
  const head = parseIntegerQuantity(headResponse.block_header?.raw_data?.number, "TRON head block");
  if (head < blockHeightBig) throw new PaymentVerificationError("TRON RPC head is behind the payment block.", 502);
  const confirmationsBig = head - blockHeightBig + 1n;
  const confirmations = Number(confirmationsBig);
  const required = getConfirmationsRequired();
  if (!Number.isSafeInteger(confirmations) || confirmations < required) {
    throw new PaymentVerificationError(`TRON payment has ${confirmations}/${required} confirmations.`, 409);
  }

  return {
    asset,
    railId: "tron",
    network: "tron:mainnet",
    txId,
    settlementKey: `${asset}:tron:mainnet:${txId}`,
    recipient,
    amountAtomic: paidAtomic.toString(),
    confirmations,
    blockHeight: Number(blockHeightBig),
    finality: "confirmed",
    ...(payer ? { payer } : {}),
    ...(tokenContract ? { tokenContract } : {})
  };
}
