import { decimalToAtomic, parseIntegerQuantity, parsePositiveEnvInt } from "./amount";
import { getJson, joinOriginPath } from "./http";
import type { PaymentRailCapability, PaymentVerificationInput, VerifiedPayment } from "./types";
import { PaymentVerificationError } from "./types";

interface CardanoTransaction {
  hash?: string;
  block_height?: number | string;
  valid_contract?: boolean;
}

interface CardanoTransactionUtxos {
  hash?: string;
  outputs?: Array<{
    address?: string;
    amount?: Array<{ unit?: string; quantity?: string }>;
  }>;
}

interface CardanoBlock {
  height?: number | string;
}

interface KoiosTransaction {
  tx_hash?: string;
  block_height?: number | string;
  outputs?: Array<{
    payment_addr?: { bech32?: string };
    value?: number | string;
  }>;
}

interface KoiosTip {
  block_height?: number | string;
}

interface KoiosTransactionStatus {
  tx_hash?: string;
  num_confirmations?: number | string;
}

function getOrigin(): string {
  return (process.env.DSTREAM_CARDANO_API_ORIGIN ?? "").trim();
}

function getApiKind(): "blockfrost" | "koios" {
  const configured = (process.env.DSTREAM_CARDANO_API_KIND ?? "blockfrost").trim().toLowerCase();
  return configured === "koios" ? "koios" : "blockfrost";
}

function getNetwork(): string {
  return (process.env.DSTREAM_CARDANO_NETWORK ?? "mainnet").trim().toLowerCase() || "mainnet";
}

function getConfirmationsRequired(): number {
  return parsePositiveEnvInt("DSTREAM_CARDANO_CONFIRMATIONS_REQUIRED", 15, 10000);
}

function headers(): Record<string, string> {
  const projectId = (process.env.DSTREAM_CARDANO_API_KEY ?? "").trim();
  return projectId ? { project_id: projectId } : {};
}

function normalizeAddress(input: string): string {
  const value = input.trim();
  if (!/^(addr1|addr_test1|Ae2)[0-9a-zA-Z]{20,200}$/.test(value)) {
    throw new PaymentVerificationError("Cardano recipient address is malformed.", 400);
  }
  return value;
}

function assertRequestedNetwork(input: PaymentVerificationInput): void {
  const requested = (input.network ?? "").trim().toLowerCase();
  if (!requested) return;
  const network = getNetwork();
  const aliases = new Set(["ada", "cardano", network, `cardano:${network}`]);
  if (network === "mainnet") aliases.add("main");
  if (!aliases.has(requested)) {
    throw new PaymentVerificationError(`Cardano payment intent network does not match ${network}.`, 400);
  }
}

async function cardanoGet<T>(path: string, label: string): Promise<T> {
  const origin = getOrigin();
  if (!origin) throw new PaymentVerificationError("Cardano settlement verification is not configured.", 503);
  return getJson<T>({ url: joinOriginPath(origin, path), headers: headers(), label });
}

export function getCardanoCapabilities(): PaymentRailCapability[] {
  const configured = !!getOrigin();
  return [
    {
      asset: "ada",
      railId: "cardano",
      network: `cardano:${getNetwork()}`,
      configured,
      confirmationsRequired: getConfirmationsRequired(),
      verifier: "rest",
      ...(!configured ? { reason: "Cardano chain-index API is not configured." } : {})
    }
  ];
}

async function verifyKoiosPayment(input: {
  txId: string;
  recipient: string;
  expectedLovelace: bigint;
}): Promise<{ paidLovelace: bigint; confirmations: number; blockHeight: bigint }> {
  const query = `_tx_hashes={${input.txId}}`;
  const [transactions, statuses, tips] = await Promise.all([
    cardanoGet<KoiosTransaction[]>(`tx_info?${query}`, "Cardano Koios transaction API"),
    cardanoGet<KoiosTransactionStatus[]>(`tx_status?${query}`, "Cardano Koios transaction status API"),
    cardanoGet<KoiosTip[]>("tip", "Cardano Koios tip API")
  ]);
  const tx = transactions.find((row) => (row.tx_hash ?? "").toLowerCase() === input.txId);
  const status = statuses.find((row) => (row.tx_hash ?? "").toLowerCase() === input.txId);
  if (!tx || !status) throw new PaymentVerificationError("Cardano transaction is not confirmed by Koios.", 404);

  const blockHeight = parseIntegerQuantity(tx.block_height, "Cardano Koios transaction block height");
  const head = parseIntegerQuantity(tips[0]?.block_height, "Cardano Koios latest block height");
  const reportedConfirmations = parseIntegerQuantity(
    status.num_confirmations,
    "Cardano Koios transaction confirmations"
  );
  if (head < blockHeight) throw new PaymentVerificationError("Cardano Koios index is behind the payment block.", 502);
  const confirmationsBig = head - blockHeight + 1n;
  if (reportedConfirmations <= 0n || reportedConfirmations > confirmationsBig) {
    throw new PaymentVerificationError("Cardano Koios confirmation data is inconsistent.", 502);
  }
  const confirmations = Number(reportedConfirmations);
  const required = getConfirmationsRequired();
  if (!Number.isSafeInteger(confirmations) || confirmations < required) {
    throw new PaymentVerificationError(`Cardano payment has ${confirmations}/${required} confirmations.`, 409);
  }

  let paidLovelace = 0n;
  for (const output of tx.outputs ?? []) {
    if (output.payment_addr?.bech32 !== input.recipient) continue;
    paidLovelace += parseIntegerQuantity(output.value, "Cardano Koios output value");
  }
  if (paidLovelace < input.expectedLovelace) {
    throw new PaymentVerificationError("Cardano transaction does not pay the required recipient and amount.");
  }
  return { paidLovelace, confirmations, blockHeight };
}

export async function verifyCardanoPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  if (input.asset !== "ada") throw new PaymentVerificationError("Cardano verifier requires the ADA asset.", 400);
  const txId = (input.txId ?? input.proof?.txId ?? input.proof?.transactionHash ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(txId)) throw new PaymentVerificationError("Cardano transaction hash is malformed.", 400);
  const recipient = normalizeAddress(input.address);
  assertRequestedNetwork(input);
  const expectedLovelace = decimalToAtomic(input.amount, 6);
  if (getApiKind() === "koios") {
    const verified = await verifyKoiosPayment({ txId, recipient, expectedLovelace });
    const network = `cardano:${getNetwork()}`;
    return {
      asset: "ada",
      railId: "cardano",
      network,
      txId,
      settlementKey: `ada:${network}:${txId}`,
      recipient,
      amountAtomic: verified.paidLovelace.toString(),
      confirmations: verified.confirmations,
      blockHeight: Number(verified.blockHeight),
      finality: "confirmed",
      metadata: { verifier: "koios" }
    };
  }
  const tx = await cardanoGet<CardanoTransaction>(`txs/${txId}`, "Cardano transaction API");
  const utxos = await cardanoGet<CardanoTransactionUtxos>(`txs/${txId}/utxos`, "Cardano transaction UTXO API");
  if ((tx.hash ?? "").toLowerCase() !== txId || (utxos.hash ?? "").toLowerCase() !== txId) {
    throw new PaymentVerificationError("Cardano API returned a different transaction.", 502);
  }
  if (tx.valid_contract === false) throw new PaymentVerificationError("Cardano transaction failed script validation.");
  const blockHeightBig = parseIntegerQuantity(tx.block_height, "Cardano transaction block height");
  const latest = await cardanoGet<CardanoBlock>("blocks/latest", "Cardano latest block API");
  const head = parseIntegerQuantity(latest.height, "Cardano latest block height");
  if (head < blockHeightBig) throw new PaymentVerificationError("Cardano chain index is behind the payment block.", 502);
  const confirmations = Number(head - blockHeightBig + 1n);
  const required = getConfirmationsRequired();
  if (!Number.isSafeInteger(confirmations) || confirmations < required) {
    throw new PaymentVerificationError(`Cardano payment has ${confirmations}/${required} confirmations.`, 409);
  }

  let paidLovelace = 0n;
  for (const output of utxos.outputs ?? []) {
    if (output.address !== recipient) continue;
    for (const amount of output.amount ?? []) {
      if (amount.unit !== "lovelace" || typeof amount.quantity !== "string" || !/^\d+$/.test(amount.quantity)) continue;
      paidLovelace += BigInt(amount.quantity);
    }
  }
  if (paidLovelace < expectedLovelace) {
    throw new PaymentVerificationError("Cardano transaction does not pay the required recipient and amount.");
  }
  const network = `cardano:${getNetwork()}`;
  return {
    asset: "ada",
    railId: "cardano",
    network,
    txId,
    settlementKey: `ada:${network}:${txId}`,
    recipient,
    amountAtomic: paidLovelace.toString(),
    confirmations,
    blockHeight: Number(blockHeightBig),
    finality: "confirmed"
  };
}
