# ADR 0031: Native Multi-Rail Settlement

- Status: Accepted
- Date: 2026-07-19

## Context

Address and wallet-URI handoffs are useful payment transport, but they do not prove that the exact recipient received the exact amount. Treating a wallet launch or transaction submission as success can grant access without final settlement and can make retries replayable across purchases.

## Decision

### 1) Bind every payment to a one-time intent

The server creates a short-lived intent containing the buyer, recipient, asset, rail, network, address, amount, and tip or video-package scope. The signed buyer proof and server-held intent secret prevent cross-user and cross-purchase reuse.

### 2) Verify exact settlement by rail

Supported verifier families are:

- Monero wallet RPC subaddress sessions
- Lightning NIP-57 invoice and signed receipt validation
- Bitcoin, Dogecoin, and Bitcoin Cash transaction-output verification
- Ethereum native and allowlisted ERC-20 transfer-log verification
- TRON native and allowlisted TRC-20 verification
- Solana native and allowlisted SPL balance-delta verification
- XRP Ledger validated-delivery verification
- Cardano output and confirmation verification

Each adapter validates recipient, amount, network, transaction success, required finality, and replay identity. Token contracts and mints are allowlisted rather than accepted from client input.

### 3) Fail closed before payment

Intent creation checks the effective server capability. If its authenticated node, RPC, or indexer is not configured, the server returns `503` before the wallet is opened. `DSTREAM_REQUIRED_PAYMENT_CAPABILITIES` defines the production minimum, and `/api/payments/health` returns `503` when a required verifier or durable store is unavailable.

### 4) Grant access only after settlement

A video purchase consumes a settled intent and creates an entitlement. Playback uses a short-lived scoped token, refreshed only after re-evaluating the entitlement. Wallet launch, provider submission, or a pasted transaction id is never sufficient by itself.

### 5) Keep provider credentials server-only

Browser wallets sign or hand off transactions, but RPC credentials and API keys stay on the server. Public donation addresses are independent of verifier provider credentials.

## Consequences

- Operators must provision authenticated production providers before enabling additional required rails.
- The capability endpoint is the source of truth for which rails can settle now.
- Missing wallet receive addresses or RPC credentials are explicit configuration gaps and are never replaced with generated or guessed values.
- Durable intent and settlement stores must remain on `/var/lib/dstream` and be included in backups.
