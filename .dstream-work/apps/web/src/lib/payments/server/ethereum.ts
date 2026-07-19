import { decimalToAtomic, parseHexQuantity, parsePositiveEnvInt } from "./amount";
import { postJson } from "./http";
import type { NativePaymentRailCapability, NativePaymentVerificationInput, VerifiedNativePayment } from "./types";
import { NativePaymentVerificationError } from "./types";

interface EthereumRpcResponse<T> {
  result?: T | null;
  error?: { code?: number; message?: string };
}

interface EthereumTransaction {
  hash?: string;
  to?: string | null;
  value?: string;
  blockNumber?: string | null;
}

interface EthereumReceipt {
  transactionHash?: string;
  status?: string;
  blockNumber?: string | null;
}

function getOrigin(): string {
  return (process.env.DSTREAM_ETH_RPC_ORIGIN ?? "").trim();
}

function normalizeChainId(input: string): string {
  const value = input.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(value)) return `0x${BigInt(value).toString(16)}`;
  if (/^\d+$/.test(value)) return `0x${BigInt(value).toString(16)}`;
  return "0x1";
}

function getChainId(): string {
  return normalizeChainId(process.env.DSTREAM_ETH_CHAIN_ID ?? "0x1");
}

function getConfirmationsRequired(): number {
  return parsePositiveEnvInt("DSTREAM_ETH_CONFIRMATIONS_REQUIRED", 12, 10000);
}

let rpcSequence = 0;

async function ethereumRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const origin = getOrigin();
  if (!origin) throw new NativePaymentVerificationError("Ethereum settlement verification is not configured.", 503);
  const response = await postJson<EthereumRpcResponse<T>>({
    url: origin,
    body: { jsonrpc: "2.0", id: ++rpcSequence, method, params },
    label: "Ethereum RPC"
  });
  if (response.error) {
    throw new NativePaymentVerificationError(
      `Ethereum RPC rejected the request: ${response.error.message?.trim() || response.error.code || "unknown error"}`,
      502
    );
  }
  if (response.result === undefined || response.result === null) {
    throw new NativePaymentVerificationError("Ethereum transaction is not available on the configured RPC.", 404);
  }
  return response.result;
}

export function getEthereumCapability(): NativePaymentRailCapability {
  return {
    asset: "eth",
    railId: "evm",
    network: `eip155:${BigInt(getChainId()).toString(10)}`,
    configured: !!getOrigin(),
    confirmationsRequired: getConfirmationsRequired()
  };
}

export async function verifyEthereumPayment(input: NativePaymentVerificationInput): Promise<VerifiedNativePayment> {
  const txId = input.txId.trim().toLowerCase();
  const recipient = input.address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txId)) throw new NativePaymentVerificationError("Ethereum transaction hash is malformed.", 400);
  if (!/^0x[a-f0-9]{40}$/.test(recipient)) throw new NativePaymentVerificationError("Ethereum recipient address is malformed.", 400);
  const expectedWei = decimalToAtomic(input.amount, 18);

  const actualChainId = normalizeChainId(await ethereumRpc<string>("eth_chainId"));
  const expectedChainId = getChainId();
  if (actualChainId !== expectedChainId) {
    throw new NativePaymentVerificationError(
      `Ethereum RPC network mismatch: expected ${expectedChainId}, received ${actualChainId}.`,
      503
    );
  }

  const tx = await ethereumRpc<EthereumTransaction>("eth_getTransactionByHash", [txId]);
  const receipt = await ethereumRpc<EthereumReceipt>("eth_getTransactionReceipt", [txId]);
  if ((tx.hash ?? "").toLowerCase() !== txId || (receipt.transactionHash ?? "").toLowerCase() !== txId) {
    throw new NativePaymentVerificationError("Ethereum RPC returned a different transaction.", 502);
  }
  if ((receipt.status ?? "").toLowerCase() !== "0x1") {
    throw new NativePaymentVerificationError("Ethereum transaction reverted or has not succeeded.");
  }
  if ((tx.to ?? "").toLowerCase() !== recipient) {
    throw new NativePaymentVerificationError("Ethereum transaction recipient does not match the package recipient.");
  }
  const paidWei = parseHexQuantity(tx.value, "Ethereum transaction value");
  if (paidWei < expectedWei) {
    throw new NativePaymentVerificationError("Ethereum transaction amount is below the package price.");
  }

  const txBlock = parseHexQuantity(tx.blockNumber, "Ethereum transaction block");
  const receiptBlock = parseHexQuantity(receipt.blockNumber, "Ethereum receipt block");
  if (txBlock !== receiptBlock) throw new NativePaymentVerificationError("Ethereum transaction and receipt blocks do not match.", 502);
  const head = parseHexQuantity(await ethereumRpc<string>("eth_blockNumber"), "Ethereum head block");
  if (head < txBlock) throw new NativePaymentVerificationError("Ethereum RPC head is behind the payment block.", 502);
  const confirmationsBig = head - txBlock + 1n;
  const confirmations = Number(confirmationsBig);
  const required = getConfirmationsRequired();
  if (!Number.isSafeInteger(confirmations) || confirmations < required) {
    throw new NativePaymentVerificationError(`Ethereum payment has ${confirmations}/${required} confirmations.`, 409);
  }

  return {
    asset: "eth",
    railId: "evm",
    network: `eip155:${BigInt(expectedChainId).toString(10)}`,
    txId,
    settlementKey: `eth:${expectedChainId}:${txId}`,
    recipient,
    amountAtomic: paidWei.toString(),
    confirmations,
    blockHeight: Number(txBlock)
  };
}
