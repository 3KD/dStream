import type { StreamPaymentAsset } from "@dstream/protocol";
import { base58 } from "@scure/base";
import { decimalToAtomic, parseIntegerQuantity, parsePositiveEnvInt } from "./amount";
import { postJson } from "./http";
import type { PaymentRailCapability, PaymentVerificationInput, VerifiedPayment } from "./types";
import { PaymentVerificationError } from "./types";

type SolanaAsset = Extract<StreamPaymentAsset, "sol" | "usdc" | "usdt">;

interface SolanaRpcResponse<T> {
  result?: T | null;
  error?: { code?: number; message?: string };
}

interface SolanaTokenBalance {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
}

interface SolanaInstruction {
  program?: string;
  parsed?: {
    type?: string;
    info?: {
      source?: string;
      destination?: string;
      lamports?: number | string;
    };
  };
}

interface SolanaTransactionResult {
  slot?: number;
  meta?: {
    err?: unknown;
    preTokenBalances?: SolanaTokenBalance[];
    postTokenBalances?: SolanaTokenBalance[];
  };
  transaction?: {
    signatures?: string[];
    message?: {
      accountKeys?: Array<string | { pubkey?: string; signer?: boolean }>;
      instructions?: SolanaInstruction[];
    };
  };
}

interface SolanaTokenConfig {
  mint: string;
  decimals: number;
}

const MAINNET_TOKENS: Record<"usdc" | "usdt", SolanaTokenConfig> = {
  usdc: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  usdt: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 }
};

function getOrigin(): string {
  return (process.env.DSTREAM_SOLANA_RPC_ORIGIN ?? "").trim();
}

function getNetwork(): string {
  return (process.env.DSTREAM_SOLANA_NETWORK ?? "mainnet-beta").trim().toLowerCase() || "mainnet-beta";
}

function getConfirmationsRequired(): number {
  return parsePositiveEnvInt("DSTREAM_SOLANA_CONFIRMATIONS_REQUIRED", 1, 10000);
}

function assertRequestedNetwork(input: PaymentVerificationInput): void {
  const requested = (input.network ?? "").trim().toLowerCase();
  if (!requested) return;
  const network = getNetwork();
  const aliases = new Set(["sol", "solana", "spl", network, `solana:${network}`]);
  if (network === "mainnet-beta") aliases.add("mainnet");
  if (!aliases.has(requested)) {
    throw new PaymentVerificationError(`Solana payment intent network does not match ${network}.`, 400);
  }
}

function getToken(asset: "usdc" | "usdt"): SolanaTokenConfig {
  const envPrefix = `DSTREAM_SOLANA_${asset.toUpperCase()}`;
  const fallback = MAINNET_TOKENS[asset];
  const mint = (process.env[`${envPrefix}_MINT`] ?? fallback.mint).trim();
  const decimalsRaw = Number.parseInt((process.env[`${envPrefix}_DECIMALS`] ?? String(fallback.decimals)).trim(), 10);
  const decimals = Number.isInteger(decimalsRaw) && decimalsRaw >= 0 && decimalsRaw <= 18 ? decimalsRaw : fallback.decimals;
  return { mint, decimals };
}

let rpcSequence = 0;

async function solanaRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const origin = getOrigin();
  if (!origin) throw new PaymentVerificationError("Solana settlement verification is not configured.", 503);
  const response = await postJson<SolanaRpcResponse<T>>({
    url: origin,
    body: { jsonrpc: "2.0", id: ++rpcSequence, method, params },
    label: "Solana RPC"
  });
  if (response.error) {
    throw new PaymentVerificationError(
      `Solana RPC rejected the request: ${response.error.message?.trim() || response.error.code || "unknown error"}`,
      502
    );
  }
  if (response.result === undefined || response.result === null) {
    throw new PaymentVerificationError("Solana transaction is not finalized on the configured RPC.", 404);
  }
  return response.result;
}

function normalizeAddress(input: string): string {
  const value = input.trim();
  try {
    if (base58.decode(value).length !== 32) throw new Error("wrong length");
  } catch {
    throw new PaymentVerificationError("Solana recipient address is malformed.", 400);
  }
  return value;
}

function accountKeyValue(input: string | { pubkey?: string; signer?: boolean }): string {
  return typeof input === "string" ? input : input.pubkey ?? "";
}

function tokenBalanceAmount(balance: SolanaTokenBalance | undefined): bigint {
  const value = balance?.uiTokenAmount?.amount;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0n;
  return BigInt(value);
}

function recipientTokenDelta(result: SolanaTransactionResult, recipient: string, mint: string): bigint {
  const pre = result.meta?.preTokenBalances ?? [];
  const post = result.meta?.postTokenBalances ?? [];
  const before = pre
    .filter((entry) => entry.owner === recipient && entry.mint === mint)
    .reduce((sum, entry) => sum + tokenBalanceAmount(entry), 0n);
  const after = post
    .filter((entry) => entry.owner === recipient && entry.mint === mint)
    .reduce((sum, entry) => sum + tokenBalanceAmount(entry), 0n);
  return after - before;
}

export function getSolanaCapabilities(): PaymentRailCapability[] {
  const configured = !!getOrigin();
  const common = {
    railId: "solana" as const,
    network: `solana:${getNetwork()}`,
    configured,
    confirmationsRequired: getConfirmationsRequired(),
    verifier: "json_rpc" as const,
    ...(!configured ? { reason: "Solana RPC endpoint is not configured." } : {})
  };
  return [
    { asset: "sol", ...common },
    { asset: "usdc", ...common },
    { asset: "usdt", ...common }
  ];
}

export async function verifySolanaPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  if (input.asset !== "sol" && input.asset !== "usdc" && input.asset !== "usdt") {
    throw new PaymentVerificationError(`${input.asset.toUpperCase()} is not configured on the Solana rail.`, 400);
  }
  const asset = input.asset as SolanaAsset;
  const txId = (input.txId ?? input.proof?.txId ?? input.proof?.transactionHash ?? "").trim();
  try {
    if (base58.decode(txId).length !== 64) throw new Error("wrong length");
  } catch {
    throw new PaymentVerificationError("Solana transaction signature is malformed.", 400);
  }
  const recipient = normalizeAddress(input.address);
  assertRequestedNetwork(input);
  const result = await solanaRpc<SolanaTransactionResult>("getTransaction", [
    txId,
    { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }
  ]);
  if (result.meta?.err !== null) throw new PaymentVerificationError("Solana transaction failed.");
  if (!(result.transaction?.signatures ?? []).includes(txId)) {
    throw new PaymentVerificationError("Solana RPC returned a different transaction.", 502);
  }
  const slot = Number(parseIntegerQuantity(result.slot, "Solana transaction slot"));
  const head = Number(await solanaRpc<number>("getSlot", [{ commitment: "finalized" }]));
  if (!Number.isSafeInteger(head) || head < slot) throw new PaymentVerificationError("Solana finalized head is invalid.", 502);
  const confirmations = head - slot + 1;
  const required = getConfirmationsRequired();
  if (confirmations < required) {
    throw new PaymentVerificationError(`Solana payment has ${confirmations}/${required} finalized slots.`, 409);
  }

  let amountAtomic: bigint;
  let tokenContract: string | undefined;
  if (asset === "sol") {
    const expected = decimalToAtomic(input.amount, 9);
    const transfers = (result.transaction?.message?.instructions ?? []).filter((instruction) => {
      const parsed = instruction.parsed;
      if (instruction.program !== "system" || parsed?.type !== "transfer") return false;
      return parsed.info?.destination === recipient;
    });
    amountAtomic = transfers.reduce((sum, instruction) => {
      try {
        return sum + parseIntegerQuantity(instruction.parsed?.info?.lamports, "Solana transfer amount");
      } catch {
        return sum;
      }
    }, 0n);
    if (amountAtomic < expected) {
      throw new PaymentVerificationError("SOL transaction does not transfer the required recipient and amount.");
    }
  } else {
    const token = getToken(asset);
    tokenContract = token.mint;
    amountAtomic = recipientTokenDelta(result, recipient, token.mint);
    if (amountAtomic < decimalToAtomic(input.amount, token.decimals)) {
      throw new PaymentVerificationError(`${asset.toUpperCase()} transaction does not credit the required recipient and amount.`);
    }
  }

  const accountKeys = result.transaction?.message?.accountKeys ?? [];
  const signer = accountKeys.find((entry) => typeof entry !== "string" && entry.signer);
  const payer = signer ? accountKeyValue(signer) : accountKeys[0] ? accountKeyValue(accountKeys[0]) : undefined;
  const network = `solana:${getNetwork()}`;
  return {
    asset,
    railId: "solana",
    network,
    txId,
    settlementKey: `${asset}:${network}:${txId}`,
    recipient,
    amountAtomic: amountAtomic.toString(),
    confirmations,
    blockHeight: slot,
    finality: "finalized",
    ...(payer ? { payer } : {}),
    ...(tokenContract ? { tokenContract } : {})
  };
}
