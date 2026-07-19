import type { StreamPaymentAsset } from "@dstream/protocol";
import { decimalToAtomic, parseHexQuantity, parsePositiveEnvInt } from "./amount";
import { postJson } from "./http";
import type { PaymentRailCapability, PaymentVerificationInput, VerifiedPayment } from "./types";
import { PaymentVerificationError } from "./types";

type EvmAsset = Extract<StreamPaymentAsset, "eth" | "usdt" | "usdc" | "pepe">;

interface EthereumRpcResponse<T> {
  result?: T | null;
  error?: { code?: number; message?: string };
}

interface EthereumTransaction {
  hash?: string;
  from?: string;
  to?: string | null;
  value?: string;
  blockNumber?: string | null;
}

interface EthereumLog {
  address?: string;
  data?: string;
  topics?: string[];
  logIndex?: string;
  removed?: boolean;
}

interface EthereumReceipt {
  transactionHash?: string;
  status?: string;
  blockNumber?: string | null;
  logs?: EthereumLog[];
}

interface EvmTokenConfig {
  contract: string;
  decimals: number;
}

interface EvmNetworkConfig {
  name: string;
  aliases: string[];
  chainId: string;
  rpcOrigin: string;
  confirmationsRequired: number;
  tokens: Partial<Record<Exclude<EvmAsset, "eth">, EvmTokenConfig>>;
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const MAINNET_TOKENS: EvmNetworkConfig["tokens"] = {
  usdt: { contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
  usdc: { contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
  pepe: { contract: "0x6982508145454ce325ddbE47a25d4ec3d2311933".toLowerCase(), decimals: 18 }
};

function normalizeChainId(input: string): string {
  const value = input.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(value)) return `0x${BigInt(value).toString(16)}`;
  if (/^\d+$/.test(value)) return `0x${BigInt(value).toString(16)}`;
  throw new PaymentVerificationError("EVM chain id is malformed.", 500);
}

function parseAdditionalNetworks(): EvmNetworkConfig[] {
  const raw = (process.env.DSTREAM_EVM_NETWORKS_JSON ?? "").trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const result: EvmNetworkConfig[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const value = row as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim().toLowerCase() : "";
    const rpcOrigin = typeof value.rpcOrigin === "string" ? value.rpcOrigin.trim() : "";
    if (!name || !rpcOrigin) continue;
    let chainId: string;
    try {
      chainId = normalizeChainId(String(value.chainId ?? ""));
    } catch {
      continue;
    }
    const aliases = Array.isArray(value.aliases)
      ? value.aliases.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase())
      : [];
    const confirmationsRaw = Number(value.confirmationsRequired);
    const confirmationsRequired =
      Number.isInteger(confirmationsRaw) && confirmationsRaw > 0 && confirmationsRaw <= 10000 ? confirmationsRaw : 12;
    const tokens: EvmNetworkConfig["tokens"] = {};
    if (value.tokens && typeof value.tokens === "object" && !Array.isArray(value.tokens)) {
      for (const asset of ["usdt", "usdc", "pepe"] as const) {
        const tokenRaw = (value.tokens as Record<string, unknown>)[asset];
        if (!tokenRaw || typeof tokenRaw !== "object" || Array.isArray(tokenRaw)) continue;
        const token = tokenRaw as Record<string, unknown>;
        const contract = typeof token.contract === "string" ? token.contract.trim().toLowerCase() : "";
        const decimals = Number(token.decimals);
        if (/^0x[a-f0-9]{40}$/.test(contract) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36) {
          tokens[asset] = { contract, decimals };
        }
      }
    }
    result.push({ name, aliases, chainId, rpcOrigin, confirmationsRequired, tokens });
  }
  return result;
}

function getNetworks(): EvmNetworkConfig[] {
  const chainId = normalizeChainId(process.env.DSTREAM_ETH_CHAIN_ID ?? "0x1");
  const mainnet: EvmNetworkConfig = {
    name: "ethereum",
    aliases: ["evm", "mainnet", "1", "eip155:1", chainId],
    chainId,
    rpcOrigin: (process.env.DSTREAM_ETH_RPC_ORIGIN ?? "").trim(),
    confirmationsRequired: parsePositiveEnvInt("DSTREAM_ETH_CONFIRMATIONS_REQUIRED", 12, 10000),
    tokens: chainId === "0x1" ? MAINNET_TOKENS : {}
  };
  return [mainnet, ...parseAdditionalNetworks()];
}

function getNetwork(input: PaymentVerificationInput): EvmNetworkConfig {
  const requested = (input.network ?? "ethereum").trim().toLowerCase();
  const networks = getNetworks();
  const match = networks.find((network) => {
    const decimalChainId = BigInt(network.chainId).toString(10);
    return (
      requested === network.name ||
      requested === network.chainId ||
      requested === decimalChainId ||
      requested === `eip155:${decimalChainId}` ||
      network.aliases.includes(requested)
    );
  });
  if (!match) throw new PaymentVerificationError(`EVM network "${requested}" is not configured.`, 503);
  if (!match.rpcOrigin) throw new PaymentVerificationError(`${match.name} settlement verification is not configured.`, 503);
  return match;
}

let rpcSequence = 0;

async function ethereumRpc<T>(network: EvmNetworkConfig, method: string, params: unknown[] = []): Promise<T> {
  const response = await postJson<EthereumRpcResponse<T>>({
    url: network.rpcOrigin,
    body: { jsonrpc: "2.0", id: ++rpcSequence, method, params },
    label: `${network.name} RPC`
  });
  if (response.error) {
    throw new PaymentVerificationError(
      `${network.name} RPC rejected the request: ${response.error.message?.trim() || response.error.code || "unknown error"}`,
      502
    );
  }
  if (response.result === undefined || response.result === null) {
    throw new PaymentVerificationError(`${network.name} transaction is not available on the configured RPC.`, 404);
  }
  return response.result;
}

function normalizeAddress(input: string): string {
  const value = input.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(value)) throw new PaymentVerificationError("EVM recipient address is malformed.", 400);
  return value;
}

function topicAddress(input: string | undefined): string | null {
  if (typeof input !== "string" || !/^0x[a-f0-9]{64}$/i.test(input)) return null;
  return `0x${input.slice(-40).toLowerCase()}`;
}

function capabilityRows(network: EvmNetworkConfig): PaymentRailCapability[] {
  const common = {
    railId: "evm" as const,
    network: `eip155:${BigInt(network.chainId).toString(10)}`,
    configured: !!network.rpcOrigin,
    confirmationsRequired: network.confirmationsRequired,
    verifier: "json_rpc" as const,
    ...(!network.rpcOrigin ? { reason: `${network.name} RPC endpoint is not configured.` } : {})
  };
  const rows: PaymentRailCapability[] = [{ asset: "eth", ...common }];
  for (const asset of ["usdt", "usdc", "pepe"] as const) {
    if (network.tokens[asset]) rows.push({ asset, ...common });
  }
  return rows;
}

export function getEvmCapabilities(): PaymentRailCapability[] {
  return getNetworks().flatMap(capabilityRows);
}

export function getEthereumCapability(): PaymentRailCapability {
  return getEvmCapabilities().find((entry) => entry.asset === "eth" && entry.network === "eip155:1") ?? getEvmCapabilities()[0]!;
}

export async function verifyEvmPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  if (!["eth", "usdt", "usdc", "pepe"].includes(input.asset)) {
    throw new PaymentVerificationError(`${input.asset.toUpperCase()} is not an EVM settlement asset.`, 400);
  }
  const asset = input.asset as EvmAsset;
  const network = getNetwork(input);
  const canonicalNetwork = `eip155:${BigInt(network.chainId).toString(10)}`;
  const txId = (input.txId ?? input.proof?.txId ?? input.proof?.transactionHash ?? "").trim().toLowerCase();
  const recipient = normalizeAddress(input.address);
  if (!/^0x[a-f0-9]{64}$/.test(txId)) throw new PaymentVerificationError("EVM transaction hash is malformed.", 400);

  const actualChainId = normalizeChainId(await ethereumRpc<string>(network, "eth_chainId"));
  if (actualChainId !== network.chainId) {
    throw new PaymentVerificationError(
      `EVM RPC network mismatch: expected ${network.chainId}, received ${actualChainId}.`,
      503
    );
  }

  const tx = await ethereumRpc<EthereumTransaction>(network, "eth_getTransactionByHash", [txId]);
  const receipt = await ethereumRpc<EthereumReceipt>(network, "eth_getTransactionReceipt", [txId]);
  if ((tx.hash ?? "").toLowerCase() !== txId || (receipt.transactionHash ?? "").toLowerCase() !== txId) {
    throw new PaymentVerificationError("EVM RPC returned a different transaction.", 502);
  }
  if ((receipt.status ?? "").toLowerCase() !== "0x1") {
    throw new PaymentVerificationError("EVM transaction reverted or has not succeeded.");
  }

  const txBlock = parseHexQuantity(tx.blockNumber, "EVM transaction block");
  const receiptBlock = parseHexQuantity(receipt.blockNumber, "EVM receipt block");
  if (txBlock !== receiptBlock) throw new PaymentVerificationError("EVM transaction and receipt blocks do not match.", 502);
  const head = parseHexQuantity(await ethereumRpc<string>(network, "eth_blockNumber"), "EVM head block");
  if (head < txBlock) throw new PaymentVerificationError("EVM RPC head is behind the payment block.", 502);
  const confirmationsBig = head - txBlock + 1n;
  const confirmations = Number(confirmationsBig);
  if (!Number.isSafeInteger(confirmations) || confirmations < network.confirmationsRequired) {
    throw new PaymentVerificationError(
      `EVM payment has ${confirmations}/${network.confirmationsRequired} confirmations.`,
      409
    );
  }

  let amountAtomic: bigint;
  let settlementSuffix = "native";
  let tokenContract: string | undefined;
  let payer = typeof tx.from === "string" ? normalizeAddress(tx.from) : undefined;

  if (asset === "eth") {
    if ((tx.to ?? "").toLowerCase() !== recipient) {
      throw new PaymentVerificationError("EVM transaction recipient does not match the payment intent.");
    }
    amountAtomic = parseHexQuantity(tx.value, "EVM transaction value");
    if (amountAtomic < decimalToAtomic(input.amount, 18)) {
      throw new PaymentVerificationError("ETH transaction amount is below the required payment amount.");
    }
  } else {
    const token = network.tokens[asset];
    if (!token) throw new PaymentVerificationError(`${asset.toUpperCase()} is not allowlisted on ${network.name}.`, 503);
    tokenContract = token.contract.toLowerCase();
    if ((tx.to ?? "").toLowerCase() !== tokenContract) {
      throw new PaymentVerificationError(`${asset.toUpperCase()} transaction targets the wrong token contract.`);
    }
    const expected = decimalToAtomic(input.amount, token.decimals);
    const match = (receipt.logs ?? []).find((log) => {
      if (log.removed) return false;
      if ((log.address ?? "").toLowerCase() !== tokenContract) return false;
      if ((log.topics?.[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) return false;
      if (topicAddress(log.topics?.[2]) !== recipient) return false;
      try {
        return parseHexQuantity(log.data, `${asset.toUpperCase()} transfer amount`) >= expected;
      } catch {
        return false;
      }
    });
    if (!match) {
      throw new PaymentVerificationError(`${asset.toUpperCase()} receipt does not transfer the required recipient and amount.`);
    }
    amountAtomic = parseHexQuantity(match.data, `${asset.toUpperCase()} transfer amount`);
    const logIndex = Number(parseHexQuantity(match.logIndex ?? "0x0", "EVM log index"));
    settlementSuffix = `log:${logIndex}`;
    payer = topicAddress(match.topics?.[1]) ?? payer;
  }

  return {
    asset,
    railId: "evm",
    network: canonicalNetwork,
    txId,
    settlementKey: `${asset}:${canonicalNetwork}:${txId}:${settlementSuffix}`,
    recipient,
    amountAtomic: amountAtomic.toString(),
    confirmations,
    blockHeight: Number(txBlock),
    finality: "confirmed",
    ...(payer ? { payer } : {}),
    ...(tokenContract ? { tokenContract } : {})
  };
}

export function verifyEthereumPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  if (input.asset !== "eth") throw new PaymentVerificationError("Ethereum verifier requires the ETH asset.", 400);
  return verifyEvmPayment(input);
}
