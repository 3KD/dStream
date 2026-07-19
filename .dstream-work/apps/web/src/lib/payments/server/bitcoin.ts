import { decimalToAtomic, parsePositiveEnvInt } from "./amount";
import { postJson } from "./http";
import type { NativePaymentRailCapability, NativePaymentVerificationInput, VerifiedNativePayment } from "./types";
import { NativePaymentVerificationError } from "./types";

interface BitcoinRpcResponse<T> {
  result?: T;
  error?: { code?: number; message?: string } | null;
}

interface BitcoinTransaction {
  txid?: string;
  confirmations?: number;
  vout?: Array<{
    n?: number;
    value?: number | string;
    scriptPubKey?: { address?: string; addresses?: string[] };
  }>;
}

interface BitcoinBlockchainInfo {
  chain?: string;
  blocks?: number;
}

function getOrigin(): string {
  return (process.env.DSTREAM_BTC_RPC_ORIGIN ?? "").trim();
}

function getNetwork(): string {
  return (process.env.DSTREAM_BTC_NETWORK ?? "main").trim().toLowerCase() || "main";
}

function getConfirmationsRequired(): number {
  return parsePositiveEnvInt("DSTREAM_BTC_CONFIRMATIONS_REQUIRED", 3, 1000);
}

function authHeader(): Record<string, string> {
  const user = (process.env.DSTREAM_BTC_RPC_USER ?? "").trim();
  const pass = process.env.DSTREAM_BTC_RPC_PASS ?? "";
  if (!user && !pass) return {};
  return { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
}

let rpcSequence = 0;

async function bitcoinRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const origin = getOrigin();
  if (!origin) throw new NativePaymentVerificationError("Bitcoin settlement verification is not configured.", 503);
  const response = await postJson<BitcoinRpcResponse<T>>({
    url: origin,
    headers: authHeader(),
    body: { jsonrpc: "1.0", id: `dstream-${++rpcSequence}`, method, params },
    label: "Bitcoin RPC"
  });
  if (response.error) {
    const detail = response.error.message?.trim() || `RPC error ${response.error.code ?? "unknown"}`;
    throw new NativePaymentVerificationError(`Bitcoin RPC rejected the request: ${detail}`, 502);
  }
  if (response.result === undefined || response.result === null) {
    throw new NativePaymentVerificationError("Bitcoin RPC returned no result.", 502);
  }
  return response.result;
}

function btcValueToSats(input: number | string | undefined): bigint {
  if (typeof input === "string") return decimalToAtomic(input, 8);
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    throw new NativePaymentVerificationError("Bitcoin output value is malformed.", 502);
  }
  const sats = Math.round(input * 100_000_000);
  if (!Number.isSafeInteger(sats)) {
    throw new NativePaymentVerificationError("Bitcoin output value exceeds the safe integer range.", 502);
  }
  return BigInt(sats);
}

function outputAddresses(output: NonNullable<BitcoinTransaction["vout"]>[number]): string[] {
  const values = [output.scriptPubKey?.address, ...(output.scriptPubKey?.addresses ?? [])];
  return values.filter((value): value is string => typeof value === "string" && !!value);
}

export function getBitcoinCapability(): NativePaymentRailCapability {
  return {
    asset: "btc",
    railId: "utxo",
    network: getNetwork(),
    configured: !!getOrigin(),
    confirmationsRequired: getConfirmationsRequired()
  };
}

export async function verifyBitcoinPayment(input: NativePaymentVerificationInput): Promise<VerifiedNativePayment> {
  const txId = input.txId.trim().toLowerCase();
  const address = input.address.trim();
  if (!/^[a-f0-9]{64}$/.test(txId)) throw new NativePaymentVerificationError("Bitcoin transaction ID is malformed.", 400);
  if (!address || address.length > 120) throw new NativePaymentVerificationError("Bitcoin recipient address is missing.", 400);
  const expectedSats = decimalToAtomic(input.amount, 8);

  const chain = await bitcoinRpc<BitcoinBlockchainInfo>("getblockchaininfo");
  if ((chain.chain ?? "").toLowerCase() !== getNetwork()) {
    throw new NativePaymentVerificationError(
      `Bitcoin RPC network mismatch: expected ${getNetwork()}, received ${chain.chain ?? "unknown"}.`,
      503
    );
  }

  const tx = await bitcoinRpc<BitcoinTransaction>("getrawtransaction", [txId, true]);
  if ((tx.txid ?? "").toLowerCase() !== txId) {
    throw new NativePaymentVerificationError("Bitcoin RPC returned a different transaction.", 502);
  }
  const confirmations = Number.isInteger(tx.confirmations) ? Number(tx.confirmations) : 0;
  const required = getConfirmationsRequired();
  if (confirmations < required) {
    throw new NativePaymentVerificationError(`Bitcoin payment has ${confirmations}/${required} confirmations.`, 409);
  }

  const match = (tx.vout ?? []).find((output) => {
    if (!outputAddresses(output).includes(address)) return false;
    return btcValueToSats(output.value) >= expectedSats;
  });
  if (!match || !Number.isInteger(match.n) || Number(match.n) < 0) {
    throw new NativePaymentVerificationError("Bitcoin transaction does not pay the required recipient and amount.");
  }
  const paidSats = btcValueToSats(match.value);
  const outputIndex = Number(match.n);
  const headHeight = Number.isSafeInteger(chain.blocks) ? Number(chain.blocks) : 0;
  const blockHeight = headHeight > 0 ? headHeight - confirmations + 1 : 0;

  return {
    asset: "btc",
    railId: "utxo",
    network: getNetwork(),
    txId,
    settlementKey: `btc:${getNetwork()}:${txId}:${outputIndex}`,
    recipient: address,
    amountAtomic: paidSats.toString(),
    confirmations,
    blockHeight
  };
}
