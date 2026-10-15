import { createHash, randomUUID } from "node:crypto";
import { updateJsonFileAtomic } from "../storage/jsonFileStore";

type Settlement = { id: string; state: "pending" | "settled"; destination: string; txids: string[] };
type Store = { version: 1; settlements: Record<string, Settlement> };

export class WalletSettlementError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); }
}

function storePath(): string {
  return process.env.DSTREAM_XMR_SETTLEMENT_STORE_PATH?.trim() || "/var/lib/dstream/wallet-settlements.json";
}

function settlementKey(address: string): string {
  return createHash("sha256").update(address).digest("hex");
}

function update(fn: (store: Store) => void): void {
  updateJsonFileAtomic<Store>(storePath(), { version: 1, settlements: {} }, (store) => {
    if (store?.version !== 1 || !store.settlements || typeof store.settlements !== "object") {
      throw new WalletSettlementError("Wallet settlement store is invalid.", 503);
    }
    fn(store);
    return store;
  });
}

export function claimWalletSettlement(address: string, destination: string): string {
  const id = randomUUID();
  update((store) => {
    const key = settlementKey(address);
    if (store.settlements[key]) throw new WalletSettlementError("Stake is already settled or awaiting settlement reconciliation.");
    // Persist before spending. An ambiguous RPC timeout must not allow a second sweep.
    store.settlements[key] = { id, state: "pending", destination, txids: [] };
  });
  return id;
}

export function completeWalletSettlement(address: string, id: string, txids: string[]): void {
  update((store) => {
    const row = store.settlements[settlementKey(address)];
    if (!row || row.id !== id || row.state !== "pending") throw new WalletSettlementError("Wallet settlement claim mismatch.");
    row.state = "settled";
    row.txids = txids;
  });
}
