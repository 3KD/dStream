import type { StreamPaymentAsset } from "@dstream/protocol";

export function normalizeNetworkKey(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

export const EVM_CHAIN_BY_NETWORK: Record<string, `0x${string}`> = {
  "1": "0x1",
  ethereum: "0x1",
  mainnet: "0x1",
  "137": "0x89",
  polygon: "0x89",
  matic: "0x89",
  "56": "0x38",
  bsc: "0x38",
  "10": "0xa",
  optimism: "0xa",
  "42161": "0xa4b1",
  arbitrum: "0xa4b1",
  "8453": "0x2105",
  base: "0x2105"
};

export const EVM_TOKEN_META: Record<
  string,
  Partial<Record<Exclude<StreamPaymentAsset, "xmr" | "btc" | "trx" | "sol" | "doge" | "bch" | "xrp" | "ada">, { contract: string; decimals: number }>>
> = {
  "0x1": {
    usdt: { contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    usdc: { contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    pepe: { contract: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18 }
  }
};

export const TRON_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export function resolveEvmChainId(networkRaw: string | null | undefined): `0x${string}` {
  const key = normalizeNetworkKey(networkRaw);
  return EVM_CHAIN_BY_NETWORK[key] ?? "0x1";
}

export function resolveEvmTokenMeta(
  asset: StreamPaymentAsset,
  networkRaw: string | null | undefined,
  contractOverride?: string | null
): { contract: string; decimals: number } | null {
  if (asset !== "usdt" && asset !== "usdc" && asset !== "pepe") return null;
  const chainId = resolveEvmChainId(networkRaw);
  const configured = EVM_TOKEN_META[chainId]?.[asset];
  if (!configured) {
    if (!contractOverride) return null;
    return {
      contract: contractOverride,
      decimals: asset === "pepe" ? 18 : 6
    };
  }
  return {
    contract: contractOverride ?? configured.contract,
    decimals: configured.decimals
  };
}
